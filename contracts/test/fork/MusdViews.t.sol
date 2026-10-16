// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MezoForkBase} from "./utils/MezoForkBase.sol";
import {IBorrowerOperations} from "../../src/interfaces/IBorrowerOperations.sol";
import {ITroveManager} from "../../src/interfaces/ITroveManager.sol";
import {IPriceFeed} from "../../src/interfaces/IPriceFeed.sol";
import {IHintHelpers} from "../../src/interfaces/IHintHelpers.sol";
import {ISortedTroves} from "../../src/interfaces/ISortedTroves.sol";

interface ISortedTrovesExtra {
    function getFirst() external view returns (address);
}

/// @notice Read-only fork test: our minimal MUSD interfaces decode real testnet state (T0.4).
contract MusdViewsForkTest is MezoForkBase {
    // Pinned in deployments/testnet.json (T0.3).
    IBorrowerOperations internal constant BO = IBorrowerOperations(0xCdF7028ceAB81fA0C6971208e83fa7872994beE5);
    ITroveManager internal constant TM = ITroveManager(0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0);
    IPriceFeed internal constant PF = IPriceFeed(0x86bCF0841622a5dAC14A313a15f96A95421b9366);
    IHintHelpers internal constant HH = IHintHelpers(0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6);
    ISortedTroves internal constant ST = ISortedTroves(0x722E4D24FD6Ff8b0AC679450F3D91294607268fA);

    uint256 internal constant MCR_EXPECTED = 1.1e18; // 110%
    uint256 internal constant CCR_EXPECTED = 1.5e18; // 150%

    function test_systemParams_matchDocs() public view {
        assertEq(TM.MCR(), MCR_EXPECTED);
        assertEq(TM.CCR(), CCR_EXPECTED);
        assertGt(BO.minNetDebt(), 0);
        assertGt(BO.MUSD_GAS_COMPENSATION(), 0);
        assertLe(BO.getBorrowingFee(1000e18), 1000e18);
    }

    function test_priceAndTcr_areSane() public view {
        uint256 price = PF.fetchPrice();
        assertGt(price, 1000e18); // BTC > 1,000 MUSD
        assertLt(price, 10_000_000e18); // and < 10M MUSD
        uint256 tcr = TM.getTCR(price);
        assertGt(tcr, 1e18);
        assertEq(TM.checkRecoveryMode(price), tcr < TM.CCR());
    }

    function test_existingTrove_decodes() public view {
        uint256 price = PF.fetchPrice();
        address owner = ISortedTrovesExtra(address(ST)).getFirst();
        assertTrue(owner != address(0));
        assertEq(uint8(TM.getTroveStatus(owner)), uint8(ITroveManager.Status.active));

        (uint256 coll, uint256 principal,, uint256 pendingColl,,) = TM.getEntireDebtAndColl(owner);
        assertGt(coll, 0);
        assertGt(principal, 0);
        assertEq(TM.getTroveColl(owner) + pendingColl, coll); // entire coll = recorded + pending
        assertGe(TM.getTroveDebt(owner), principal);
        assertGt(TM.getCurrentICR(owner, price), TM.MCR());
    }

    function test_hints_returnListedTroves() public view {
        // NICR for a 200% trove at the current price, NICR scale 1e20: coll * 1e20 / debt.
        uint256 nicr = 2e20 * 1e18 / PF.fetchPrice();
        (address hint,,) = HH.getApproxHint(nicr, 15, 42);
        assertTrue(hint != address(0));
        (address upper, address lower) = ST.findInsertPosition(nicr, hint, hint);
        assertTrue(upper != address(0) || lower != address(0));
    }

    function test_mockOracle_movesIcrAndSurvivesWarp() public {
        address owner = ISortedTrovesExtra(address(ST)).getFirst();
        uint256 icrBefore = TM.getCurrentICR(owner, PF.fetchPrice());

        oracle.setPrice(oracle.price() / 2);
        uint256 icrAfter = TM.getCurrentICR(owner, PF.fetchPrice());
        assertApproxEqRel(icrAfter, icrBefore / 2, 1e15); // halved within 0.1%

        vm.warp(block.timestamp + 30 days); // past PriceFeed's 60s staleness window
        assertGt(PF.fetchPrice(), 0);
    }
}
