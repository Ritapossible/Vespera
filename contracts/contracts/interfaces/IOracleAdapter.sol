// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Price source abstraction. The market never talks to a feed directly.
interface IOracleAdapter {
    /// @return exists  false if the round does not exist (yet)
    /// @return price   feed answer (feed decimals); only meaningful when exists
    /// @return updatedAt round timestamp
    function roundAt(uint32 stockId, uint80 roundId)
        external
        view
        returns (bool exists, int256 price, uint64 updatedAt);

    /// @notice The round immediately after `roundId` in the same feed phase.
    function nextRoundId(uint32 stockId, uint80 roundId) external view returns (uint80);

    /// @notice The round immediately before `roundId`. Reverts at a phase boundary.
    function prevRoundId(uint32 stockId, uint80 roundId) external view returns (uint80);

    /// @notice Current B20 share multiplier of the stock token (1e18 = 1x).
    function multiplier(uint32 stockId) external view returns (uint256);
}
