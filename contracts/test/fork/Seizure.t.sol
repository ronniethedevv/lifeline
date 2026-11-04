// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LifelineForkBase} from "./utils/LifelineForkBase.sol";
import {RescueMarket} from "../../src/RescueMarket.sol";
import {PositionVault} from "../../src/PositionVault.sol";

/// @notice T1.7b: RescueMarket.claimLien seizure against a real MUSD trove (Mezo testnet fork).
///         Verifies the `(ICR − MCR)/ICR` ceiling math matches real `withdrawColl` and that the
///         pool holds real BTC. The price moves via the mocked oracle; everything else is real MUSD.
contract SeizureForkTest is LifelineForkBase {
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

    function _dropPct(uint256 pct) internal {
        oracle.setPrice(oracle.price() * int256(100 - pct) / 100);
    }

    /// @dev Rescue `v` (it must be below trigger), returning the quote.
    function _rescue(PositionVault v) internal returns (RescueMarket.Quote memory q) {
        q = market.previewRescue(address(v));
        assertEq(uint8(q.status), uint8(RescueMarket.RescueStatus.Ok), "rescuable");
        (address u, address l) = _hintsForNicr(q.newNICR);
        vm.prank(keeper);
        market.rescue(address(v), u, l);
    }

    /// @dev Open, rescue, then restore the price (healthy system, high ICR) with the lien overdue.
    function _rescuedOverdue() internal returns (PositionVault v, uint256 lienAmount) {
        int256 startPrice = oracle.price();
        v = _openVault(alice, 5000e18, 5000e18);
        _dropPct(30); // ~200% -> ~140%: below the 150% trigger
        _rescue(v);
        oracle.setPrice(startPrice); // price recovers; borrower still owes the lien
        (lienAmount,,) = v.lien();
        vm.warp(block.timestamp + LIEN_TERM + 1);
    }

    function test_claimLien_seizesOnRealTrove() public {
        (PositionVault v, uint256 lienAmount) = _rescuedOverdue();
        uint256 price = PF.fetchPrice();
        assertFalse(TM.checkRecoveryMode(price), "system healthy after price recovery");

        (uint256 collBefore,,,,,) = TM.getEntireDebtAndColl(address(v));
        (uint256 principalBefore,) = market.lienRecords(address(v));
        assertEq(market.outstanding(), principalBefore);

        vm.prank(keeper);
        market.claimLien(address(v), address(0), address(0));

        uint256 btc = market.btcHeld();
        assertGt(btc, 0, "pool holds seized BTC");
        assertEq(address(market).balance, btc, "market BTC balance == btcHeld");

        (uint256 collAfter,,,,,) = TM.getEntireDebtAndColl(address(v));
        assertEq(collAfter, collBefore - btc, "real trove collateral fell by the seized BTC");
        assertGe(TM.getCurrentICR(address(v), price), TM.MCR(), "seizure stayed within MUSD's ceiling");

        // Lien + penalty was small vs the ceiling at a healthy ICR: a full seizure clears it.
        (,, bool active) = v.lien();
        assertFalse(active, "lien cleared");
        assertEq(market.outstanding(), 0, "receivable settled by BTC");
        assertGt(market.totalAssets(), POOL, "providers gain fee + penalty");
        assertGe(lienAmount, principalBefore);
    }

    function test_claimLien_providerWithdrawsSeizedBtc() public {
        (PositionVault v,) = _rescuedOverdue();
        vm.prank(keeper);
        market.claimLien(address(v), address(0), address(0));

        uint256 btcHeld = market.btcHeld();
        assertGt(btcHeld, 0);
        uint256 shares = market.sharesOf(provider);
        vm.prank(provider);
        (uint256 musdOut, uint256 btcOut) = market.withdraw(shares);

        assertEq(btcOut, btcHeld, "sole provider receives all seized BTC");
        assertEq(provider.balance, btcOut, "real BTC delivered");
        assertGt(musdOut, 0, "plus the liquid MUSD");
        assertEq(market.btcHeld(), 0, "pool BTC drained");
        assertEq(market.totalShares(), 0);
    }

    function test_claimLien_lowIcrRespectsRealCeiling() public {
        // Open, rescue, then push the price down so the trove sits just above MCR at claim time.
        PositionVault v = _openVault(alice, 5000e18, 5000e18);
        _dropPct(30);
        _rescue(v);
        _dropPct(18); // further drop: trove near MCR, maybe system Recovery Mode
        vm.warp(block.timestamp + LIEN_TERM + 1);
        uint256 price = PF.fetchPrice();

        if (TM.checkRecoveryMode(price)) {
            // Real MUSD blocks any withdrawal in Recovery Mode: nothing can be seized.
            vm.prank(keeper);
            vm.expectRevert(RescueMarket.NothingSeized.selector);
            market.claimLien(address(v), address(0), address(0));
        } else {
            // Otherwise the seizure is capped by the real ceiling: withdrawColl accepts the amount
            // and the trove's ICR never drops below MCR.
            uint256 icr = TM.getCurrentICR(address(v), price);
            vm.assume(icr > TM.MCR()); // if it is already at/under MCR there is no headroom
            vm.prank(keeper);
            market.claimLien(address(v), address(0), address(0));
            assertGt(market.btcHeld(), 0, "some BTC seized");
            assertGe(TM.getCurrentICR(address(v), price), TM.MCR(), "stayed within the ceiling");
        }
    }
}
