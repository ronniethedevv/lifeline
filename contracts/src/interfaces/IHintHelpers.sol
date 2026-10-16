// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IHintHelpers
/// @notice Minimal MUSD HintHelpers interface. Signature copied from the pinned
///         matsnet ABI (deployments/abis/matsnet/HintHelpers.json, mezo-org/musd commit aa25fd6).
interface IHintHelpers {
    /// @notice Finds a trove whose nominal CR is close to `_CR`, as a starting hint.
    /// @param _CR Target nominal collateral ratio // 1e20 NICR scale (see musd LiquityMath)
    /// @param _numTrials Random samples to take (more = closer hint, more gas)
    /// @param _inputRandomSeed Seed for sampling
    /// @return hintAddress Trove owner to use as hint
    /// @return diff Absolute NICR difference from `_CR`
    /// @return latestRandomSeed Seed to pass to a follow-up call
    function getApproxHint(uint256 _CR, uint256 _numTrials, uint256 _inputRandomSeed)
        external
        view
        returns (address hintAddress, uint256 diff, uint256 latestRandomSeed);
}
