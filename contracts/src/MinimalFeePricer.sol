// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IFeePricer} from "./interfaces/IFeePricer.sol";

/// @title MinimalFeePricer
/// @notice Wave 1 rescue pricer: fee falls linearly from `maxFeeBps` at `lowICR` (liquidation
///         line) to `minFeeBps` at `highICR`, clamped outside that range. Riskier vaults pay more.
/// @dev Uses only the ICR input; size and TCR are accepted for interface compatibility and used by
///      the Wave 2 FuzzyFeePricer (T1.4). Parameters are fixed at deployment and emitted as the
///      on-chain commitment.
contract MinimalFeePricer is IFeePricer {
    error InvalidParams();

    /// @notice Emitted once at deployment: the pricing rule.
    /// @param minFeeBps Fee at or above highICR
    /// @param maxFeeBps Fee at or below lowICR
    /// @param lowICR ICR where the fee is highest // 1e18 = 100%
    /// @param highICR ICR where the fee is lowest // 1e18 = 100%
    event PricerParams(uint256 minFeeBps, uint256 maxFeeBps, uint256 lowICR, uint256 highICR);

    uint256 internal constant MAX_BPS = 10_000;

    /// @notice Lowest fee, in basis points.
    uint256 public immutable minFeeBps;
    /// @notice Highest fee, in basis points.
    uint256 public immutable maxFeeBps;
    /// @notice ICR at which the fee reaches its maximum // 1e18 = 100%
    uint256 public immutable lowICR;
    /// @notice ICR at which the fee reaches its minimum // 1e18 = 100%
    uint256 public immutable highICR;

    /// @param _minFeeBps Lowest fee (bps)
    /// @param _maxFeeBps Highest fee (bps), <= 10,000
    /// @param _lowICR ICR of maximum fee // 1e18 = 100%
    /// @param _highICR ICR of minimum fee, > _lowICR // 1e18 = 100%
    constructor(uint256 _minFeeBps, uint256 _maxFeeBps, uint256 _lowICR, uint256 _highICR) {
        if (_minFeeBps > _maxFeeBps || _maxFeeBps > MAX_BPS || _lowICR >= _highICR) revert InvalidParams();
        minFeeBps = _minFeeBps;
        maxFeeBps = _maxFeeBps;
        lowICR = _lowICR;
        highICR = _highICR;
        emit PricerParams(_minFeeBps, _maxFeeBps, _lowICR, _highICR);
    }

    /// @inheritdoc IFeePricer
    function feeBps(uint256 icr, uint256, uint256) external view returns (uint256) {
        if (icr >= highICR) return minFeeBps;
        if (icr <= lowICR) return maxFeeBps;
        return maxFeeBps - (maxFeeBps - minFeeBps) * (icr - lowICR) / (highICR - lowICR);
    }
}
