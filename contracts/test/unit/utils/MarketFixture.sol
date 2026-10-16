// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RescueMarket} from "../../../src/RescueMarket.sol";
import {VaultFactory} from "../../../src/VaultFactory.sol";
import {PositionVault} from "../../../src/PositionVault.sol";
import {MinimalFeePricer} from "../../../src/MinimalFeePricer.sol";
import {IFeePricer} from "../../../src/interfaces/IFeePricer.sol";
import {IBorrowerOperations} from "../../../src/interfaces/IBorrowerOperations.sol";
import {ITroveManager} from "../../../src/interfaces/ITroveManager.sol";
import {IPriceFeed} from "../../../src/interfaces/IPriceFeed.sol";
import {MockBorrowerOperations, MockMUSD, MockTroveManager, MockPriceFeed} from "../mocks/MockMusd.sol";

/// @dev Test-only: simulates fee income so share-price rounding can be fuzzed (T1.5).
contract RescueMarketHarness is RescueMarket {
    constructor(
        IERC20 _musd,
        IBorrowerOperations _bo,
        ITroveManager _tm,
        IPriceFeed _pf,
        IFeePricer _pricer,
        VaultFactory _factory,
        uint256 _lienTerm,
        uint256 _tipBps
    ) RescueMarket(_musd, _bo, _tm, _pf, _pricer, _factory, _lienTerm, _tipBps) {}

    function harnessAccrue(uint256 amount) external {
        _totalManaged += amount;
    }
}

/// @notice Full mock stack + pricer + factory + market, wired like the deploy script will:
///         the market address is predicted and passed to the factory first.
abstract contract MarketFixture is Test {
    uint256 internal constant LIEN_TERM = 7 days;
    uint256 internal constant TIP_BPS = 10; // 0.1%
    uint256 internal constant MIN_FEE_BPS = 100;
    uint256 internal constant MAX_FEE_BPS = 500;

    MockBorrowerOperations internal bo;
    MockTroveManager internal tm;
    MockMUSD internal musd;
    MockPriceFeed internal pf;
    MinimalFeePricer internal pricer;
    VaultFactory internal factory;
    RescueMarketHarness internal market;

    function setUp() public virtual {
        bo = new MockBorrowerOperations();
        tm = bo.troveManager();
        musd = bo.musd();
        pf = new MockPriceFeed();
        pricer = new MinimalFeePricer(MIN_FEE_BPS, MAX_FEE_BPS, 1.1e18, 1.5e18);

        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        factory = new VaultFactory(
            IBorrowerOperations(address(bo)), ITroveManager(address(tm)), IERC20(address(musd)), predicted
        );
        market = _deployMarket(LIEN_TERM, TIP_BPS);
        assertEq(address(market), predicted, "market at predicted address");
    }

    function _deployMarket(uint256 lienTerm, uint256 tipBps) internal returns (RescueMarketHarness) {
        return new RescueMarketHarness(
            IERC20(address(musd)),
            IBorrowerOperations(address(bo)),
            ITroveManager(address(tm)),
            IPriceFeed(address(pf)),
            pricer,
            factory,
            lienTerm,
            tipBps
        );
    }

    /// @dev Mints MUSD to `who` (deal adjusts totalSupply) and approves the market.
    function _fund(address who, uint256 amount) internal {
        deal(address(musd), who, musd.balanceOf(who) + amount, true);
        vm.prank(who);
        musd.approve(address(market), type(uint256).max);
    }

    function _deposit(address who, uint256 amount) internal returns (uint256 shares) {
        _fund(who, amount);
        vm.prank(who);
        shares = market.deposit(amount);
    }

    /// @dev Fee income: MUSD arrives and is counted as pool assets.
    function _accrue(uint256 amount) internal {
        deal(address(musd), address(market), musd.balanceOf(address(market)) + amount, true);
        market.harnessAccrue(amount);
    }

    function _newVault(address owner_) internal returns (PositionVault) {
        vm.prank(owner_);
        return PositionVault(payable(factory.createVault()));
    }
}
