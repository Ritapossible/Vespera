// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Chainlink V3 aggregator (proxy) interface.
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80 roundId_, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice Subset of the B20 token standard used by Vespera (docs.base.org, B20 multiplier).
interface IB20Multiplier {
    function multiplier() external view returns (uint256);
}
