// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPriceFeed
/// @notice Minimal MUSD PriceFeed interface. Signature copied from the pinned
///         matsnet ABI (deployments/abis/matsnet/PriceFeed.json, mezo-org/musd commit aa25fd6).
interface IPriceFeed {
    /// @notice Current BTC price in MUSD.
    /// @return Price // 1e18
    function fetchPrice() external view returns (uint256);
}
