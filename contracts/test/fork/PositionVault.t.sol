// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MezoForkBase} from "./utils/MezoForkBase.sol";
import {VaultFactory} from "../../src/VaultFactory.sol";
import {PositionVault} from "../../src/PositionVault.sol";
import {IBorrowerOperations} from "../../src/interfaces/IBorrowerOperations.sol";
import {ITroveManager} from "../../src/interfaces/ITroveManager.sol";
import {IPriceFeed} from "../../src/interfaces/IPriceFeed.sol";
import {IHintHelpers} from "../../src/interfaces/IHintHelpers.sol";
import {ISortedTroves} from "../../src/interfaces/ISortedTroves.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice T1.1: VaultFactory + PositionVault trove lifecycle against real MUSD on a Mezo
///         testnet fork (oracle mocked; see MezoForkBase).
contract PositionVaultForkTest is MezoForkBase {
    IBorrowerOperations internal constant BO = IBorrowerOperations(0xCdF7028ceAB81fA0C6971208e83fa7872994beE5);
    ITroveManager internal constant TM = ITroveManager(0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0);
    IPriceFeed internal constant PF = IPriceFeed(0x86bCF0841622a5dAC14A313a15f96A95421b9366);
    IHintHelpers internal constant HH = IHintHelpers(0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6);
    ISortedTroves internal constant ST = ISortedTroves(0x722E4D24FD6Ff8b0AC679450F3D91294607268fA);
    IERC20 internal constant MUSD = IERC20(0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503);

    uint256 internal constant NICR_PRECISION = 1e20;
    uint256 internal constant TARGET_ICR = 2e18; // 200%
    uint256 internal constant HINT_TRIALS = 15;
    uint256 internal constant ADD_COLL = 0.01 ether;
    uint256 internal constant BORROW = 100e18;

    VaultFactory internal factory;
    PositionVault internal vault;
    address internal alice = makeAddr("alice");

    function setUp() public override {
        super.setUp();
        factory = new VaultFactory(BO, TM, MUSD);
        vm.prank(alice);
        vault = PositionVault(payable(factory.createVault()));
        vm.deal(alice, 10 ether);
    }

    function _hints(uint256 coll, uint256 debt) internal view returns (address upper, address lower) {
        uint256 nicr = coll * NICR_PRECISION / debt;
        (address approx,,) = HH.getApproxHint(nicr, HINT_TRIALS, 42);
        return ST.findInsertPosition(nicr, approx, approx);
    }

    function _hintsNow() internal view returns (address, address) {
        (uint256 coll, uint256 principal, uint256 interest,,,) = TM.getEntireDebtAndColl(address(vault));
        return _hints(coll, principal + interest);
    }

    function _open() internal returns (uint256 debt, uint256 coll) {
        debt = BO.minNetDebt();
        uint256 composite = debt + BO.getBorrowingFee(debt) + BO.MUSD_GAS_COMPENSATION();
        coll = composite * TARGET_ICR / PF.fetchPrice();
        (address u, address l) = _hints(coll, composite);
        vm.prank(alice);
        vault.open{value: coll}(debt, u, l);
    }

    function test_vaultLifecycle_onRealMusd() public {
        // open: trove belongs to the vault, MUSD goes to the owner
        uint256 aliceBtc0 = alice.balance;
        (uint256 debt, uint256 coll) = _open();
        assertEq(uint8(TM.getTroveStatus(address(vault))), uint8(ITroveManager.Status.active), "open: status");
        assertEq(TM.getTroveColl(address(vault)), coll, "open: coll");
        assertEq(MUSD.balanceOf(alice), debt, "open: MUSD to owner");
        assertEq(uint8(TM.getTroveStatus(alice)), uint8(ITroveManager.Status.nonExistent), "owner has no trove");

        // addColl
        (address u, address l) = _hints(coll + ADD_COLL, debt);
        vm.prank(alice);
        vault.addColl{value: ADD_COLL}(u, l);
        assertEq(TM.getTroveColl(address(vault)), coll + ADD_COLL, "addColl");

        // borrow -> owner
        uint256 debt0 = TM.getTroveDebt(address(vault));
        (u, l) = _hintsNow();
        vm.prank(alice);
        vault.borrow(BORROW, u, l);
        assertGt(TM.getTroveDebt(address(vault)), debt0, "borrow: debt up");
        assertEq(MUSD.balanceOf(alice), debt + BORROW, "borrow: MUSD to owner");

        // repay <- owner
        uint256 debt1 = TM.getTroveDebt(address(vault));
        (u, l) = _hintsNow();
        vm.startPrank(alice);
        MUSD.approve(address(vault), BORROW);
        vault.repay(BORROW, u, l);
        vm.stopPrank();
        assertEq(TM.getTroveDebt(address(vault)), debt1 - BORROW, "repay: debt down");
        assertEq(MUSD.balanceOf(alice), debt, "repay: MUSD from owner");

        // withdrawColl -> owner (BTC arrives from ActivePool through receive())
        uint256 aliceBtc1 = alice.balance;
        (u, l) = _hintsNow();
        vm.prank(alice);
        vault.withdrawColl(ADD_COLL, u, l);
        assertEq(alice.balance, aliceBtc1 + ADD_COLL, "withdrawColl: BTC to owner");
        assertEq(address(vault).balance, 0, "withdrawColl: vault holds no BTC");

        // refinance: fee added to debt, no MUSD moves
        uint256 debt2 = TM.getTroveDebt(address(vault));
        (u, l) = _hintsNow();
        vm.prank(alice);
        vault.refinance(u, l);
        assertGe(TM.getTroveDebt(address(vault)), debt2, "refinance: debt not reduced");
        assertEq(MUSD.balanceOf(alice), debt, "refinance: no MUSD moved");

        // close after interest accrues: vault pulls exactly debt - gas comp from the owner
        vm.warp(block.timestamp + 30 days);
        (, uint256 principal, uint256 interest,,,) = TM.getEntireDebtAndColl(address(vault));
        uint256 toBurn = principal + interest - BO.MUSD_GAS_COMPENSATION();
        deal(address(MUSD), alice, toBurn, true);
        vm.startPrank(alice);
        MUSD.approve(address(vault), toBurn); // exact: any over-pull would revert
        vault.close();
        vm.stopPrank();

        assertEq(uint8(TM.getTroveStatus(address(vault))), uint8(ITroveManager.Status.closedByOwner), "close: status");
        assertEq(MUSD.balanceOf(alice), 0, "close: exactly toBurn pulled");
        assertEq(alice.balance, aliceBtc0, "close: owner has all BTC back");
        assertEq(address(vault).balance, 0, "close: vault holds no BTC");
        assertEq(MUSD.balanceOf(address(vault)), 0, "close: vault holds no MUSD");
    }

    function test_vault_rejectsNonOwnerOnRealMusd() public {
        _open();
        address mallory = makeAddr("mallory");
        vm.prank(mallory);
        vm.expectRevert(PositionVault.NotOwner.selector);
        vault.withdrawColl(1, address(0), address(0));
        vm.prank(mallory);
        vm.expectRevert(PositionVault.NotOwner.selector);
        vault.close();
    }

    function test_vault_readsRealPoolAddresses() public view {
        assertEq(vault.activePool(), BO.activePool());
        assertEq(vault.collSurplusPool(), BO.collSurplusPool());
        assertTrue(vault.activePool().code.length > 0 && vault.collSurplusPool().code.length > 0);
    }
}
