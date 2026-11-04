// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITroveManager} from "../../src/interfaces/ITroveManager.sol";
import {PositionVault} from "../../src/PositionVault.sol";
import {MarketFixture, RescueMarketHarness} from "../unit/utils/MarketFixture.sol";
import {MockBorrowerOperations, MockTroveManager, MockMUSD, MockPriceFeed} from "../unit/mocks/MockMusd.sol";

/// @notice Drives random sequences of pool + rescue + seizure actions so the invariants below are
///         checked after each step. Actions are bounded and revert-tolerant (try/catch) so the
///         fuzzer keeps exploring useful states instead of getting stuck.
contract MarketHandler is Test {
    RescueMarketHarness internal immutable market;
    MockBorrowerOperations internal immutable bo;
    MockTroveManager internal immutable tm;
    MockMUSD internal immutable musd;
    MockPriceFeed internal immutable pf;
    address internal immutable keeper;

    PositionVault[] internal vaults;
    address[] internal actors;

    constructor(
        RescueMarketHarness _market,
        MockBorrowerOperations _bo,
        MockPriceFeed _pf,
        address _keeper,
        PositionVault[] memory _vaults,
        address[] memory _actors
    ) {
        market = _market;
        bo = _bo;
        tm = _bo.troveManager();
        musd = _bo.musd();
        pf = _pf;
        keeper = _keeper;
        for (uint256 i; i < _vaults.length; i++) {
            vaults.push(_vaults[i]);
        }
        for (uint256 i; i < _actors.length; i++) {
            actors.push(_actors[i]);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _vault(uint256 seed) internal view returns (PositionVault) {
        return vaults[seed % vaults.length];
    }

    function deposit(uint256 actorSeed, uint256 amount) external {
        address who = _actor(actorSeed);
        amount = bound(amount, 1e18, 1e24);
        deal(address(musd), who, musd.balanceOf(who) + amount, true);
        vm.startPrank(who);
        musd.approve(address(market), amount);
        try market.deposit(amount) {} catch {}
        vm.stopPrank();
    }

    function withdraw(uint256 actorSeed, uint256 sharesSeed) external {
        address who = _actor(actorSeed);
        uint256 shares = bound(sharesSeed, 0, market.sharesOf(who));
        if (shares == 0) return;
        vm.prank(who);
        try market.withdraw(shares) {} catch {}
    }

    function movePrice(uint256 p) external {
        p = bound(p, 2800e18, 6000e18); // ICR spans ~Recovery..healthy on the test troves
        pf.setPrice(p);
        bo.setPrice(p);
    }

    function rescue(uint256 vaultSeed) external {
        vm.prank(keeper);
        try market.rescue(address(_vault(vaultSeed)), address(0), address(0)) {} catch {}
    }

    function repay(uint256 vaultSeed, uint256 payerSeed) external {
        PositionVault v = _vault(vaultSeed);
        (uint256 principal, uint256 fee) = market.lienRecords(address(v));
        if (principal == 0) return;
        address payer = _actor(payerSeed);
        deal(address(musd), payer, principal + fee, true);
        vm.startPrank(payer);
        musd.approve(address(market), principal + fee);
        try market.repayLien(address(v)) {} catch {}
        vm.stopPrank();
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 10 days));
    }

    function claim(uint256 vaultSeed) external {
        vm.prank(keeper);
        try market.claimLien(address(_vault(vaultSeed)), address(0), address(0)) {} catch {}
    }

    function liquidateAndRecognize(uint256 vaultSeed) external {
        PositionVault v = _vault(vaultSeed);
        (uint256 principal,) = market.lienRecords(address(v));
        if (principal == 0) return;
        // Simulate MUSD liquidating the trove: collateral gone, status closedByLiquidation.
        vm.prank(address(bo));
        tm.set(address(v), ITroveManager.Status.closedByLiquidation, 0, 0);
        try market.recognizeLoss(address(v)) {} catch {}
    }

    function vaultCount() external view returns (uint256) {
        return vaults.length;
    }

    function vaultAt(uint256 i) external view returns (PositionVault) {
        return vaults[i];
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function actorAt(uint256 i) external view returns (address) {
        return actors[i];
    }
}

/// @notice T1.8: invariant suite for architecture §4. Exercises deposits, withdrawals, rescues,
///         repayments, seizures and losses against the mock MUSD stack.
contract MarketInvariantsTest is MarketFixture {
    uint256 internal constant COLL = 1 ether;
    uint256 internal constant DEBT = 3000e18;
    uint256 internal constant TRIGGER = 1.4e18;
    uint256 internal constant TARGET = 1.8e18;
    uint256 internal constant MAX_RESCUE = 2000e18;

    address internal keeper = makeAddr("keeper");
    MarketHandler internal handler;

    function setUp() public override {
        super.setUp();

        // Seed baseline liquidity so rescues can run.
        _deposit(makeAddr("seed-provider"), 30_000e18);

        PositionVault[] memory vs = new PositionVault[](3);
        for (uint256 i; i < 3; i++) {
            vs[i] = _vaultWithTrove(makeAddr(string.concat("owner", vm.toString(i))));
        }
        address[] memory as_ = new address[](3);
        as_[0] = makeAddr("seed-provider");
        as_[1] = makeAddr("alice");
        as_[2] = makeAddr("bob");

        handler = new MarketHandler(market, bo, pf, keeper, vs, as_);

        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.withdraw.selector;
        selectors[2] = handler.movePrice.selector;
        selectors[3] = handler.rescue.selector;
        selectors[4] = handler.repay.selector;
        selectors[5] = handler.warp.selector;
        selectors[6] = handler.claim.selector;
        selectors[7] = handler.liquidateAndRecognize.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function _vaultWithTrove(address owner_) internal returns (PositionVault v) {
        v = _newVault(owner_);
        vm.deal(owner_, COLL);
        vm.startPrank(owner_);
        v.open{value: COLL}(DEBT, address(0), address(0));
        v.setRescueTerms(TRIGGER, TARGET, MAX_RESCUE);
        v.optIn();
        vm.stopPrank();
    }

    /// @dev §4.5 (MUSD side): the market's real MUSD balance always equals its claimed liquid assets.
    function invariant_musdBalanceEqualsLiquid() public view {
        assertEq(musd.balanceOf(address(market)), market.liquidAssets());
    }

    /// @dev §4.5 (BTC side): the market's real BTC balance always equals its accounted BTC holdings.
    function invariant_btcBalanceEqualsHeld() public view {
        assertEq(address(market).balance, market.btcHeld());
    }

    /// @dev Lent MUSD never exceeds pool assets (liquidAssets stays non-negative).
    function invariant_outstandingWithinManaged() public view {
        assertLe(market.outstanding(), market.totalManaged());
    }

    /// @dev Vault liens and the market's lien records stay in lock-step.
    function invariant_lienRecordsMatchVaultLiens() public view {
        uint256 n = handler.vaultCount();
        for (uint256 i; i < n; i++) {
            PositionVault v = handler.vaultAt(i);
            (uint256 principal,) = market.lienRecords(address(v));
            (,, bool active) = v.lien();
            assertEq(principal > 0, active, "lien record and vault lien agree");
        }
    }

    /// @dev Shares are only ever held by known actors, so their holdings sum to the total supply.
    function invariant_sharesSumToTotal() public view {
        uint256 sum;
        uint256 n = handler.actorCount();
        for (uint256 i; i < n; i++) {
            sum += market.sharesOf(handler.actorAt(i));
        }
        assertEq(sum, market.totalShares());
    }
}
