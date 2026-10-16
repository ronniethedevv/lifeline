// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {PositionVault} from "../../src/PositionVault.sol";
import {IBorrowerOperations} from "../../src/interfaces/IBorrowerOperations.sol";
import {ITroveManager} from "../../src/interfaces/ITroveManager.sol";
import {MockBorrowerOperations, MockMUSD, MockTroveManager} from "./mocks/MockMusd.sol";

/// @dev An owner that cannot receive BTC.
contract NoReceiveOwner {}

contract PositionVaultTest is Test {
    MockBorrowerOperations internal bo;
    MockTroveManager internal tm;
    MockMUSD internal musd;
    PositionVault internal vault;

    address internal alice = makeAddr("alice");
    address internal mallory = makeAddr("mallory");

    uint256 internal constant DEBT = 1800e18;
    uint256 internal constant COLL = 1 ether;

    function setUp() public {
        bo = new MockBorrowerOperations();
        tm = bo.troveManager();
        musd = bo.musd();
        vault = _newVault(alice);
        vm.deal(alice, 100 ether);
        vm.deal(mallory, 100 ether);
    }

    function _newVault(address owner_) internal returns (PositionVault) {
        return
            new PositionVault(
                owner_, IBorrowerOperations(address(bo)), ITroveManager(address(tm)), IERC20(address(musd))
            );
    }

    function _open() internal {
        vm.prank(alice);
        vault.open{value: COLL}(DEBT, address(0), address(0));
    }

    // ------------------------------------------------------------ constructor

    function test_constructor_setsImmutables() public view {
        assertEq(vault.owner(), alice);
        assertEq(address(vault.borrowerOperations()), address(bo));
        assertEq(address(vault.troveManager()), address(tm));
        assertEq(address(vault.musd()), address(musd));
        assertEq(vault.activePool(), address(bo.activePool()));
        assertEq(vault.collSurplusPool(), address(bo.collSurplusPool()));
    }

    function test_constructor_revertsOnZeroOwner() public {
        vm.expectRevert(PositionVault.ZeroAddress.selector);
        _newVault(address(0));
    }

    function test_constructor_revertsOnZeroDependency() public {
        vm.expectRevert(PositionVault.ZeroAddress.selector);
        new PositionVault(alice, IBorrowerOperations(address(bo)), ITroveManager(address(0)), IERC20(address(musd)));
        vm.expectRevert(PositionVault.ZeroAddress.selector);
        new PositionVault(alice, IBorrowerOperations(address(bo)), ITroveManager(address(tm)), IERC20(address(0)));
    }

    // ------------------------------------------------------------ open

    function test_open_opensTroveOwnedByVaultAndForwardsMusd() public {
        _open();
        assertEq(uint8(tm.getTroveStatus(address(vault))), uint8(ITroveManager.Status.active));
        assertEq(tm.getTroveColl(address(vault)), COLL);
        assertEq(musd.balanceOf(alice), DEBT);
        assertEq(musd.balanceOf(address(vault)), 0);
        assertEq(address(vault).balance, 0);
    }

    function test_open_revertsForNonOwner() public {
        vm.prank(mallory);
        vm.expectRevert(PositionVault.NotOwner.selector);
        vault.open{value: COLL}(DEBT, address(0), address(0));
    }

    function test_open_revertsWhenTroveAlreadyActive() public {
        _open();
        vm.prank(alice);
        vm.expectRevert("BorrowerOps: Trove is active");
        vault.open{value: COLL}(DEBT, address(0), address(0));
    }

    // ------------------------------------------------------------ addColl

    function test_addColl_addsToTrove() public {
        _open();
        vm.prank(alice);
        vault.addColl{value: 0.5 ether}(address(0), address(0));
        assertEq(tm.getTroveColl(address(vault)), COLL + 0.5 ether);
        assertEq(address(vault).balance, 0);
    }

    function test_addColl_revertsForNonOwner() public {
        _open();
        vm.prank(mallory);
        vm.expectRevert(PositionVault.NotOwner.selector);
        vault.addColl{value: 0.5 ether}(address(0), address(0));
    }

    // ------------------------------------------------------------ withdrawColl

    function test_withdrawColl_sendsBtcToOwner() public {
        _open();
        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdrawColl(0.25 ether, address(0), address(0));
        assertEq(alice.balance, before + 0.25 ether);
        assertEq(tm.getTroveColl(address(vault)), COLL - 0.25 ether);
        assertEq(address(vault).balance, 0);
    }

    function test_withdrawColl_revertsForNonOwner() public {
        _open();
        vm.prank(mallory);
        vm.expectRevert(PositionVault.NotOwner.selector);
        vault.withdrawColl(0.25 ether, address(0), address(0));
    }

    function test_withdrawColl_revertsWhenOwnerCannotReceiveBtc() public {
        address owner_ = address(new NoReceiveOwner());
        PositionVault v = _newVault(owner_);
        vm.deal(owner_, COLL);
        vm.prank(owner_);
        v.open{value: COLL}(DEBT, address(0), address(0));

        vm.prank(owner_);
        vm.expectRevert(PositionVault.BTCTransferFailed.selector);
        v.withdrawColl(0.25 ether, address(0), address(0));
    }

    // ------------------------------------------------------------ borrow

    function test_borrow_sendsMusdToOwner() public {
        _open();
        uint256 debtBefore = tm.getTroveDebt(address(vault));
        vm.prank(alice);
        vault.borrow(100e18, address(0), address(0));
        assertEq(musd.balanceOf(alice), DEBT + 100e18);
        assertEq(musd.balanceOf(address(vault)), 0);
        assertGt(tm.getTroveDebt(address(vault)), debtBefore);
    }

    function test_borrow_revertsForNonOwner() public {
        _open();
        vm.prank(mallory);
        vm.expectRevert(PositionVault.NotOwner.selector);
        vault.borrow(100e18, address(0), address(0));
    }

    // ------------------------------------------------------------ repay

    function test_repay_pullsMusdFromOwnerAndReducesDebt() public {
        _open();
        uint256 debtBefore = tm.getTroveDebt(address(vault));
        vm.startPrank(alice);
        musd.approve(address(vault), 100e18);
        vault.repay(100e18, address(0), address(0));
        vm.stopPrank();
        assertEq(musd.balanceOf(alice), DEBT - 100e18);
        assertEq(tm.getTroveDebt(address(vault)), debtBefore - 100e18);
        assertEq(musd.balanceOf(address(vault)), 0);
    }

    function test_repay_revertsForNonOwner() public {
        _open();
        vm.prank(mallory);
        vm.expectRevert(PositionVault.NotOwner.selector);
        vault.repay(100e18, address(0), address(0));
    }

    function test_repay_revertsWithoutApproval() public {
        _open();
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(vault), 0, 100e18)
        );
        vault.repay(100e18, address(0), address(0));
    }

    // ------------------------------------------------------------ close

    function test_close_pullsShortfallAndReturnsAllCollateral() public {
        _open();
        // debt to burn = DEBT + fee (gas comp is burned from the gas pool); alice holds DEBT.
        uint256 shortfall = bo.getBorrowingFee(DEBT);
        deal(address(musd), alice, DEBT + shortfall, true);
        uint256 btcBefore = alice.balance;

        vm.startPrank(alice);
        musd.approve(address(vault), DEBT + shortfall); // exact: any over-pull would revert
        vault.close();
        vm.stopPrank();

        assertEq(uint8(tm.getTroveStatus(address(vault))), uint8(ITroveManager.Status.closedByOwner));
        assertEq(alice.balance, btcBefore + COLL);
        assertEq(musd.balanceOf(alice), 0);
        assertEq(musd.allowance(alice, address(vault)), 0);
        assertEq(address(vault).balance, 0);
        assertEq(musd.balanceOf(address(vault)), 0);
    }

    function test_close_usesVaultMusdFirstAndReturnsLeftover() public {
        _open();
        uint256 owed = DEBT + bo.getBorrowingFee(DEBT);
        deal(address(musd), address(vault), owed + 7e18, true); // more than enough already in the vault
        uint256 aliceMusd = musd.balanceOf(alice);

        vm.prank(alice);
        vault.close(); // no approval needed: nothing pulled

        assertEq(musd.balanceOf(alice), aliceMusd + 7e18);
        assertEq(musd.balanceOf(address(vault)), 0);
    }

    function test_close_revertsForNonOwner() public {
        _open();
        vm.prank(mallory);
        vm.expectRevert(PositionVault.NotOwner.selector);
        vault.close();
    }

    function test_close_revertsWithoutApprovalForShortfall() public {
        _open();
        vm.prank(alice);
        vm.expectRevert();
        vault.close();
    }

    // ------------------------------------------------------------ refinance

    function test_refinance_callsThrough() public {
        _open();
        vm.prank(alice);
        vault.refinance(address(0), address(0));
        assertEq(bo.refinanceCount(address(vault)), 1);
    }

    function test_refinance_revertsForNonOwner() public {
        _open();
        vm.prank(mallory);
        vm.expectRevert(PositionVault.NotOwner.selector);
        vault.refinance(address(0), address(0));
    }

    // ------------------------------------------------------------ claimCollateral

    function test_claimCollateral_forwardsSurplusToOwner() public {
        bo.seedSurplus{value: 0.3 ether}(address(vault));
        uint256 before = alice.balance;
        vm.prank(alice);
        vault.claimCollateral();
        assertEq(alice.balance, before + 0.3 ether);
        assertEq(address(vault).balance, 0);
    }

    function test_claimCollateral_revertsForNonOwner() public {
        bo.seedSurplus{value: 0.3 ether}(address(vault));
        vm.prank(mallory);
        vm.expectRevert(PositionVault.NotOwner.selector);
        vault.claimCollateral();
    }

    // ------------------------------------------------------------ setRescueTerms

    event TermsSet(uint256 triggerICR, uint256 targetICR, uint256 maxRescue);
    event OptedIn();
    event OptedOut();

    uint256 internal constant TRIGGER = 1.3e18; // 130%
    uint256 internal constant TARGET = 1.6e18; // 160%
    uint256 internal constant MAX_RESCUE = 500e18;

    function _setTerms() internal {
        vm.prank(alice);
        vault.setRescueTerms(TRIGGER, TARGET, MAX_RESCUE);
    }

    function test_setRescueTerms_storesTermsAndEmits() public {
        vm.expectEmit(false, false, false, true, address(vault));
        emit TermsSet(TRIGGER, TARGET, MAX_RESCUE);
        _setTerms();
        (uint256 trigger, uint256 target, uint256 maxRescue) = vault.rescueTerms();
        assertEq(trigger, TRIGGER);
        assertEq(target, TARGET);
        assertEq(maxRescue, MAX_RESCUE);
    }

    function test_setRescueTerms_revertsForNonOwner() public {
        vm.prank(mallory);
        vm.expectRevert(PositionVault.NotOwner.selector);
        vault.setRescueTerms(TRIGGER, TARGET, MAX_RESCUE);
    }

    function test_setRescueTerms_revertsWhenTriggerAtOrBelowMcr() public {
        uint256 mcr = tm.MCR();
        vm.startPrank(alice);
        vm.expectRevert(PositionVault.InvalidTerms.selector);
        vault.setRescueTerms(mcr, TARGET, MAX_RESCUE);
        vm.expectRevert(PositionVault.InvalidTerms.selector);
        vault.setRescueTerms(mcr - 1, TARGET, MAX_RESCUE);
        vm.stopPrank();
    }

    function test_setRescueTerms_revertsWhenTargetNotAboveTrigger() public {
        vm.startPrank(alice);
        vm.expectRevert(PositionVault.InvalidTerms.selector);
        vault.setRescueTerms(TRIGGER, TRIGGER, MAX_RESCUE);
        vm.expectRevert(PositionVault.InvalidTerms.selector);
        vault.setRescueTerms(TRIGGER, TRIGGER - 1, MAX_RESCUE);
        vm.stopPrank();
    }

    function test_setRescueTerms_revertsOnZeroMaxRescue() public {
        vm.prank(alice);
        vm.expectRevert(PositionVault.InvalidTerms.selector);
        vault.setRescueTerms(TRIGGER, TARGET, 0);
    }

    function test_setRescueTerms_acceptsTightestValidOrdering() public {
        uint256 mcr = tm.MCR();
        vm.prank(alice);
        vault.setRescueTerms(mcr + 1, mcr + 2, 1);
        (uint256 trigger, uint256 target, uint256 maxRescue) = vault.rescueTerms();
        assertEq(trigger, mcr + 1);
        assertEq(target, mcr + 2);
        assertEq(maxRescue, 1);
    }

    function test_setRescueTerms_canUpdateWhileOptedIn() public {
        _setTerms();
        vm.startPrank(alice);
        vault.optIn();
        vault.setRescueTerms(1.4e18, 1.8e18, 900e18);
        vm.stopPrank();
        (uint256 trigger, uint256 target, uint256 maxRescue) = vault.rescueTerms();
        assertEq(trigger, 1.4e18);
        assertEq(target, 1.8e18);
        assertEq(maxRescue, 900e18);
        assertTrue(vault.optedIn());
    }

    function testFuzz_setRescueTerms_acceptsOnlyValidOrdering(uint256 trigger, uint256 target, uint256 maxRescue)
        public
    {
        trigger = bound(trigger, 0, 10e18);
        target = bound(target, 0, 10e18);
        maxRescue = bound(maxRescue, 0, 1e30);
        bool valid = tm.MCR() < trigger && trigger < target && maxRescue > 0;

        vm.prank(alice);
        if (!valid) vm.expectRevert(PositionVault.InvalidTerms.selector);
        vault.setRescueTerms(trigger, target, maxRescue);

        if (valid) {
            (uint256 t, uint256 g, uint256 m) = vault.rescueTerms();
            assertEq(t, trigger);
            assertEq(g, target);
            assertEq(m, maxRescue);
        }
    }

    // ------------------------------------------------------------ optIn / optOut

    function test_optIn_setsFlagAndEmits() public {
        _setTerms();
        vm.expectEmit(false, false, false, true, address(vault));
        emit OptedIn();
        vm.prank(alice);
        vault.optIn();
        assertTrue(vault.optedIn());
    }

    function test_optIn_revertsWithoutTerms() public {
        vm.prank(alice);
        vm.expectRevert(PositionVault.TermsNotSet.selector);
        vault.optIn();
    }

    function test_optIn_revertsWhenAlreadyOptedIn() public {
        _setTerms();
        vm.startPrank(alice);
        vault.optIn();
        vm.expectRevert(PositionVault.AlreadyOptedIn.selector);
        vault.optIn();
        vm.stopPrank();
    }

    function test_optIn_revertsForNonOwner() public {
        _setTerms();
        vm.prank(mallory);
        vm.expectRevert(PositionVault.NotOwner.selector);
        vault.optIn();
    }

    function test_optOut_clearsFlagAndEmits() public {
        _setTerms();
        vm.prank(alice);
        vault.optIn();
        vm.expectEmit(false, false, false, true, address(vault));
        emit OptedOut();
        vm.prank(alice);
        vault.optOut();
        assertFalse(vault.optedIn());
    }

    function test_optOut_revertsWhenNotOptedIn() public {
        vm.prank(alice);
        vm.expectRevert(PositionVault.NotOptedIn.selector);
        vault.optOut();
    }

    function test_optOut_revertsForNonOwner() public {
        _setTerms();
        vm.prank(alice);
        vault.optIn();
        vm.prank(mallory);
        vm.expectRevert(PositionVault.NotOwner.selector);
        vault.optOut();
    }

    function test_optInOut_canRepeat() public {
        _setTerms();
        vm.startPrank(alice);
        vault.optIn();
        vault.optOut();
        vault.optIn();
        vm.stopPrank();
        assertTrue(vault.optedIn());
    }

    // ------------------------------------------------------------ receive

    function test_receive_rejectsUnknownSender() public {
        vm.prank(mallory);
        (bool ok, bytes memory ret) = address(vault).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(bytes4(ret), PositionVault.UnauthorizedBTCSender.selector);
    }

    function test_receive_rejectsOwner() public {
        vm.prank(alice);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok);
    }
}
