// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MezoForkBase} from "./utils/MezoForkBase.sol";
import {TroveOwnerProbe} from "./utils/TroveOwnerProbe.sol";
import {IBorrowerOperations} from "../../src/interfaces/IBorrowerOperations.sol";
import {ITroveManager} from "../../src/interfaces/ITroveManager.sol";
import {IPriceFeed} from "../../src/interfaces/IPriceFeed.sol";
import {IHintHelpers} from "../../src/interfaces/IHintHelpers.sol";
import {ISortedTroves} from "../../src/interfaces/ISortedTroves.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice T0.5 part A: a contract opens, manages and closes its own MUSD trove on a
///         Mezo testnet fork (oracle mocked, all MUSD contracts real).
contract TroveOwnershipForkTest is MezoForkBase {
    IBorrowerOperations internal constant BO = IBorrowerOperations(0xCdF7028ceAB81fA0C6971208e83fa7872994beE5);
    ITroveManager internal constant TM = ITroveManager(0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0);
    IPriceFeed internal constant PF = IPriceFeed(0x86bCF0841622a5dAC14A313a15f96A95421b9366);
    IHintHelpers internal constant HH = IHintHelpers(0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6);
    ISortedTroves internal constant ST = ISortedTroves(0x722E4D24FD6Ff8b0AC679450F3D91294607268fA);
    IERC20 internal constant MUSD = IERC20(0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503);

    uint256 internal constant NICR_PRECISION = 1e20;
    uint256 internal constant TARGET_ICR = 2e18; // 200%
    uint256 internal constant HINT_TRIALS = 15;

    TroveOwnerProbe internal probe;

    function setUp() public override {
        super.setUp();
        probe = new TroveOwnerProbe(BO, MUSD);
        vm.deal(address(this), 100 ether);
    }

    receive() external payable {}

    function _hints(uint256 coll, uint256 debt) internal view returns (address upper, address lower) {
        uint256 nicr = coll * NICR_PRECISION / debt;
        (address approx,,) = HH.getApproxHint(nicr, HINT_TRIALS, 42);
        return ST.findInsertPosition(nicr, approx, approx);
    }

    function _hintsNow() internal view returns (address, address) {
        (uint256 coll, uint256 principal, uint256 interest,,,) = TM.getEntireDebtAndColl(address(probe));
        return _hints(coll, principal + interest);
    }

    function test_contractOwnsTrove_fullLifecycle() public {
        uint256 price = PF.fetchPrice();

        // 1. Open with the current minimum debt at ~200% ICR.
        uint256 debt = BO.minNetDebt();
        uint256 composite = debt + BO.getBorrowingFee(debt) + BO.MUSD_GAS_COMPENSATION();
        uint256 coll = composite * TARGET_ICR / price;
        (address u, address l) = _hints(coll, composite);
        probe.open{value: coll}(debt, u, l);

        assertEq(uint8(TM.getTroveStatus(address(probe))), uint8(ITroveManager.Status.active), "open: status");
        assertEq(TM.getTroveColl(address(probe)), coll, "open: coll");
        assertEq(MUSD.balanceOf(address(probe)), debt, "open: MUSD to probe");
        assertApproxEqRel(TM.getCurrentICR(address(probe), price), TARGET_ICR, 1e15, "open: ICR");

        // 2. Add collateral.
        (u, l) = _hints(coll + 0.01 ether, composite);
        probe.addColl{value: 0.01 ether}(u, l);
        assertEq(TM.getTroveColl(address(probe)), coll + 0.01 ether, "addColl");

        // 3. Borrow more, then repay it.
        uint256 debtBefore = TM.getTroveDebt(address(probe));
        (u, l) = _hintsNow();
        probe.borrow(100e18, u, l);
        assertGt(TM.getTroveDebt(address(probe)), debtBefore, "borrow: debt up");
        assertEq(MUSD.balanceOf(address(probe)), debt + 100e18, "borrow: MUSD to probe");

        uint256 debtMid = TM.getTroveDebt(address(probe));
        (u, l) = _hintsNow();
        probe.repay(100e18, u, l);
        assertEq(TM.getTroveDebt(address(probe)), debtMid - 100e18, "repay: debt down");

        // 4. Withdraw collateral: BTC must land in the probe (its receive() works).
        uint256 btcBefore = address(probe).balance;
        (u, l) = _hintsNow();
        probe.withdrawColl(0.01 ether, u, l);
        assertEq(address(probe).balance, btcBefore + 0.01 ether, "withdrawColl: BTC to probe");
        assertEq(TM.getTroveColl(address(probe)), coll, "withdrawColl: coll");

        // 5. Close: needs debt - gas compensation in MUSD; top up the fee + interest shortfall.
        uint256 needed = TM.getTroveDebt(address(probe)) - BO.MUSD_GAS_COMPENSATION();
        uint256 have = MUSD.balanceOf(address(probe));
        if (needed > have) deal(address(MUSD), address(probe), needed, true);
        uint256 btcBeforeClose = address(probe).balance;
        probe.close();

        assertEq(uint8(TM.getTroveStatus(address(probe))), uint8(ITroveManager.Status.closedByOwner), "close: status");
        assertEq(address(probe).balance, btcBeforeClose + coll, "close: all coll back to probe");

        // Probe can hand everything back to its owner.
        uint256 ownerBtc = address(this).balance;
        probe.sweep();
        assertEq(address(this).balance, ownerBtc + btcBeforeClose + coll);
    }

    function test_probe_rejectsNonOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(TroveOwnerProbe.NotOwner.selector);
        probe.close();
    }
}
