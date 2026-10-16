// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LifelineForkBase} from "./utils/LifelineForkBase.sol";
import {RescueMarket} from "../../src/RescueMarket.sol";
import {PositionVault} from "../../src/PositionVault.sol";

/// @notice T1.6: RescueMarket.rescue on a real at-risk MUSD trove (Mezo testnet fork; the price
///         drop comes from the mocked oracle, everything else is real MUSD).
contract RescueForkTest is LifelineForkBase {
    uint256 internal constant POOL = 20_000e18;
    uint256 internal constant TRIGGER = 1.5e18;
    uint256 internal constant TARGET = 1.7e18;
    uint256 internal constant START_ICR = 2e18;

    address internal provider = makeAddr("provider");
    address internal alice = makeAddr("alice");
    address internal keeper = makeAddr("keeper");

    function setUp() public override {
        super.setUp();
        deal(address(MUSD), provider, POOL, true);
        vm.startPrank(provider);
        MUSD.approve(address(market), POOL);
        market.deposit(POOL);
        vm.stopPrank();
    }

    /// @dev Vault with a real trove at ~200% ICR, opted in with trigger 150% / target 170%.
    function _openVault(address owner_, uint256 debt, uint256 maxRescue) internal returns (PositionVault v) {
        vm.prank(owner_);
        v = PositionVault(payable(factory.createVault()));
        uint256 composite = debt + BO.getBorrowingFee(debt) + BO.MUSD_GAS_COMPENSATION();
        uint256 coll = composite * START_ICR / PF.fetchPrice();
        vm.deal(owner_, coll);
        (address u, address l) = _hints(coll, composite);
        vm.startPrank(owner_);
        v.open{value: coll}(debt, u, l);
        v.setRescueTerms(TRIGGER, TARGET, maxRescue);
        v.optIn();
        vm.stopPrank();
    }

    function _dropPrice(uint256 pct) internal {
        oracle.setPrice(oracle.price() * int256(100 - pct) / 100);
    }

    function _rescue(PositionVault v) internal returns (RescueMarket.Quote memory q) {
        q = market.previewRescue(address(v));
        assertEq(uint8(q.status), uint8(RescueMarket.RescueStatus.Ok), "rescuable");
        (address u, address l) = _hintsForNicr(q.newNICR);
        vm.prank(keeper);
        market.rescue(address(v), u, l);
    }

    function test_rescue_realAtRiskTrove_restoresTarget() public {
        PositionVault v = _openVault(alice, 5000e18, 5000e18);
        assertEq(uint8(market.previewRescue(address(v)).status), uint8(RescueMarket.RescueStatus.AboveTrigger));

        _dropPrice(30); // ~200% -> ~140%: below the 150% trigger, still above 110%
        uint256 price = PF.fetchPrice();
        uint256 icrBefore = TM.getCurrentICR(address(v), price);
        assertLt(icrBefore, TRIGGER);
        assertGt(icrBefore, TM.MCR());
        uint256 debtBefore = TM.getTroveDebt(address(v));

        RescueMarket.Quote memory q = _rescue(v);

        uint256 icrAfter = TM.getCurrentICR(address(v), price);
        assertGe(icrAfter, TARGET, "target reached");
        assertApproxEqRel(icrAfter, TARGET, 1e9, "no overshoot");
        assertEq(TM.getTroveDebt(address(v)), debtBefore - q.repay, "real debt down by repay");

        (uint256 lienAmount, uint256 dueBy, bool active) = v.lien();
        assertTrue(active);
        assertEq(lienAmount, q.repay + q.fee + q.tip);
        assertEq(dueBy, block.timestamp + LIEN_TERM);
        assertEq(MUSD.balanceOf(keeper), q.tip, "keeper tipped");
        uint256 feeBps = pricer.feeBps(icrBefore, 0, 0);
        assertEq(q.fee, (q.repay * feeBps + 9999) / 10_000, "fee from pricer (rounded up)");

        assertEq(market.outstanding(), q.repay + q.tip);
        assertEq(market.totalAssets(), POOL);
        assertEq(MUSD.balanceOf(address(market)), POOL - q.repay - q.tip);

        // Providers can't pull MUSD that is out on rescue.
        uint256 shares = market.sharesOf(provider);
        vm.prank(provider);
        vm.expectRevert(RescueMarket.InsufficientLiquidity.selector);
        market.withdraw(shares);

        // Borrower can't take collateral out under the lien.
        vm.prank(alice);
        vm.expectRevert(PositionVault.LienActive.selector);
        v.withdrawColl(1, address(0), address(0));
    }

    function test_rescue_realTrove_cappedAtMinNetDebtBoundary() public {
        // Net debt only ~301.8 above the minimum, but reaching 170% needs more: the cap binds,
        // and real MUSD must accept a repay exactly at the boundary.
        PositionVault v = _openVault(alice, BO.minNetDebt() + 300e18, 5000e18);
        _dropPrice(30);

        (, uint256 principal, uint256 interest,,,) = TM.getEntireDebtAndColl(address(v));
        uint256 headroom = principal + interest - BO.MUSD_GAS_COMPENSATION() - BO.minNetDebt();
        RescueMarket.Quote memory q = _rescue(v);

        assertEq(q.repay, headroom, "repay capped at net debt - minNetDebt");
        (, principal, interest,,,) = TM.getEntireDebtAndColl(address(v));
        assertEq(principal + interest - BO.MUSD_GAS_COMPENSATION(), BO.minNetDebt(), "lands exactly on min");
        assertLt(TM.getCurrentICR(address(v), PF.fetchPrice()), TARGET, "partial rescue");
    }

    function test_rescue_realTrove_revertsAboveTrigger() public {
        PositionVault v = _openVault(alice, 5000e18, 5000e18);
        vm.prank(keeper);
        vm.expectRevert(RescueMarket.AboveTrigger.selector);
        market.rescue(address(v), address(0), address(0));
    }
}
