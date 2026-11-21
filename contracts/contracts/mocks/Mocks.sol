// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Test USDC (6 decimals), freely mintable. Testnet / local only.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Chainlink-style aggregator whose rounds are pushed by the owner. Used in tests, in
///         the replay harness and on Base Sepolia (where no tokenized-stock feeds exist).
///         Round ids follow the proxy format (phaseId << 64) | n, with phaseId = 1.
contract MockAggregator is Ownable {
    struct Round {
        int256 answer;
        uint64 updatedAt;
    }

    uint8 public immutable decimals;
    uint80 internal constant PHASE = uint80(1) << 64;
    uint64 public latest; // aggregator round counter
    mapping(uint64 => Round) internal _rounds;

    error NoData();

    event RoundPushed(uint80 roundId, int256 answer, uint64 updatedAt);

    constructor(uint8 decimals_, address owner_) Ownable(owner_) {
        decimals = decimals_;
    }

    /// @param updatedAt explicit timestamp so the replay harness can reproduce history
    function pushRound(int256 answer, uint64 updatedAt) external onlyOwner returns (uint80 roundId) {
        if (latest != 0) require(updatedAt >= _rounds[latest].updatedAt, "non-monotonic");
        latest += 1;
        _rounds[latest] = Round(answer, updatedAt);
        roundId = PHASE | latest;
        emit RoundPushed(roundId, answer, updatedAt);
    }

    function getRoundData(uint80 roundId) public view returns (uint80, int256, uint256, uint256, uint80) {
        if (roundId >> 64 != 1) revert NoData();
        uint64 n = uint64(roundId);
        if (n == 0 || n > latest) revert NoData();
        Round memory r = _rounds[n];
        return (roundId, r.answer, r.updatedAt, r.updatedAt, roundId);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        if (latest == 0) revert NoData();
        return getRoundData(PHASE | latest);
    }
}

/// @notice Minimal B20-like token exposing `multiplier()` (WAD).
contract MockB20 is ERC20, Ownable {
    uint256 public multiplier = 1e18;

    constructor(string memory n, string memory s, address owner_) ERC20(n, s) Ownable(owner_) {}

    function setMultiplier(uint256 m) external onlyOwner {
        multiplier = m;
    }
}
