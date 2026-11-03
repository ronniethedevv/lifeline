// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RescueMarket} from "../../src/RescueMarket.sol";
import {VaultFactory} from "../../src/VaultFactory.sol";
import {PositionVault} from "../../src/PositionVault.sol";
import {IFeePricer} from "../../src/interfaces/IFeePricer.sol";
import {IBorrowerOperations} from "../../src/interfaces/IBorrowerOperations.sol";
import {ITroveManager} from "../../src/interfaces/ITroveManager.sol";
import {IPriceFeed} from "../../src/interfaces/IPriceFeed.sol";
import {MarketFixture} from "./utils/MarketFixture.sol";

/// @notice T1.6: RescueMarket.rescue on the mock MUSD stack.
contract RescueMarketRescueTest is MarketFixture {
    event Rescued(
        address indexed vault, address indexed keeper, uint256 repaid, uint256 fee, uint256 tip, uint256 dueBy
    );

    address internal provider = makeAddr("provider");
    address internal alice = makeAddr("alice");
    address internal keeper = makeAddr("keeper");

    uint256 internal constant POOL = 10_000e18;
    uint256 internal constant COLL = 1 ether;
    uint256 internal constant DEBT = 3000e18; // trove debt 3203 (fee 3 + gas comp 200)
    uint256 internal constant TRIGGER = 1.5e18;
    uint256 internal constant TARGET = 1.7e18;
    uint256 internal constant MAX_RESCUE = 1000e18;
    uint256 internal constant START_PRICE = 5000e18; // ICR ~156%
    uint256 internal constant DROP_PRICE = 4500e18; // ICR ~140.5%: below trigger
    uint256 internal constant BPS = 10_000;

    PositionVault internal vault;

    function setUp() public override {
        super.setUp();
        _deposit(provider, POOL);
        vault = _vaultWith(alice, DEBT, MAX_RESCUE);
        vm.deal(keeper, 0);
    }

    function _vaultWith(address owner_, uint256 debt, uint256 maxRescue) internal returns (PositionVault v) {
        v = _newVault(owner_);
        vm.deal(owner_, owner_.balance + COLL);
        vm.startPrank(owner_);
        v.open{value: COLL}(debt, address(0), address(0));
        v.setRescueTerms(TRIGGER, TARGET, maxRescue);
        v.optIn();
        vm.stopPrank();
    }

    function _rescue(PositionVault v) internal {
        vm.prank(keeper);
        market.rescue(address(v), address(0), address(0));
    }

    function _icr(PositionVault v) internal view returns (uint256) {
        return tm.getCurrentICR(address(v), pf.price());
    }

    // ------------------------------------------------------------ constructor

    function test_constructor_setsImmutables() public view {
        assertEq(address(market.borrowerOperations()), address(bo));
        assertEq(address(market.troveManager()), address(tm));
        assertEq(address(market.priceFeed()), address(pf));
        assertEq(address(market.pricer()), address(pricer));
        assertEq(address(market.factory()), address(factory));
        assertEq(market.lienTerm(), LIEN_TERM);
        assertEq(market.tipBps(), TIP_BPS);
    }

    function test_constructor_revertsWhenFactoryPointsElsewhere() public {
        // factory.market() is the fixture's market, not this new one
        vm.expectRevert(RescueMarket.FactoryMismatch.selector);
        _deployMarket(LIEN_TERM, TIP_BPS);
    }

    function test_constructor_revertsOnInvalidParams() public {
        address next = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        factory =
            new VaultFactory(IBorrowerOperations(address(bo)), ITroveManager(address(tm)), IERC20(address(musd)), next);
        vm.expectRevert(RescueMarket.InvalidParams.selector);
        _deployMarket(0, TIP_BPS); // zero lien term

        next = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        factory =
            new VaultFactory(IBorrowerOperations(address(bo)), ITroveManager(address(tm)), IERC20(address(musd)), next);
        uint256 maxTip = market.MAX_TIP_BPS();
        vm.expectRevert(RescueMarket.InvalidParams.selector);
        _deployMarket(LIEN_TERM, maxTip + 1);
    }

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert(RescueMarket.ZeroAddress.selector);
        new RescueMarket(
            IERC20(address(musd)),
            IBorrowerOperations(address(bo)),
            ITroveManager(address(tm)),
            IPriceFeed(address(0)),
            pricer,
            factory,
            LIEN_TERM,
            TIP_BPS,
            SEIZE_PENALTY_BPS,
            COMBINED_ICR_FLOOR
        );
        vm.expectRevert(RescueMarket.ZeroAddress.selector);
        new RescueMarket(
            IERC20(address(musd)),
            IBorrowerOperations(address(bo)),
            ITroveManager(address(tm)),
            IPriceFeed(address(pf)),
            IFeePricer(address(0)),
            factory,
            LIEN_TERM,
            TIP_BPS,
            SEIZE_PENALTY_BPS,
            COMBINED_ICR_FLOOR
        );
    }

    // ------------------------------------------------------------ happy path

    function test_rescue_restoresTargetIcrPaysTipAndRecordsLien() public {
        pf.setPrice(DROP_PRICE);
        uint256 icrBefore = _icr(vault);
        assertLt(icrBefore, TRIGGER);
        RescueMarket.Quote memory q = market.previewRescue(address(vault));
        assertEq(uint8(q.status), uint8(RescueMarket.RescueStatus.Ok));

        _rescue(vault);

        uint256 icrAfter = _icr(vault);
        assertGe(icrAfter, TARGET, "reaches target");
        assertApproxEqRel(icrAfter, TARGET, 1e9, "not overshooting (1e-9)");

        uint256 feeBps = pricer.feeBps(icrBefore, 0, 0);
        assertEq(q.fee, (q.repay * feeBps + BPS - 1) / BPS, "fee = repay * pricer bps, rounded up");
        assertEq(q.tip, q.repay * TIP_BPS / BPS, "tip = repay * tipBps");
        assertEq(musd.balanceOf(keeper), q.tip, "keeper paid");

        (uint256 lienAmount, uint256 dueBy, bool active) = vault.lien();
        assertTrue(active);
        assertEq(lienAmount, q.repay + q.fee + q.tip, "lien = repay + fee + tip");
        assertEq(dueBy, block.timestamp + LIEN_TERM);

        (uint256 principal, uint256 fee) = market.lienRecords(address(vault));
        assertEq(principal, q.repay + q.tip);
        assertEq(fee, q.fee);
    }

    function test_rescue_emitsRescued() public {
        pf.setPrice(DROP_PRICE);
        RescueMarket.Quote memory q = market.previewRescue(address(vault));
        vm.expectEmit(true, true, false, true, address(market));
        emit Rescued(address(vault), keeper, q.repay, q.fee, q.tip, block.timestamp + LIEN_TERM);
        _rescue(vault);
    }

    function test_rescue_accountingMovesCashToReceivable() public {
        pf.setPrice(DROP_PRICE);
        RescueMarket.Quote memory q = market.previewRescue(address(vault));
        _rescue(vault);
        assertEq(market.outstanding(), q.repay + q.tip);
        assertEq(market.totalAssets(), POOL, "pool value unchanged: cash became a receivable");
        assertEq(market.liquidAssets(), POOL - q.repay - q.tip);
        assertEq(musd.balanceOf(address(market)), POOL - q.repay - q.tip);
    }

    function test_rescue_newNicrMatchesPostRescueState() public {
        pf.setPrice(DROP_PRICE);
        RescueMarket.Quote memory q = market.previewRescue(address(vault));
        _rescue(vault);
        (uint256 coll, uint256 debt,,,,) = tm.getEntireDebtAndColl(address(vault));
        assertEq(q.newNICR, coll * 1e20 / debt);
    }

    // ------------------------------------------------------------ reverts

    function test_rescue_revertsForUnknownVault() public {
        pf.setPrice(DROP_PRICE);
        vm.expectRevert(RescueMarket.NotVault.selector);
        market.rescue(makeAddr("fake"), address(0), address(0));
    }

    function test_rescue_revertsForVaultFromAnotherFactory() public {
        VaultFactory other = new VaultFactory(
            IBorrowerOperations(address(bo)), ITroveManager(address(tm)), IERC20(address(musd)), address(market)
        );
        vm.prank(alice);
        address foreign = other.createVault();
        vm.expectRevert(RescueMarket.NotVault.selector);
        market.rescue(foreign, address(0), address(0));
    }

    function test_rescue_revertsWhenNotOptedIn() public {
        vm.prank(alice);
        vault.optOut();
        pf.setPrice(DROP_PRICE);
        vm.expectRevert(RescueMarket.NotOptedIn.selector);
        _rescue(vault);
    }

    function test_rescue_revertsWhenLienActive() public {
        pf.setPrice(DROP_PRICE);
        _rescue(vault);
        pf.setPrice(3500e18); // even deeper below trigger
        vm.expectRevert(RescueMarket.LienActive.selector);
        _rescue(vault); // invariant 7: no second rescue on the same lien
    }

    function test_rescue_revertsWhenAboveTrigger() public {
        vm.expectRevert(RescueMarket.AboveTrigger.selector);
        _rescue(vault); // ICR ~156% >= 150%
    }

    function test_rescue_revertsWhenPoolEmpty() public {
        uint256 shares = market.sharesOf(provider);
        vm.prank(provider);
        market.withdraw(shares);
        pf.setPrice(DROP_PRICE);
        vm.expectRevert(RescueMarket.NothingToRescue.selector);
        _rescue(vault);
    }

    // ------------------------------------------------------------ caps

    function test_rescue_cappedByMaxRescue() public {
        PositionVault small = _vaultWith(makeAddr("dave"), DEBT, 100e18);
        pf.setPrice(DROP_PRICE);
        uint256 icrBefore = _icr(small);
        vm.prank(keeper);
        market.rescue(address(small), address(0), address(0));
        (uint256 lienAmount,,) = small.lien();
        (uint256 principal,) = market.lienRecords(address(small));
        assertEq(principal, 100e18 + 100e18 * TIP_BPS / BPS, "repay capped at maxRescue");
        assertGt(lienAmount, 100e18);
        uint256 icrAfter = _icr(small);
        assertGt(icrAfter, icrBefore, "partial rescue still raises ICR");
        assertLt(icrAfter, TARGET, "partial: target not reached");
    }

    function test_rescue_cappedByLiquidity() public {
        uint256 shares = market.sharesOf(provider) * 98 / 100; // leave ~200 MUSD
        vm.prank(provider);
        market.withdraw(shares);
        uint256 liquid = market.liquidAssets();
        pf.setPrice(DROP_PRICE);
        RescueMarket.Quote memory q = market.previewRescue(address(vault));
        assertEq(q.repay, liquid * BPS / (BPS + TIP_BPS), "repay + tip fits liquidity");
        _rescue(vault);
        assertLe(market.outstanding(), liquid);
    }

    function test_rescue_cappedByMinNetDebtHeadroom() public {
        // debt 2000 -> trove debt 2202, net 2002: headroom above 1800 is 202
        PositionVault tight = _vaultWith(makeAddr("erin"), 2000e18, MAX_RESCUE);
        pf.setPrice(3000e18); // ICR 3000/2202 = 136%
        RescueMarket.Quote memory q = market.previewRescue(address(tight));
        assertEq(q.repay, 202e18, "repay capped at net debt - minNetDebt");
        vm.prank(keeper);
        market.rescue(address(tight), address(0), address(0)); // mock enforces MUSD's rule: no revert
    }

    function test_rescue_revertsWhenNoMinDebtHeadroom() public {
        // net debt 1801.8; governance raises the minimum to exactly that -> zero headroom
        PositionVault atMin = _vaultWith(makeAddr("frank"), 1800e18, MAX_RESCUE);
        bo.setMinNetDebt(1801.8e18);
        pf.setPrice(2900e18);
        vm.expectRevert(RescueMarket.NothingToRescue.selector);
        vm.prank(keeper);
        market.rescue(address(atMin), address(0), address(0));
    }

    // ------------------------------------------------------------ withdraw liquidity cap

    function test_withdraw_cappedByLiquidAssets() public {
        pf.setPrice(DROP_PRICE);
        _rescue(vault);
        uint256 shares = market.sharesOf(provider);
        vm.prank(provider);
        vm.expectRevert(RescueMarket.InsufficientLiquidity.selector);
        market.withdraw(shares);

        uint256 liquidShares = market.previewDeposit(market.liquidAssets()); // shares worth the liquid MUSD
        vm.prank(provider);
        market.withdraw(liquidShares);
        assertLe(market.liquidAssets(), 1);
    }

    // ------------------------------------------------------------ previewRescue statuses

    function test_previewRescue_reportsEachStatus() public {
        assertEq(uint8(market.previewRescue(makeAddr("x")).status), uint8(RescueMarket.RescueStatus.NotVault));
        assertEq(uint8(market.previewRescue(address(vault)).status), uint8(RescueMarket.RescueStatus.AboveTrigger));
        pf.setPrice(DROP_PRICE);
        assertEq(uint8(market.previewRescue(address(vault)).status), uint8(RescueMarket.RescueStatus.Ok));
        _rescue(vault);
        assertEq(uint8(market.previewRescue(address(vault)).status), uint8(RescueMarket.RescueStatus.LienActive));
        PositionVault out = _vaultWith(makeAddr("gina"), DEBT, MAX_RESCUE);
        vm.prank(makeAddr("gina"));
        out.optOut();
        assertEq(uint8(market.previewRescue(address(out)).status), uint8(RescueMarket.RescueStatus.NotOptedIn));
    }

    // ------------------------------------------------------------ repayLien (T1.7a)

    event LienRepaid(address indexed vault, address indexed payer, uint256 principal, uint256 fee);

    function _rescued() internal returns (RescueMarket.Quote memory q) {
        pf.setPrice(DROP_PRICE);
        q = market.previewRescue(address(vault));
        _rescue(vault);
    }

    /// @dev `payer` gets exactly the lien amount and approves the market.
    function _fundLien(address payer, PositionVault v) internal returns (uint256 amount) {
        (amount,,) = v.lien();
        deal(address(musd), payer, amount, true);
        vm.prank(payer);
        musd.approve(address(market), amount);
    }

    function test_repayLien_clearsLienAndBooksFeeAsIncome() public {
        RescueMarket.Quote memory q = _rescued();
        uint256 amount = _fundLien(alice, vault);
        assertEq(amount, q.repay + q.fee + q.tip);

        vm.expectEmit(true, true, false, true, address(market));
        emit LienRepaid(address(vault), alice, q.repay + q.tip, q.fee);
        vm.prank(alice);
        market.repayLien(address(vault));

        (,, bool active) = vault.lien();
        assertFalse(active, "vault lien cleared");
        (uint256 principal, uint256 fee) = market.lienRecords(address(vault));
        assertEq(principal + fee, 0, "market record deleted");
        assertEq(market.outstanding(), 0);
        assertEq(market.totalAssets(), POOL + q.fee, "fee is provider income");
        assertEq(market.liquidAssets(), POOL + q.fee);
        assertEq(musd.balanceOf(address(market)), POOL + q.fee);
        assertEq(musd.balanceOf(alice), 0);
    }

    function test_repayLien_byThirdParty() public {
        _rescued();
        address friend = makeAddr("friend");
        _fundLien(friend, vault);
        vm.prank(friend);
        market.repayLien(address(vault));
        (,, bool active) = vault.lien();
        assertFalse(active);
    }

    function test_repayLien_afterDueByStillAllowed() public {
        _rescued();
        vm.warp(block.timestamp + LIEN_TERM + 30 days);
        _fundLien(alice, vault);
        vm.prank(alice);
        market.repayLien(address(vault));
        (,, bool active) = vault.lien();
        assertFalse(active);
    }

    function test_repayLien_unblocksVault() public {
        _rescued();
        _fundLien(alice, vault);
        vm.prank(alice);
        market.repayLien(address(vault));

        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdrawColl(0.01 ether, address(0), address(0));
        assertEq(alice.balance, before + 0.01 ether);
    }

    function test_repayLien_allowsAnotherRescue() public {
        _rescued();
        _fundLien(alice, vault);
        vm.prank(alice);
        market.repayLien(address(vault));
        pf.setPrice(3800e18); // falls again
        assertEq(uint8(market.previewRescue(address(vault)).status), uint8(RescueMarket.RescueStatus.Ok));
        _rescue(vault);
        (,, bool active) = vault.lien();
        assertTrue(active);
    }

    function test_repayLien_providerWithdrawsDepositPlusFee() public {
        RescueMarket.Quote memory q = _rescued();
        _fundLien(alice, vault);
        vm.prank(alice);
        market.repayLien(address(vault));

        uint256 shares = market.sharesOf(provider);
        vm.prank(provider);
        (uint256 out,) = market.withdraw(shares);
        assertApproxEqAbs(out, POOL + q.fee, 1, "sole provider gets the fee");
        assertGe(musd.balanceOf(address(market)), market.totalAssets(), "accounting backed");
    }

    function test_repayLien_revertsForUnknownVault() public {
        vm.expectRevert(RescueMarket.NotVault.selector);
        market.repayLien(makeAddr("fake"));
    }

    function test_repayLien_revertsWhenNeverRescued() public {
        vm.prank(alice);
        vm.expectRevert(RescueMarket.NoActiveLien.selector);
        market.repayLien(address(vault));
    }

    function test_repayLien_revertsWhenAlreadyRepaid() public {
        _rescued();
        _fundLien(alice, vault);
        vm.prank(alice);
        market.repayLien(address(vault));
        vm.prank(alice);
        vm.expectRevert(RescueMarket.NoActiveLien.selector);
        market.repayLien(address(vault));
    }

    function test_repayLien_revertsWithoutApproval() public {
        _rescued();
        (uint256 amount,,) = vault.lien();
        deal(address(musd), alice, amount, true);
        vm.prank(alice);
        vm.expectRevert();
        market.repayLien(address(vault));
    }

    function test_repayLien_revertsWithoutBalance() public {
        _rescued();
        uint256 amount = _fundLien(alice, vault);
        deal(address(musd), alice, amount - 1, true);
        vm.prank(alice);
        vm.expectRevert();
        market.repayLien(address(vault));
    }

    function testFuzz_rescueRepayCycles_providersNeverLose(uint256 seed, uint8 cycles) public {
        cycles = uint8(bound(cycles, 1, 5));
        uint256 deposited = POOL;
        uint256 fees;
        for (uint256 i; i < cycles; i++) {
            uint256 price = bound(uint256(keccak256(abi.encode(seed, i))), 3400e18, 4999e18);
            pf.setPrice(START_PRICE); // reset so the trove is healthy, then drop
            pf.setPrice(price);
            RescueMarket.Quote memory q = market.previewRescue(address(vault));
            if (q.status != RescueMarket.RescueStatus.Ok) continue;
            _rescue(vault);
            _fundLien(alice, vault);
            vm.prank(alice);
            market.repayLien(address(vault));
            fees += q.fee;
            assertEq(market.outstanding(), 0, "outstanding back to 0");
            assertGe(musd.balanceOf(address(market)), market.totalAssets(), "accounting backed");
        }
        assertEq(market.totalAssets(), deposited + fees, "fees accrue to the pool only");
        uint256 shares = market.sharesOf(provider);
        vm.prank(provider);
        (uint256 out,) = market.withdraw(shares);
        assertGe(out + 1, deposited + fees, "provider gets principal + fees (1 wei rounding)");
    }

    // ------------------------------------------------------------ fuzz

    function testFuzz_rescue_raisesIcrToAtMostTarget(uint256 price, uint256 maxRescue) public {
        price = bound(price, 3400e18, 4999e18); // ICR ~106%..156%
        maxRescue = bound(maxRescue, 1e18, 5000e18);
        PositionVault v = _vaultWith(makeAddr("fuzz"), DEBT, maxRescue);
        pf.setPrice(price);
        RescueMarket.Quote memory q = market.previewRescue(address(v));
        if (q.status != RescueMarket.RescueStatus.Ok) return;

        uint256 icrBefore = _icr(v);
        vm.prank(keeper);
        market.rescue(address(v), address(0), address(0));
        uint256 icrAfter = _icr(v);

        assertGe(icrAfter, icrBefore, "invariant 4: never lowers ICR");
        assertLe(icrAfter, TARGET + 1e9, "never overshoots target");
        assertLe(q.repay, maxRescue, "within maxRescue");
        (uint256 lienAmount,,) = v.lien();
        assertEq(lienAmount, q.repay + q.fee + q.tip);
        assertLe(q.fee, q.repay * MAX_FEE_BPS / BPS + 1, "fee within pricer max");
    }

    // ------------------------------------------------------------ claimLien / seizure (T1.7b)

    event LienClaimed(
        address indexed vault, address indexed keeper, uint256 btcSeized, uint256 lienReduced, uint256 remaining
    );
    event LossRecognized(address indexed vault, uint256 principalLost);

    /// @dev Keep the mock BO's withdraw-guard price in sync with the PriceFeed mock.
    function _setPrice(uint256 p) internal {
        pf.setPrice(p);
        bo.setPrice(p);
    }

    /// @dev Rescue `vault` and advance past its lien deadline. Returns the lien amount.
    function _rescuedAndDue() internal returns (uint256 lienAmount) {
        _setPrice(DROP_PRICE);
        _rescue(vault);
        (lienAmount,,) = vault.lien();
        vm.warp(block.timestamp + LIEN_TERM + 1);
    }

    function test_claimLien_fullSeizureClearsLienAndHoldsBtc() public {
        uint256 lienAmount = _rescuedAndDue();
        (uint256 principal,) = market.lienRecords(address(vault));
        assertEq(market.outstanding(), principal, "outstanding == principal before");

        vm.prank(keeper);
        market.claimLien(address(vault), address(0), address(0));

        uint256 btc = market.btcHeld();
        assertGt(btc, 0, "pool holds seized BTC");
        assertEq(address(market).balance, btc, "market BTC balance matches btcHeld");
        assertEq(market.outstanding(), 0, "receivable settled");
        (uint256 princAfter, uint256 feeAfter) = market.lienRecords(address(vault));
        assertEq(princAfter, 0, "lien record cleared");
        assertEq(feeAfter, 0);
        (,, bool active) = vault.lien();
        assertFalse(active, "vault lien cleared on full seizure");
        // Seizing lien + penalty in BTC leaves providers better off than the bare principal.
        assertGt(market.totalAssets(), POOL, "providers gain fee + penalty");
        assertGe(lienAmount, principal, "sanity: lien >= principal");
    }

    function test_claimLien_partialWhenCeilingCaps() public {
        _rescuedAndDue();
        _setPrice(3100e18); // ICR ~117%: the (ICR-MCR)/ICR ceiling caps the seizure
        uint256 outstandingBefore = market.outstanding();

        vm.prank(keeper);
        market.claimLien(address(vault), address(0), address(0));

        (uint256 princAfter,) = market.lienRecords(address(vault));
        assertGt(princAfter, 0, "lien record only partly settled");
        assertLt(princAfter, outstandingBefore, "but it was reduced");
        assertEq(market.outstanding(), princAfter, "outstanding tracks remaining principal");
        (uint256 remaining,, bool active) = vault.lien();
        assertGt(remaining, 0, "lien still outstanding");
        assertTrue(active, "lien stays active after a capped seizure");
        assertGt(market.btcHeld(), 0);
    }

    function test_claimLien_revertsBeforeDue() public {
        _setPrice(DROP_PRICE);
        _rescue(vault); // lien due in LIEN_TERM, not warped
        vm.prank(keeper);
        vm.expectRevert(RescueMarket.LienNotDue.selector);
        market.claimLien(address(vault), address(0), address(0));
    }

    function test_claimLien_revertsInRecoveryMode() public {
        _rescuedAndDue();
        tm.setTCR(1.4e18); // below CCR: ceiling is 0 -> nothing can be seized
        vm.prank(keeper);
        vm.expectRevert(RescueMarket.NothingSeized.selector);
        market.claimLien(address(vault), address(0), address(0));
    }

    function test_claimLien_revertsForUnknownVault() public {
        vm.expectRevert(RescueMarket.NotVault.selector);
        market.claimLien(makeAddr("fake"), address(0), address(0));
    }

    function test_claimLien_revertsWhenNoLien() public {
        vm.expectRevert(RescueMarket.NoActiveLien.selector);
        market.claimLien(address(vault), address(0), address(0));
    }

    function test_withdraw_paysProRataMusdAndBtc() public {
        _rescuedAndDue();
        vm.prank(keeper);
        market.claimLien(address(vault), address(0), address(0)); // full seizure: pool now holds BTC

        uint256 btcHeld = market.btcHeld();
        uint256 liquid = market.liquidAssets();
        uint256 shares = market.sharesOf(provider);

        vm.prank(provider);
        (uint256 musdOut, uint256 btcOut) = market.withdraw(shares);

        assertEq(btcOut, btcHeld, "sole provider receives all seized BTC");
        assertApproxEqAbs(musdOut, liquid, 1, "and all liquid MUSD (<=1 wei kept by the pool)");
        assertEq(market.btcHeld(), 0, "pool BTC drained");
        assertEq(market.totalShares(), 0, "all shares burned");
        assertEq(provider.balance, btcOut, "provider got the BTC");
    }

    // ------------------------------------------------------------ recognizeLoss (T1.7b)

    function test_recognizeLoss_writesOffLiquidatedTrove() public {
        _rescuedAndDue();
        (uint256 principal,) = market.lienRecords(address(vault));
        // MUSD liquidates the trove: its collateral is gone, the lien is unrecoverable.
        vm.prank(address(bo));
        tm.set(address(vault), ITroveManager.Status.closedByLiquidation, 0, 0);
        uint256 assetsBefore = market.totalAssets();

        vm.expectEmit(true, false, false, true, address(market));
        emit LossRecognized(address(vault), principal);
        market.recognizeLoss(address(vault));

        assertEq(market.outstanding(), 0, "receivable removed");
        assertEq(market.totalAssets(), assetsBefore - principal, "pool takes the loss");
        (uint256 princAfter,) = market.lienRecords(address(vault));
        assertEq(princAfter, 0, "lien record cleared");
        (,, bool active) = vault.lien();
        assertFalse(active, "vault lien cleared");
    }

    function test_recognizeLoss_revertsWhenNotLiquidated() public {
        _rescuedAndDue(); // trove still active
        vm.expectRevert(RescueMarket.NotLiquidated.selector);
        market.recognizeLoss(address(vault));
    }

    function test_recognizeLoss_revertsWhenNoLien() public {
        vm.expectRevert(RescueMarket.NoActiveLien.selector);
        market.recognizeLoss(address(vault));
    }

    // ------------------------------------------------------------ combined-ICR cap (T1.7b)

    /// @dev Whenever a rescue runs, the borrower's combined obligation (base debt + fee + tip) stays
    ///      at or above the combined-ICR floor — the strategic-default guard. A larger maxRescue lets
    ///      the combined cap, not maxRescue, be the binding constraint.
    function testFuzz_rescue_keepsCombinedIcrAboveFloor(uint256 price) public {
        price = bound(price, 3900e18, 4400e18); // ICR ~122%..137%: low enough to make the cap bite
        PositionVault v = _vaultWith(makeAddr("cf"), DEBT, 5000e18);
        _setPrice(price);
        RescueMarket.Quote memory q = market.previewRescue(address(v));
        if (q.status != RescueMarket.RescueStatus.Ok) return; // below the floor -> no rescue

        uint256 collValue = tm.getTroveColl(address(v)) * price / 1e18;
        uint256 combinedObligation = tm.getTroveDebt(address(v)) + q.fee + q.tip;
        uint256 combinedICR = collValue * 1e18 / combinedObligation;
        assertGe(combinedICR + 1e15, market.combinedICRFloor(), "combined ICR >= floor (1e-3 tol)");
    }

    function test_rescue_combinedCapShrinksLateRescue() public {
        // A late rescue at ICR ~121% (just under a 130% trigger): the target-restoring repay would
        // push combined ICR below the 120% floor, so the cap shrinks the repay to hold the floor.
        PositionVault v = _newVault(makeAddr("late"));
        vm.deal(makeAddr("late"), COLL);
        vm.startPrank(makeAddr("late"));
        v.open{value: COLL}(DEBT, address(0), address(0));
        v.setRescueTerms(1.3e18, 1.7e18, 5000e18); // trigger 130%, big maxRescue
        v.optIn();
        vm.stopPrank();

        _setPrice(3875e18); // ICR ~121%
        RescueMarket.Quote memory q = market.previewRescue(address(v));
        assertEq(uint8(q.status), uint8(RescueMarket.RescueStatus.Ok), "rescue still allowed");
        assertGt(q.repay, 0, "a (capped) rescue still happens");

        uint256 collValue = COLL * 3875e18 / 1e18;
        uint256 combinedICR = collValue * 1e18 / (tm.getTroveDebt(address(v)) + q.fee + q.tip);
        assertGe(combinedICR + 1e15, 1.2e18, "combined ICR held at the floor");
    }

    function test_rescue_belowCombinedFloorBlocksRescue() public {
        // ICR already under the 120% floor: a rescue can't keep the combined position above it.
        PositionVault v = _vaultWith(makeAddr("under"), DEBT, 5000e18);
        _setPrice(3400e18); // ICR ~106%, below the 120% combined floor
        RescueMarket.Quote memory q = market.previewRescue(address(v));
        assertEq(uint8(q.status), uint8(RescueMarket.RescueStatus.NothingToRescue), "no rescue below the floor");
    }
}
