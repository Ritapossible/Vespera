// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IOracleAdapter} from "./interfaces/IOracleAdapter.sol";
import {AggregatorV3Interface, IB20Multiplier} from "./interfaces/IExternal.sol";

/// @title ChainlinkAdapter
/// @notice Maps stock ids to a Chainlink feed and a B20 token. A stock's feed and token are
///         set once and can never be changed, so no one can swap the price source under open
///         positions.
contract ChainlinkAdapter is IOracleAdapter, Ownable {
    struct Source {
        AggregatorV3Interface feed;
        IB20Multiplier token;
    }

    mapping(uint32 => Source) public sources;

    error SourceAlreadySet(uint32 stockId);
    error UnknownStock(uint32 stockId);
    error PhaseBoundary(uint80 roundId);

    event SourceSet(uint32 indexed stockId, address feed, address token);

    constructor(address owner_) Ownable(owner_) {}

    function setSource(uint32 stockId, address feed, address token) external onlyOwner {
        if (address(sources[stockId].feed) != address(0)) revert SourceAlreadySet(stockId);
        sources[stockId] = Source(AggregatorV3Interface(feed), IB20Multiplier(token));
        emit SourceSet(stockId, feed, token);
    }

    function _src(uint32 stockId) internal view returns (Source memory s) {
        s = sources[stockId];
        if (address(s.feed) == address(0)) revert UnknownStock(stockId);
    }

    function roundAt(uint32 stockId, uint80 roundId)
        external
        view
        returns (bool exists, int256 price, uint64 updatedAt)
    {
        Source memory s = _src(stockId);
        try s.feed.getRoundData(roundId) returns (uint80, int256 answer, uint256, uint256 ts, uint80) {
            if (ts == 0) return (false, 0, 0);
            return (true, answer, uint64(ts));
        } catch {
            return (false, 0, 0);
        }
    }

    /// Chainlink proxy round ids are (phaseId << 64) | aggregatorRoundId.
    function nextRoundId(uint32, uint80 roundId) external pure returns (uint80) {
        return roundId + 1;
    }

    function prevRoundId(uint32, uint80 roundId) external pure returns (uint80) {
        if (uint64(roundId) <= 1) revert PhaseBoundary(roundId);
        return roundId - 1;
    }

    function multiplier(uint32 stockId) external view returns (uint256) {
        Source memory s = _src(stockId);
        if (address(s.token) == address(0)) return 1e18;
        return s.token.multiplier();
    }
}
