// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {RescueMarket} from "../../src/RescueMarket.sol";
import {MarketFixture} from "./utils/MarketFixture.sol";

/// @notice T1.5: provider deposits/withdrawals and share math.
contract RescueMarketTest is MarketFixture {
    event Deposited(address indexed provider, uint256 assets, uint256 shares);
    event Withdrawn(address indexed provider, uint256 shares, uint256 musdOut, uint256 btcOut);

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal attacker = makeAddr("attacker");

    uint256 internal constant MAX_AMOUNT = 1e30; // 1e12 MUSD
    uint256 internal constant VIRTUAL_SHARES = 1e3;

    function _withdrawAll(address who) internal returns (uint256 assets) {
        uint256 shares = market.sharesOf(who);
        if (shares == 0 || market.previewWithdraw(shares) == 0) return 0;
        vm.prank(who);
        (assets,) = market.withdraw(shares);
    }

    // ------------------------------------------------------------ constructor

    function test_constructor_setsMusd() public view {
        assertEq(address(market.musd()), address(musd));
        assertEq(market.totalAssets(), 0);
        assertEq(market.totalShares(), 0);
    }

    // ------------------------------------------------------------ deposit

    function test_deposit_firstDepositMintsSharesAndEmits() public {
        _fund(alice, 1000e18);
        uint256 expected = market.previewDeposit(1000e18);
        assertEq(expected, 1000e18 * VIRTUAL_SHARES);

        vm.expectEmit(true, false, false, true, address(market));
        emit Deposited(alice, 1000e18, expected);
        vm.prank(alice);
        uint256 shares = market.deposit(1000e18);

        assertEq(shares, expected);
        assertEq(market.sharesOf(alice), shares);
        assertEq(market.totalShares(), shares);
        assertEq(market.totalAssets(), 1000e18);
        assertEq(musd.balanceOf(address(market)), 1000e18);
        assertEq(musd.balanceOf(alice), 0);
    }

    function test_deposit_laterDepositAtUnchangedPrice() public {
        uint256 a = _deposit(alice, 1000e18);
        uint256 b = _deposit(bob, 500e18);
        assertEq(b, a / 2);
        assertEq(market.totalAssets(), 1500e18);
    }

    function test_deposit_afterFeesMintsFewerShares() public {
        uint256 a = _deposit(alice, 1000e18);
        _accrue(1000e18); // share price doubles
        uint256 b = _deposit(bob, 1000e18);
        assertApproxEqRel(b, a / 2, 1e3); // within 1e-15: virtual shares shift the price negligibly
    }

    function test_deposit_revertsOnZero() public {
        vm.prank(alice);
        vm.expectRevert(RescueMarket.ZeroAmount.selector);
        market.deposit(0);
    }

    function test_deposit_revertsWhenZeroSharesMinted() public {
        _deposit(alice, 1);
        _accrue(1e24); // 1 share now worth far more than 1 wei
        _fund(bob, 1);
        vm.prank(bob);
        vm.expectRevert(RescueMarket.ZeroShares.selector);
        market.deposit(1);
    }

    function test_deposit_revertsWithoutApproval() public {
        deal(address(musd), alice, 100e18, true);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(market), 0, 100e18)
        );
        market.deposit(100e18);
    }

    function test_deposit_revertsWithoutBalance() public {
        vm.prank(alice);
        musd.approve(address(market), 100e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 0, 100e18));
        market.deposit(100e18);
    }

    // ------------------------------------------------------------ withdraw

    function test_withdraw_fullReturnsDepositAndEmits() public {
        uint256 shares = _deposit(alice, 1000e18);
        uint256 expected = market.previewWithdraw(shares);
        assertEq(expected, 1000e18);

        vm.expectEmit(true, false, false, true, address(market));
        emit Withdrawn(alice, shares, 1000e18, 0);
        vm.prank(alice);
        (uint256 assets,) = market.withdraw(shares);

        assertEq(assets, 1000e18);
        assertEq(musd.balanceOf(alice), 1000e18);
        assertEq(market.sharesOf(alice), 0);
        assertEq(market.totalShares(), 0);
        assertEq(market.totalAssets(), 0);
    }

    function test_withdraw_partial() public {
        uint256 shares = _deposit(alice, 1000e18);
        vm.prank(alice);
        (uint256 assets,) = market.withdraw(shares / 4);
        assertEq(assets, 250e18);
        assertEq(market.sharesOf(alice), shares - shares / 4);
        assertEq(market.totalAssets(), 750e18);
    }

    function test_withdraw_includesAccruedFees() public {
        _deposit(alice, 1000e18);
        _deposit(bob, 1000e18);
        _accrue(200e18);
        assertApproxEqAbs(_withdrawAll(alice), 1100e18, 1);
        assertApproxEqAbs(_withdrawAll(bob), 1100e18, 1);
    }

    function test_withdraw_revertsOnZero() public {
        _deposit(alice, 1000e18);
        vm.prank(alice);
        vm.expectRevert(RescueMarket.ZeroAmount.selector);
        market.withdraw(0);
    }

    function test_withdraw_revertsAboveBalance() public {
        uint256 shares = _deposit(alice, 1000e18);
        vm.prank(alice);
        vm.expectRevert(RescueMarket.InsufficientShares.selector);
        market.withdraw(shares + 1);
    }

    function test_withdraw_revertsForNonHolder() public {
        _deposit(alice, 1000e18);
        vm.prank(bob);
        vm.expectRevert(RescueMarket.InsufficientShares.selector);
        market.withdraw(1);
    }

    function test_withdraw_revertsWhenDustRoundsToZeroAssets() public {
        _deposit(alice, 1000e18);
        vm.prank(alice);
        vm.expectRevert(RescueMarket.ZeroAmount.selector);
        market.withdraw(1); // 1 share = 1e-3 wei -> rounds to 0
    }

    // ------------------------------------------------------------ donation / inflation attack

    function test_donation_isIgnoredBySharePrice() public {
        _deposit(alice, 1000e18);
        deal(address(musd), address(market), musd.balanceOf(address(market)) + 1_000_000e18, true); // direct transfer
        assertEq(market.totalAssets(), 1000e18);
        assertEq(market.previewWithdraw(market.sharesOf(alice)), 1000e18);
    }

    function testFuzz_inflationAttack_victimGetsFairShareAndAttackerLoses(uint256 donation, uint256 victimAssets)
        public
    {
        donation = bound(donation, 1, MAX_AMOUNT);
        victimAssets = bound(victimAssets, 1, MAX_AMOUNT);

        _deposit(attacker, 1);
        deal(address(musd), attacker, musd.balanceOf(attacker) + donation, true);
        vm.prank(attacker);
        musd.transfer(address(market), donation); // try to inflate the share price

        _deposit(bob, victimAssets);
        assertEq(_withdrawAll(bob), victimAssets, "victim made whole");
        assertLe(_withdrawAll(attacker), 1, "attacker gets at most its 1 wei back");
    }

    // ------------------------------------------------------------ rounding fuzz

    function testFuzz_roundTrip_neverProfits(uint256 assets) public {
        assets = bound(assets, 1, MAX_AMOUNT);
        _deposit(alice, assets);
        uint256 out = _withdrawAll(alice);
        assertLe(out, assets);
        assertEq(out, assets); // empty pool: exact
    }

    function testFuzz_twoProvidersWithFees_noTheft(uint256 a, uint256 b, uint256 f, uint256 g, bool aliceFirst) public {
        a = bound(a, 1, MAX_AMOUNT);
        b = bound(b, 1, MAX_AMOUNT);
        f = bound(f, 0, MAX_AMOUNT);
        g = bound(g, 0, MAX_AMOUNT);

        _deposit(alice, a);
        _accrue(f); // earned before bob joins: all alice's (minus virtual-share dust)

        uint256 bobShares = market.previewDeposit(b);
        vm.assume(bobShares > 0);
        // price per share bob pays, rounded up: bound on what rounding can cost him
        uint256 pricePerShare = (market.totalAssets() + 1) / (market.totalShares() + VIRTUAL_SHARES) + 1;
        _deposit(bob, b);
        _accrue(g);

        uint256 aliceOut;
        uint256 bobOut;
        if (aliceFirst) {
            aliceOut = _withdrawAll(alice);
            bobOut = _withdrawAll(bob);
        } else {
            bobOut = _withdrawAll(bob);
            aliceOut = _withdrawAll(alice);
        }

        assertLe(aliceOut + bobOut, a + b + f + g, "pool never pays out more than it holds");
        assertGe(aliceOut, a, "earlier provider never loses principal to a later one");
        assertGe(bobOut + pricePerShare + 1, b, "later provider loses at most one share of rounding");
        assertLe(bobOut, b + g, "later provider can't capture fees earned before joining");
        assertGe(musd.balanceOf(address(market)), market.totalAssets(), "accounting backed by MUSD");
    }
}
