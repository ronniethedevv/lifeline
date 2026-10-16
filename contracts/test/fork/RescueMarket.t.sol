// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LifelineForkBase} from "./utils/LifelineForkBase.sol";

/// @notice T1.5: provider deposits/withdrawals with the real MUSD token on a Mezo testnet fork.
contract RescueMarketForkTest is LifelineForkBase {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public override {
        super.setUp();
        deal(address(MUSD), alice, 10_000e18, true);
        deal(address(MUSD), bob, 2_500e18, true);
    }

    function test_depositWithdraw_realMusd() public {
        vm.startPrank(alice);
        MUSD.approve(address(market), 10_000e18);
        uint256 aliceShares = market.deposit(10_000e18);
        vm.stopPrank();

        vm.startPrank(bob);
        MUSD.approve(address(market), 2_500e18);
        uint256 bobShares = market.deposit(2_500e18);
        vm.stopPrank();

        assertEq(bobShares, aliceShares / 4);
        assertEq(MUSD.balanceOf(address(market)), 12_500e18);
        assertEq(market.totalAssets(), 12_500e18);

        vm.prank(alice);
        assertEq(market.withdraw(aliceShares), 10_000e18);
        vm.prank(bob);
        assertEq(market.withdraw(bobShares), 2_500e18);

        assertEq(MUSD.balanceOf(alice), 10_000e18);
        assertEq(MUSD.balanceOf(bob), 2_500e18);
        assertEq(MUSD.balanceOf(address(market)), 0);
        assertEq(market.totalShares(), 0);
    }
}
