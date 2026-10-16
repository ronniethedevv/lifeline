// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISortedTroves
/// @notice Minimal MUSD SortedTroves interface. Signature copied from the pinned
///         matsnet ABI (deployments/abis/matsnet/SortedTroves.json, mezo-org/musd commit aa25fd6).
interface ISortedTroves {
    /// @notice Exact insert position for a nominal CR, starting from approximate neighbours.
    /// @param _NICR Nominal collateral ratio // 1e20 NICR scale (see musd LiquityMath)
    /// @param _prevId Approximate upper neighbour
    /// @param _nextId Approximate lower neighbour
    /// @return Upper hint
    /// @return Lower hint
    function findInsertPosition(uint256 _NICR, address _prevId, address _nextId)
        external
        view
        returns (address, address);
}
