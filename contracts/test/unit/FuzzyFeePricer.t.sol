// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FuzzyFeePricer} from "../../src/FuzzyFeePricer.sol";

contract FuzzyFeePricerTest is Test {
    FuzzyFeePricer internal pricer;

    uint256 internal constant MIN_FEE = 100; // 1%
    uint256 internal constant MAX_FEE = 1000; // 10%

    // Low/Med/High breakpoints per input (1e18 = 100%).
    uint256[3] internal icrK = [uint256(1.1e18), 1.3e18, 1.5e18];
    uint256[3] internal sizeK = [uint256(0.1e18), 0.3e18, 0.5e18];
    uint256[3] internal tcrK = [uint256(1.5e18), 1.65e18, 1.8e18];

    /// @dev A monotonic 27-cell table: risk = (2-i)[ICR] + j[size] + (2-k)[TCR] in [0,6].
    function _rules() internal pure returns (uint256[27] memory r) {
        for (uint256 i; i < 3; ++i) {
            for (uint256 j; j < 3; ++j) {
                for (uint256 k; k < 3; ++k) {
                    uint256 risk = (2 - i) + j + (2 - k);
                    r[i * 9 + j * 3 + k] = MIN_FEE + ((MAX_FEE - MIN_FEE) * risk) / 6;
                }
            }
        }
    }

    function setUp() public {
        pricer = new FuzzyFeePricer(MIN_FEE, MAX_FEE, icrK, sizeK, tcrK, _rules());
    }

    // --- unit ---

    function test_feeBps_safestCorner() public view {
        // high ICR, tiny size, high TCR -> lowest risk -> minFee
        assertEq(pricer.feeBps(2e18, 0, 2e18), MIN_FEE);
    }

    function test_feeBps_riskiestCorner() public view {
        // low ICR, huge size, low TCR -> highest risk -> maxFee
        assertEq(pricer.feeBps(1e18, 1e18, 1e18), MAX_FEE);
    }

    function test_feeBps_allMedium() public view {
        // every input at its mid knot -> only the Med/Med/Med rule fires
        assertEq(pricer.feeBps(1.3e18, 0.3e18, 1.65e18), _rules()[1 * 9 + 1 * 3 + 1]);
    }

    function test_constructor_revertsOnMinGtMax() public {
        vm.expectRevert(FuzzyFeePricer.InvalidParams.selector);
        new FuzzyFeePricer(MAX_FEE, MIN_FEE, icrK, sizeK, tcrK, _rules());
    }

    function test_constructor_revertsOnUnorderedKnots() public {
        uint256[3] memory bad = [uint256(1.5e18), 1.3e18, 1.1e18];
        vm.expectRevert(FuzzyFeePricer.InvalidParams.selector);
        new FuzzyFeePricer(MIN_FEE, MAX_FEE, bad, sizeK, tcrK, _rules());
    }

    function test_constructor_revertsOnNonMonotonicRules() public {
        uint256[27] memory r = _rules();
        r[2 * 9 + 0 * 3 + 2] = MAX_FEE; // make the safest corner the dearest -> not monotonic
        vm.expectRevert(FuzzyFeePricer.InvalidParams.selector);
        new FuzzyFeePricer(MIN_FEE, MAX_FEE, icrK, sizeK, tcrK, r);
    }

    function test_constructor_revertsOnRuleOutOfRange() public {
        uint256[27] memory r = _rules();
        r[0] = MAX_FEE + 1; // above maxFee
        vm.expectRevert(FuzzyFeePricer.InvalidParams.selector);
        new FuzzyFeePricer(MIN_FEE, MAX_FEE, icrK, sizeK, tcrK, r);
    }

    // --- fuzz (foundry.toml: 1000 runs) ---

    function testFuzz_feeWithinBounds(uint256 icr, uint256 size, uint256 tcr) public view {
        icr = bound(icr, 1e18, 5e18);
        size = bound(size, 0, 2e18);
        tcr = bound(tcr, 1e18, 5e18);
        uint256 f = pricer.feeBps(icr, size, tcr);
        assertGe(f, MIN_FEE);
        assertLe(f, MAX_FEE);
    }

    function testFuzz_monotonicInICR(uint256 a, uint256 b, uint256 size, uint256 tcr) public view {
        a = bound(a, 1e18, 5e18);
        b = bound(b, 1e18, 5e18);
        if (a > b) (a, b) = (b, a); // a <= b
        size = bound(size, 0, 2e18);
        tcr = bound(tcr, 1e18, 5e18);
        // higher ICR is safer -> fee non-increasing
        assertGe(pricer.feeBps(a, size, tcr), pricer.feeBps(b, size, tcr));
    }

    function testFuzz_monotonicInSize(uint256 icr, uint256 a, uint256 b, uint256 tcr) public view {
        a = bound(a, 0, 2e18);
        b = bound(b, 0, 2e18);
        if (a > b) (a, b) = (b, a);
        icr = bound(icr, 1e18, 5e18);
        tcr = bound(tcr, 1e18, 5e18);
        // a bigger rescue is riskier -> fee non-decreasing
        assertLe(pricer.feeBps(icr, a, tcr), pricer.feeBps(icr, b, tcr));
    }

    function testFuzz_monotonicInTCR(uint256 icr, uint256 size, uint256 a, uint256 b) public view {
        a = bound(a, 1e18, 5e18);
        b = bound(b, 1e18, 5e18);
        if (a > b) (a, b) = (b, a);
        icr = bound(icr, 1e18, 5e18);
        size = bound(size, 0, 2e18);
        // a healthier system is safer -> fee non-increasing
        assertGe(pricer.feeBps(icr, size, a), pricer.feeBps(icr, size, b));
    }

    // --- gas ---

    function test_gas_feeBps_underLimit() public view {
        uint256 g0 = gasleft();
        pricer.feeBps(1.25e18, 0.25e18, 1.6e18);
        uint256 used = g0 - gasleft();
        assertLt(used, 150_000);
    }
}
