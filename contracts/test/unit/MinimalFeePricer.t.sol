// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MinimalFeePricer} from "../../src/MinimalFeePricer.sol";

contract MinimalFeePricerTest is Test {
    event PricerParams(uint256 minFeeBps, uint256 maxFeeBps, uint256 lowICR, uint256 highICR);

    uint256 internal constant MIN_BPS = 100; // 1%
    uint256 internal constant MAX_BPS = 500; // 5%
    uint256 internal constant LOW = 1.1e18; // MCR
    uint256 internal constant HIGH = 1.5e18; // CCR

    MinimalFeePricer internal pricer;

    function setUp() public {
        pricer = new MinimalFeePricer(MIN_BPS, MAX_BPS, LOW, HIGH);
    }

    function test_constructor_setsParamsAndEmitsCommitment() public {
        vm.expectEmit(false, false, false, true);
        emit PricerParams(MIN_BPS, MAX_BPS, LOW, HIGH);
        MinimalFeePricer p = new MinimalFeePricer(MIN_BPS, MAX_BPS, LOW, HIGH);
        assertEq(p.minFeeBps(), MIN_BPS);
        assertEq(p.maxFeeBps(), MAX_BPS);
        assertEq(p.lowICR(), LOW);
        assertEq(p.highICR(), HIGH);
    }

    function test_constructor_revertsOnInvalidParams() public {
        vm.expectRevert(MinimalFeePricer.InvalidParams.selector);
        new MinimalFeePricer(MAX_BPS + 1, MAX_BPS, LOW, HIGH); // min > max
        vm.expectRevert(MinimalFeePricer.InvalidParams.selector);
        new MinimalFeePricer(MIN_BPS, 10_001, LOW, HIGH); // max > 100%
        vm.expectRevert(MinimalFeePricer.InvalidParams.selector);
        new MinimalFeePricer(MIN_BPS, MAX_BPS, HIGH, HIGH); // low == high
        vm.expectRevert(MinimalFeePricer.InvalidParams.selector);
        new MinimalFeePricer(MIN_BPS, MAX_BPS, HIGH, LOW); // low > high
    }

    function test_feeBps_endpoints() public view {
        assertEq(pricer.feeBps(HIGH, 0, 0), MIN_BPS);
        assertEq(pricer.feeBps(HIGH + 1e18, 0, 0), MIN_BPS);
        assertEq(pricer.feeBps(LOW, 0, 0), MAX_BPS);
        assertEq(pricer.feeBps(1e18, 0, 0), MAX_BPS); // below MCR
        assertEq(pricer.feeBps(0, 0, 0), MAX_BPS);
    }

    function test_feeBps_linearMidpoint() public view {
        assertEq(pricer.feeBps(1.3e18, 0, 0), 300); // halfway -> 3%
    }

    function test_feeBps_ignoresSizeAndTcrInWave1() public view {
        assertEq(pricer.feeBps(1.3e18, 0, 0), pricer.feeBps(1.3e18, 1e18, 1.2e18));
    }

    function testFuzz_feeBps_withinBounds(uint256 icr, uint256 size, uint256 tcr) public view {
        uint256 fee = pricer.feeBps(icr, size, tcr);
        assertGe(fee, MIN_BPS);
        assertLe(fee, MAX_BPS);
    }

    function testFuzz_feeBps_monotonicInRisk(uint256 icrA, uint256 icrB) public view {
        icrA = bound(icrA, 0, 10e18);
        icrB = bound(icrB, icrA, 10e18); // icrB >= icrA: less risky
        assertGe(pricer.feeBps(icrA, 0, 0), pricer.feeBps(icrB, 0, 0));
    }
}
