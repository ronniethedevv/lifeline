// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IFeePricer} from "./interfaces/IFeePricer.sol";

/// @title FuzzyFeePricer
/// @notice Zero-order Sugeno fuzzy inference pricer over three risk inputs — ICR, rescue size ratio,
///         and system TCR. Each input maps to Low/Med/High triangular memberships that form a
///         partition of unity, so the 27 rule firing-strengths sum to 1 and the fee is a weighted
///         sum of 27 committed constant consequents (equivalently, trilinear interpolation over a
///         3x3x3 fee grid). No `exp`, no division by a firing-strength sum.
/// @dev Drop-in `IFeePricer` (same signature as MinimalFeePricer). Fixed-point 1e18 (1e18 = 100%).
///      Breakpoints and the rule table are fixed at deployment, validated monotonic in risk, and
///      emitted as the on-chain commitment.
contract FuzzyFeePricer is IFeePricer {
    error InvalidParams();

    /// @notice Emitted once at deployment: the committed breakpoints and 27-cell rule table.
    event PricerCommitted(
        uint256 minFeeBps,
        uint256 maxFeeBps,
        uint256[3] icrKnots,
        uint256[3] sizeKnots,
        uint256[3] tcrKnots,
        uint256[27] rules
    );

    uint256 internal constant ONE = 1e18;
    uint256 internal constant MAX_BPS = 10_000;

    /// @notice Lowest fee (bps), at the lowest-risk corner.
    uint256 public immutable minFeeBps;
    /// @notice Highest fee (bps), at the highest-risk corner.
    uint256 public immutable maxFeeBps;

    // Low/Med/High breakpoints per input (1e18 = 100%): Low shoulder <= lo, Med peak at mid, High shoulder >= hi.
    uint256 public immutable icrLo;
    uint256 public immutable icrMid;
    uint256 public immutable icrHi;
    uint256 public immutable sizeLo;
    uint256 public immutable sizeMid;
    uint256 public immutable sizeHi;
    uint256 public immutable tcrLo;
    uint256 public immutable tcrMid;
    uint256 public immutable tcrHi;

    /// @notice The 27 constant fee consequents (bps), indexed `i*9 + j*3 + k` for ICR/size/TCR levels 0..2.
    uint256[27] public rules;

    /// @param _minFeeBps Lowest fee (bps)
    /// @param _maxFeeBps Highest fee (bps), <= 10,000
    /// @param icrKnots Low/Med/High ICR breakpoints, strictly increasing // 1e18 = 100%
    /// @param sizeKnots Low/Med/High size-ratio breakpoints, strictly increasing // 1e18 = 100%
    /// @param tcrKnots Low/Med/High TCR breakpoints, strictly increasing // 1e18 = 100%
    /// @param _rules 27 consequents in [minFee, maxFee], monotonic in risk (fee rises as ICR/TCR fall and size grows)
    constructor(
        uint256 _minFeeBps,
        uint256 _maxFeeBps,
        uint256[3] memory icrKnots,
        uint256[3] memory sizeKnots,
        uint256[3] memory tcrKnots,
        uint256[27] memory _rules
    ) {
        if (_minFeeBps > _maxFeeBps || _maxFeeBps > MAX_BPS) revert InvalidParams();
        if (!(icrKnots[0] < icrKnots[1] && icrKnots[1] < icrKnots[2])) revert InvalidParams();
        if (!(sizeKnots[0] < sizeKnots[1] && sizeKnots[1] < sizeKnots[2])) revert InvalidParams();
        if (!(tcrKnots[0] < tcrKnots[1] && tcrKnots[1] < tcrKnots[2])) revert InvalidParams();

        // Consequents must stay in [min,max] and be monotonic in risk: fee is non-increasing as ICR
        // rises (index i) and as TCR rises (index k), and non-decreasing as rescue size grows (index j).
        for (uint256 i; i < 3; ++i) {
            for (uint256 j; j < 3; ++j) {
                for (uint256 k; k < 3; ++k) {
                    uint256 c = _rules[i * 9 + j * 3 + k];
                    if (c < _minFeeBps || c > _maxFeeBps) revert InvalidParams();
                    if (i < 2 && c < _rules[(i + 1) * 9 + j * 3 + k]) revert InvalidParams();
                    if (j < 2 && c > _rules[i * 9 + (j + 1) * 3 + k]) revert InvalidParams();
                    if (k < 2 && c < _rules[i * 9 + j * 3 + (k + 1)]) revert InvalidParams();
                }
            }
        }

        minFeeBps = _minFeeBps;
        maxFeeBps = _maxFeeBps;
        icrLo = icrKnots[0];
        icrMid = icrKnots[1];
        icrHi = icrKnots[2];
        sizeLo = sizeKnots[0];
        sizeMid = sizeKnots[1];
        sizeHi = sizeKnots[2];
        tcrLo = tcrKnots[0];
        tcrMid = tcrKnots[1];
        tcrHi = tcrKnots[2];
        rules = _rules;

        emit PricerCommitted(_minFeeBps, _maxFeeBps, icrKnots, sizeKnots, tcrKnots, _rules);
    }

    /// @inheritdoc IFeePricer
    function feeBps(uint256 icr, uint256 sizeRatio, uint256 tcr) external view returns (uint256) {
        uint256[3] memory mi = _memberships(icr, icrLo, icrMid, icrHi);
        uint256[3] memory mj = _memberships(sizeRatio, sizeLo, sizeMid, sizeHi);
        uint256[3] memory mk = _memberships(tcr, tcrLo, tcrMid, tcrHi);

        uint256 acc; // Σ mi·mj·mk·c, scaled by 1e54 (three 1e18 memberships)
        for (uint256 i; i < 3; ++i) {
            for (uint256 j; j < 3; ++j) {
                uint256 mij = mi[i] * mj[j]; // 1e36
                for (uint256 k; k < 3; ++k) {
                    acc += mij * mk[k] * rules[i * 9 + j * 3 + k];
                }
            }
        }
        uint256 fee = acc / (ONE * ONE * ONE); // de-scale by 1e54

        // Holds by construction (consequents in range, memberships partition to 1); clamp defensively.
        if (fee < minFeeBps) return minFeeBps;
        if (fee > maxFeeBps) return maxFeeBps;
        return fee;
    }

    /// @dev Low/Med/High membership degrees (each 1e18, summing to exactly 1e18) for `x` over its knots.
    function _memberships(uint256 x, uint256 lo, uint256 mid, uint256 hi) internal pure returns (uint256[3] memory m) {
        if (x <= lo) {
            m[0] = ONE;
        } else if (x <= mid) {
            uint256 up = ((x - lo) * ONE) / (mid - lo);
            m[1] = up;
            m[0] = ONE - up;
        } else if (x <= hi) {
            uint256 up = ((x - mid) * ONE) / (hi - mid);
            m[2] = up;
            m[1] = ONE - up;
        } else {
            m[2] = ONE;
        }
    }
}
