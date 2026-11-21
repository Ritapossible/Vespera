// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IOracleAdapter} from "./interfaces/IOracleAdapter.sol";
import {VesperaVault, IVesperaMarketPhase} from "./VesperaVault.sol";

/// @title VesperaMarket
/// @notice Weekend gap protection for tokenized stocks: fully collateralized, cash-settled put
///         spreads that settle against the first valid oracle round at or after market reopen.
///         Implements docs/SETTLEMENT_RULES.md. Positions are ERC-721 tokens.
///
///         Trust model: the owner (operator) can list stocks, create FUTURE epochs and post a
///         rate card before sales open. Nothing the owner controls can change an epoch, a rate
///         card, a reference, a settlement price or a payout once sales have opened.
///         Recording prices, settling, voiding and redeeming are permissionless.
contract VesperaMarket is ERC721, Ownable, ReentrancyGuard, EIP712, IVesperaMarketPhase {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ constants

    uint16 public constant BPS = 10_000;
    uint64 public constant VOID_DELAY = 72 hours;
    /// Reference round must be no older than this at the scheduled close (rules §3).
    uint64 public constant MAX_REFERENCE_AGE = 26 hours;

    // ------------------------------------------------------------------ types

    struct Epoch {
        uint64 sellOpen;
        uint64 cutoff;
        uint64 close;
        uint64 reopen;
        uint64 voidAfter;
    }

    struct Band {
        uint16 upperBps; // e.g. 9700
        uint16 lowerBps; // e.g. 8500
        uint32 premiumBps; // premium as bps of notional
    }

    enum BookStatus {
        None,
        Referenced,
        Settled,
        Voided
    }

    /// Per (epoch, stock) settlement state.
    struct Book {
        BookStatus status;
        int256 refPrice; // R
        int256 settlePrice; // S
        uint256 multiplier0; // B20 multiplier when R was recorded
        uint80 referenceRound;
        uint80 settlementRound;
        uint32 openPositions;
    }

    enum PositionStatus {
        Open,
        Redeemed
    }

    struct Position {
        uint32 epochId;
        uint32 stockId;
        uint8 bandId;
        PositionStatus status;
        uint128 notional;
        uint128 premium;
        uint128 maxPayout;
    }

    struct Mandate {
        address owner;
        address agent;
        uint256 stockMask; // bit i set => stockId i allowed
        uint128 maxPremiumPerEpoch;
        uint128 maxNotional;
        uint16 minUpperBps;
        uint16 maxUpperBps;
        uint64 expiry;
        uint256 nonce;
    }

    bytes32 public constant MANDATE_TYPEHASH = keccak256(
        "Mandate(address owner,address agent,uint256 stockMask,uint128 maxPremiumPerEpoch,uint128 maxNotional,uint16 minUpperBps,uint16 maxUpperBps,uint64 expiry,uint256 nonce)"
    );

    // ------------------------------------------------------------------ storage

    IERC20 public immutable usdc;
    IOracleAdapter public immutable oracle;
    /// Max collateral locked per stock per epoch, as bps of vault assets.
    uint16 public immutable capBps;
    uint128 public immutable minNotional;

    mapping(uint32 => VesperaVault) public vaults;
    Epoch[] internal _epochs;
    mapping(uint32 => mapping(uint32 => Band[])) internal _rateCards; // epochId => stockId => bands
    mapping(uint32 => mapping(uint32 => bool)) public rateCardPosted;
    mapping(uint32 => mapping(uint32 => Book)) internal _books;
    mapping(uint32 => uint32) public stockOpenPositions;
    mapping(uint256 => Position) internal _positions;
    uint256 public nextPositionId = 1;

    mapping(address => uint256) public mandateNonces;
    mapping(bytes32 => mapping(uint32 => uint256)) public mandatePremiumSpent; // mandateHash => epochId => spent

    // ------------------------------------------------------------------ errors

    error StockExists(uint32 stockId);
    error UnknownStock(uint32 stockId);
    error BadEpoch();
    error UnknownEpoch(uint32 epochId);
    error RateCardLocked();
    error BadBand(uint256 index);
    error SalesClosed();
    error NoRateCard();
    error BadBandId(uint8 bandId);
    error NotionalTooSmall();
    error PremiumTooHigh(uint256 premium, uint256 maxPremium);
    error CapExceeded(uint256 wouldLock, uint256 cap);
    error TooEarly();
    error TooLate();
    error WrongStatus(BookStatus status);
    error RoundMissing(uint80 roundId);
    error BadPrice();
    error NotLastBeforeClose();
    error StaleReference();
    error BeforeReopen();
    error NotFirstAfterReopen();
    error AlreadyRedeemed(uint256 positionId);
    error Unresolved();
    error NotAgent();
    error MandateExpired();
    error MandateRevoked();
    error BadSignature();
    error OutsideMandate();

    // ------------------------------------------------------------------ events

    event StockListed(uint32 indexed stockId, address vault);
    event EpochCreated(uint32 indexed epochId, Epoch epoch);
    event RateCardPosted(uint32 indexed epochId, uint32 indexed stockId, Band[] bands);
    event Bought(
        uint256 indexed positionId,
        address indexed owner,
        uint32 indexed epochId,
        uint32 stockId,
        uint8 bandId,
        uint256 notional,
        uint256 premium,
        uint256 maxPayout,
        address agent
    );
    event ReferenceRecorded(uint32 indexed epochId, uint32 indexed stockId, uint80 roundId, int256 price, uint256 multiplier);
    event SettlementRecorded(uint32 indexed epochId, uint32 indexed stockId, uint80 roundId, int256 price);
    event BookVoided(uint32 indexed epochId, uint32 indexed stockId, string reason);
    event Redeemed(uint256 indexed positionId, address indexed to, uint256 payout, uint256 refund);
    event MandatesRevoked(address indexed owner, uint256 newNonce);

    // ------------------------------------------------------------------ constructor

    constructor(IERC20 usdc_, IOracleAdapter oracle_, address owner_, uint16 capBps_, uint128 minNotional_)
        ERC721("Vespera Position", "VSP")
        Ownable(owner_)
        EIP712("Vespera", "1")
    {
        usdc = usdc_;
        oracle = oracle_;
        capBps = capBps_;
        minNotional = minNotional_;
    }

    // ================================================================== operator

    /// @notice Register a vault deployed separately (keeps this contract under the size limit).
    ///         The vault must point at this market, this stock and USDC. Set once per stock.
    function listStock(uint32 stockId, VesperaVault v) external onlyOwner {
        if (address(vaults[stockId]) != address(0)) revert StockExists(stockId);
        if (v.market() != address(this) || v.stockId() != stockId || v.asset() != address(usdc)) {
            revert UnknownStock(stockId);
        }
        vaults[stockId] = v;
        emit StockListed(stockId, address(v));
    }

    /// @notice Create a future epoch. Timestamps are immutable once created.
    function createEpoch(uint64 sellOpen, uint64 cutoff, uint64 close, uint64 reopen)
        external
        onlyOwner
        returns (uint32 epochId)
    {
        if (!(block.timestamp < sellOpen && sellOpen < cutoff && cutoff <= close && close < reopen)) revert BadEpoch();
        if (_epochs.length != 0 && sellOpen < _epochs[_epochs.length - 1].reopen) revert BadEpoch();
        Epoch memory e = Epoch(sellOpen, cutoff, close, reopen, reopen + VOID_DELAY);
        _epochs.push(e);
        epochId = uint32(_epochs.length - 1);
        emit EpochCreated(epochId, e);
    }

    /// @notice Post the rate card for (epoch, stock). Only once, only before sales open.
    function postRateCard(uint32 epochId, uint32 stockId, Band[] calldata bands) external onlyOwner {
        Epoch memory e = epoch(epochId);
        if (address(vaults[stockId]) == address(0)) revert UnknownStock(stockId);
        if (rateCardPosted[epochId][stockId] || block.timestamp >= e.sellOpen) revert RateCardLocked();
        for (uint256 i; i < bands.length; ++i) {
            Band calldata b = bands[i];
            if (!(b.upperBps <= BPS && b.lowerBps < b.upperBps && b.premiumBps > 0 && b.premiumBps < BPS)) {
                revert BadBand(i);
            }
            _rateCards[epochId][stockId].push(b);
        }
        rateCardPosted[epochId][stockId] = true;
        emit RateCardPosted(epochId, stockId, bands);
    }

    // ================================================================== buying

    function buy(uint32 epochId, uint32 stockId, uint8 bandId, uint128 notional, uint256 maxPremium)
        external
        nonReentrant
        returns (uint256 positionId)
    {
        (positionId,) = _buy(msg.sender, msg.sender, address(0), epochId, stockId, bandId, notional, maxPremium);
    }

    /// @notice Agent purchase under an owner-signed mandate. The position and the premium are
    ///         the owner's; the contract rejects anything outside the mandate.
    function buyFor(
        Mandate calldata m,
        bytes calldata signature,
        uint32 epochId,
        uint32 stockId,
        uint8 bandId,
        uint128 notional,
        uint256 maxPremium
    ) external nonReentrant returns (uint256 positionId) {
        if (msg.sender != m.agent) revert NotAgent();
        if (block.timestamp >= m.expiry) revert MandateExpired();
        if (m.nonce != mandateNonces[m.owner]) revert MandateRevoked();
        bytes32 digest = mandateDigest(m);
        if (!SignatureChecker.isValidSignatureNow(m.owner, digest, signature)) revert BadSignature();

        if (stockId >= 256 || (m.stockMask >> stockId) & 1 == 0) revert OutsideMandate();
        if (notional > m.maxNotional) revert OutsideMandate();
        Band memory b = _band(epochId, stockId, bandId);
        if (b.upperBps < m.minUpperBps || b.upperBps > m.maxUpperBps) revert OutsideMandate();

        uint256 premium;
        (positionId, premium) = _buy(m.owner, m.owner, msg.sender, epochId, stockId, bandId, notional, maxPremium);

        uint256 spent = mandatePremiumSpent[digest][epochId] + premium;
        if (spent > m.maxPremiumPerEpoch) revert OutsideMandate();
        mandatePremiumSpent[digest][epochId] = spent;
    }

    /// @notice Invalidate every mandate the caller has signed.
    function revokeMandates() external {
        uint256 n = ++mandateNonces[msg.sender];
        emit MandatesRevoked(msg.sender, n);
    }

    function _buy(
        address payer,
        address recipient,
        address agent,
        uint32 epochId,
        uint32 stockId,
        uint8 bandId,
        uint128 notional,
        uint256 maxPremium
    ) internal returns (uint256 positionId, uint256 premium) {
        Epoch memory e = epoch(epochId);
        if (block.timestamp < e.sellOpen || block.timestamp >= e.cutoff) revert SalesClosed();
        Band memory b = _band(epochId, stockId, bandId);
        if (notional < minNotional) revert NotionalTooSmall();

        premium = Math.mulDiv(notional, b.premiumBps, BPS, Math.Rounding.Ceil);
        if (premium > maxPremium) revert PremiumTooHigh(premium, maxPremium);
        uint256 maxPayout = Math.mulDiv(notional, b.upperBps - b.lowerBps, BPS);

        VesperaVault vault = vaults[stockId];
        uint256 assetsAfter = vault.totalAssets() + premium;
        uint256 cap = Math.mulDiv(assetsAfter, capBps, BPS);
        if (vault.locked() + maxPayout > cap) revert CapExceeded(vault.locked() + maxPayout, cap);

        usdc.safeTransferFrom(payer, address(vault), premium);
        vault.lock(maxPayout);

        positionId = nextPositionId++;
        _positions[positionId] = Position({
            epochId: epochId,
            stockId: stockId,
            bandId: bandId,
            status: PositionStatus.Open,
            notional: notional,
            premium: uint128(premium),
            maxPayout: uint128(maxPayout)
        });
        _books[epochId][stockId].openPositions += 1;
        stockOpenPositions[stockId] += 1;
        _safeMint(recipient, positionId);

        emit Bought(positionId, recipient, epochId, stockId, bandId, notional, premium, maxPayout, agent);
    }

    // ================================================================== prices (permissionless)

    /// @notice Record R: the last valid round with updatedAt <= close (rules §3).
    function recordReference(uint32 epochId, uint32 stockId, uint80 roundId) external {
        Epoch memory e = epoch(epochId);
        Book storage bk = _books[epochId][stockId];
        if (block.timestamp < e.close) revert TooEarly();
        if (block.timestamp >= e.voidAfter) revert TooLate();
        if (bk.status != BookStatus.None) revert WrongStatus(bk.status);

        (bool ok, int256 price, uint64 ts) = oracle.roundAt(stockId, roundId);
        if (!ok) revert RoundMissing(roundId);
        if (price <= 0) revert BadPrice();
        if (ts > e.close) revert NotLastBeforeClose();
        if (ts + MAX_REFERENCE_AGE < e.close) revert StaleReference();
        (bool nextOk,, uint64 nextTs) = oracle.roundAt(stockId, oracle.nextRoundId(stockId, roundId));
        if (nextOk && nextTs <= e.close) revert NotLastBeforeClose();

        bk.status = BookStatus.Referenced;
        bk.refPrice = price;
        bk.referenceRound = roundId;
        bk.multiplier0 = oracle.multiplier(stockId);
        emit ReferenceRecorded(epochId, stockId, roundId, price, bk.multiplier0);
    }

    /// @notice Record S: the first valid round with updatedAt >= reopen (rules §4). If the B20
    ///         multiplier changed since R was recorded, the book is voided instead (rules §7).
    function recordSettlement(uint32 epochId, uint32 stockId, uint80 roundId) external {
        Epoch memory e = epoch(epochId);
        Book storage bk = _books[epochId][stockId];
        if (block.timestamp < e.reopen) revert BeforeReopen();
        if (block.timestamp >= e.voidAfter) revert TooLate();
        if (bk.status != BookStatus.Referenced) revert WrongStatus(bk.status);

        (bool ok, int256 price, uint64 ts) = oracle.roundAt(stockId, roundId);
        if (!ok) revert RoundMissing(roundId);
        if (price <= 0) revert BadPrice();
        if (ts < e.reopen) revert NotFirstAfterReopen();
        (bool prevOk,, uint64 prevTs) = oracle.roundAt(stockId, oracle.prevRoundId(stockId, roundId));
        if (!prevOk || prevTs >= e.reopen) revert NotFirstAfterReopen();

        if (oracle.multiplier(stockId) != bk.multiplier0) {
            bk.status = BookStatus.Voided;
            emit BookVoided(epochId, stockId, "multiplier changed");
            return;
        }
        bk.status = BookStatus.Settled;
        bk.settlePrice = price;
        bk.settlementRound = roundId;
        emit SettlementRecorded(epochId, stockId, roundId, price);
    }

    /// @notice Void a book with no settlement by voidAfter (rules §6).
    function voidBook(uint32 epochId, uint32 stockId) external {
        Epoch memory e = epoch(epochId);
        Book storage bk = _books[epochId][stockId];
        if (block.timestamp < e.voidAfter) revert TooEarly();
        if (bk.status == BookStatus.Settled || bk.status == BookStatus.Voided) revert WrongStatus(bk.status);
        bk.status = BookStatus.Voided;
        emit BookVoided(epochId, stockId, "no valid settlement");
    }

    // ================================================================== redemption (permissionless)

    /// @notice Pay a resolved position to its current holder. Anyone may call.
    function redeem(uint256 positionId) public nonReentrant {
        Position storage p = _positions[positionId];
        address holder = _requireOwned(positionId);
        if (p.status != PositionStatus.Open) revert AlreadyRedeemed(positionId);
        Book storage bk = _books[p.epochId][p.stockId];
        VesperaVault vault = vaults[p.stockId];

        uint256 payout;
        uint256 refund;
        if (bk.status == BookStatus.Settled) {
            payout = payoutOf(positionId);
        } else if (bk.status == BookStatus.Voided) {
            refund = p.premium;
        } else {
            revert Unresolved();
        }

        p.status = PositionStatus.Redeemed;
        bk.openPositions -= 1;
        stockOpenPositions[p.stockId] -= 1;

        if (payout > 0) vault.payLocked(holder, payout);
        vault.release(p.maxPayout - payout);
        if (refund > 0) vault.payFree(holder, refund);

        emit Redeemed(positionId, holder, payout, refund);
    }

    function redeemMany(uint256[] calldata ids) external {
        for (uint256 i; i < ids.length; ++i) {
            redeem(ids[i]);
        }
    }

    // ================================================================== views

    /// payout = N * clamp((Ku - S) / R, 0, (Ku - Kl) / R), Ku = R*upper/BPS, Kl = R*lower/BPS
    function payoutOf(uint256 positionId) public view returns (uint256) {
        Position memory p = _positions[positionId];
        Book memory bk = _books[p.epochId][p.stockId];
        if (bk.status != BookStatus.Settled) return 0;
        Band memory b = _rateCards[p.epochId][p.stockId][p.bandId];
        uint256 r = uint256(bk.refPrice);
        uint256 s = uint256(bk.settlePrice);
        // Work in R * BPS units to avoid rounding the strikes.
        uint256 kuScaled = r * b.upperBps;
        uint256 sScaled = s * BPS;
        if (sScaled >= kuScaled) return 0;
        uint256 gap = kuScaled - sScaled;
        uint256 width = r * (b.upperBps - b.lowerBps);
        if (gap > width) gap = width;
        uint256 payout = Math.mulDiv(p.notional, gap, r * BPS);
        return payout > p.maxPayout ? p.maxPayout : payout;
    }

    function vaultFrozen(uint32 stockId) external view returns (bool) {
        if (stockOpenPositions[stockId] != 0) return true;
        uint256 n = _epochs.length;
        if (n == 0) return false;
        Epoch memory e = _epochs[n - 1];
        return rateCardPosted[uint32(n - 1)][stockId] && block.timestamp >= e.sellOpen && block.timestamp < e.cutoff;
    }

    function epoch(uint32 epochId) public view returns (Epoch memory) {
        if (epochId >= _epochs.length) revert UnknownEpoch(epochId);
        return _epochs[epochId];
    }

    function epochCount() external view returns (uint256) {
        return _epochs.length;
    }

    function rateCard(uint32 epochId, uint32 stockId) external view returns (Band[] memory) {
        return _rateCards[epochId][stockId];
    }

    function book(uint32 epochId, uint32 stockId) external view returns (Book memory) {
        return _books[epochId][stockId];
    }

    function position(uint256 positionId) external view returns (Position memory) {
        return _positions[positionId];
    }

    function mandateDigest(Mandate calldata m) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    MANDATE_TYPEHASH,
                    m.owner,
                    m.agent,
                    m.stockMask,
                    m.maxPremiumPerEpoch,
                    m.maxNotional,
                    m.minUpperBps,
                    m.maxUpperBps,
                    m.expiry,
                    m.nonce
                )
            )
        );
    }

    function _band(uint32 epochId, uint32 stockId, uint8 bandId) internal view returns (Band memory) {
        if (!rateCardPosted[epochId][stockId]) revert NoRateCard();
        Band[] storage bands = _rateCards[epochId][stockId];
        if (bandId >= bands.length) revert BadBandId(bandId);
        return bands[bandId];
    }
}
