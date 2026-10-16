// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IFeePricer
/// @notice Prices a rescue. Wave 1: MinimalFeePricer; Wave 2: FuzzyFeePricer (T1.4) and GNPricer.
interface IFeePricer {
    /// @notice Rescue fee for a vault in the given state.
    /// @param icr Vault ICR before the rescue // 1e18 = 100%
    /// @param sizeRatio Rescue size / vault collateral value // 1e18 = 100%
    /// @param tcr System TCR // 1e18 = 100%
    /// @return Fee in basis points of the repaid amount
    function feeBps(uint256 icr, uint256 sizeRatio, uint256 tcr) external view returns (uint256);
}
