// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IVesperaMarketPhase {
    /// @return true while LPs must not enter or exit this stock's vault
    function vaultFrozen(uint32 stockId) external view returns (bool);
}

/// @title VesperaVault
/// @notice Per-stock USDC writer vault (ERC-4626). Writers earn premiums and pay settlements.
///         Collateral backing sold positions is locked and cannot leave. Deposits and
///         withdrawals are closed whenever the market says the vault is frozen (sales open, or
///         any position outstanding), so no LP can enter or exit with knowledge of a weekend.
contract VesperaVault is ERC4626 {
    using SafeERC20 for IERC20;

    address public immutable market;
    uint32 public immutable stockId;
    uint256 public locked;

    error OnlyMarket();
    error Frozen();
    error InsufficientFree(uint256 requested, uint256 free);

    event Locked(uint256 amount, uint256 totalLocked);
    event Released(uint256 amount, uint256 totalLocked);
    event Paid(address indexed to, uint256 amount);

    modifier onlyMarket() {
        if (msg.sender != market) revert OnlyMarket();
        _;
    }

    constructor(IERC20 usdc, address market_, uint32 stockId_, string memory name_, string memory symbol_)
        ERC4626(usdc)
        ERC20(name_, symbol_)
    {
        market = market_;
        stockId = stockId_;
    }

    // ---------------------------------------------------------------- market hooks

    function freeAssets() public view returns (uint256) {
        uint256 bal = totalAssets();
        return bal > locked ? bal - locked : 0;
    }

    function lock(uint256 amount) external onlyMarket {
        uint256 free = freeAssets();
        if (amount > free) revert InsufficientFree(amount, free);
        locked += amount;
        emit Locked(amount, locked);
    }

    function release(uint256 amount) external onlyMarket {
        locked -= amount;
        emit Released(amount, locked);
    }

    /// @notice Pay `amount` out of locked collateral (settlement) and release it.
    function payLocked(address to, uint256 amount) external onlyMarket {
        locked -= amount;
        IERC20(asset()).safeTransfer(to, amount);
        emit Paid(to, amount);
    }

    /// @notice Refund a premium from free assets (void path). Premiums were added to the vault
    ///         at purchase and the vault is frozen until positions resolve, so they are present.
    function payFree(address to, uint256 amount) external onlyMarket {
        uint256 free = freeAssets();
        if (amount > free) revert InsufficientFree(amount, free);
        IERC20(asset()).safeTransfer(to, amount);
        emit Paid(to, amount);
    }

    // ---------------------------------------------------------------- LP gating

    function _frozen() internal view returns (bool) {
        return locked != 0 || IVesperaMarketPhase(market).vaultFrozen(stockId);
    }

    function maxDeposit(address) public view override returns (uint256) {
        return _frozen() ? 0 : type(uint256).max;
    }

    function maxMint(address) public view override returns (uint256) {
        return _frozen() ? 0 : type(uint256).max;
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        if (_frozen()) return 0;
        return super.maxWithdraw(owner);
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        if (_frozen()) return 0;
        return super.maxRedeem(owner);
    }

    /// Offset shares to blunt first-depositor inflation attacks.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }
}
