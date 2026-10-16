// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IBorrowerOperations} from "./interfaces/IBorrowerOperations.sol";
import {ITroveManager} from "./interfaces/ITroveManager.sol";
import {IPriceFeed} from "./interfaces/IPriceFeed.sol";
import {IFeePricer} from "./interfaces/IFeePricer.sol";
import {VaultFactory} from "./VaultFactory.sol";
import {PositionVault} from "./PositionVault.sol";

/// @title RescueMarket
/// @notice Pool of MUSD from rescue providers. Providers deposit MUSD for shares; anyone (a
///         keeper) can rescue an opted-in vault whose ICR fell below its trigger: the pool repays
///         debt to restore the target ICR and takes a lien of repay + fee + keeper tip.
/// @dev Shares are internal (no token in Wave 1), ERC-4626-style math with a virtual offset,
///      rounding in the pool's favour. Pool assets are tracked in `_totalManaged` (not the MUSD
///      balance) so donations can't move the share price. MUSD lent out in rescues stays in
///      `_totalManaged` as `outstanding` and can't be withdrawn until repaid. Fees are counted as
///      income on repayment (T1.7), not at rescue time.
contract RescueMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroAmount();
    error ZeroShares();
    error InsufficientShares();
    error InsufficientLiquidity();
    error InvalidParams();
    error FactoryMismatch();
    error NotVault();
    error NotOptedIn();
    error LienActive();
    error AboveTrigger();
    error NothingToRescue();

    /// @notice Why a vault can or can't be rescued right now.
    enum RescueStatus {
        Ok,
        NotVault,
        NotOptedIn,
        LienActive,
        AboveTrigger,
        NothingToRescue
    }

    /// @notice What a rescue would do now (see previewRescue).
    /// @param status Whether the rescue can run
    /// @param icr Vault ICR before the rescue // 1e18 = 100%
    /// @param repay MUSD debt the pool would repay // 1e18
    /// @param fee Rescue fee added to the lien // 1e18
    /// @param tip Keeper tip, paid by the pool and added to the lien // 1e18
    /// @param newNICR Vault nominal ICR after the rescue, for insert hints // 1e20 NICR scale
    struct Quote {
        RescueStatus status;
        uint256 icr;
        uint256 repay;
        uint256 fee;
        uint256 tip;
        uint256 newNICR;
    }

    /// @notice Market-side record of a vault's lien.
    /// @param principal MUSD the pool paid out (repay + tip) // 1e18
    /// @param fee Fee owed on top, income for providers once repaid // 1e18
    struct LienRecord {
        uint256 principal;
        uint256 fee;
    }

    /// @notice Emitted when a provider deposits MUSD.
    /// @param provider Depositor
    /// @param assets MUSD deposited // 1e18
    /// @param shares Shares minted
    event Deposited(address indexed provider, uint256 assets, uint256 shares);
    /// @notice Emitted when a provider withdraws.
    /// @param provider Withdrawer
    /// @param shares Shares burned
    /// @param assets MUSD paid out // 1e18
    event Withdrawn(address indexed provider, uint256 shares, uint256 assets);
    /// @notice Emitted when a vault is rescued.
    /// @param vault Rescued vault
    /// @param keeper Caller, paid the tip
    /// @param repaid MUSD debt repaid // 1e18
    /// @param fee Rescue fee // 1e18
    /// @param tip Keeper tip // 1e18
    /// @param dueBy Lien deadline (unix seconds)
    event Rescued(
        address indexed vault, address indexed keeper, uint256 repaid, uint256 fee, uint256 tip, uint256 dueBy
    );

    /// @dev Virtual shares/assets (OZ ERC4626 decimals-offset pattern, offset 3).
    uint256 internal constant VIRTUAL_SHARES = 1e3;
    uint256 internal constant VIRTUAL_ASSETS = 1;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant DECIMAL_PRECISION = 1e18;
    uint256 internal constant NICR_PRECISION = 1e20;
    /// @notice Upper bound on the keeper tip (1%).
    uint256 public constant MAX_TIP_BPS = 100;

    /// @notice MUSD token.
    IERC20 public immutable musd;
    /// @notice MUSD BorrowerOperations (min debt, gas compensation).
    IBorrowerOperations public immutable borrowerOperations;
    /// @notice MUSD TroveManager (ICR, debt, TCR).
    ITroveManager public immutable troveManager;
    /// @notice MUSD PriceFeed: the only price source.
    IPriceFeed public immutable priceFeed;
    /// @notice Rescue fee pricer.
    IFeePricer public immutable pricer;
    /// @notice Factory whose vaults this market rescues.
    VaultFactory public immutable factory;
    /// @notice Time a borrower has to repay a lien (seconds).
    uint256 public immutable lienTerm;
    /// @notice Keeper tip in basis points of the repaid amount.
    uint256 public immutable tipBps;

    /// @notice Shares held per provider.
    mapping(address provider => uint256 shares) public sharesOf;
    /// @notice Total shares outstanding.
    uint256 public totalShares;
    /// @notice MUSD lent out in active rescues (repay + tip) // 1e18
    uint256 public outstanding;
    /// @notice Lien record per rescued vault.
    mapping(address vault => LienRecord) public lienRecords;

    /// @dev Pool assets in MUSD: liquid + outstanding // 1e18
    uint256 internal _totalManaged;

    /// @dev The factory must already point at this market's address (predicted at deploy time).
    /// @param _musd MUSD token
    /// @param _borrowerOperations MUSD BorrowerOperations
    /// @param _troveManager MUSD TroveManager
    /// @param _priceFeed MUSD PriceFeed
    /// @param _pricer Fee pricer
    /// @param _factory VaultFactory deployed with market = this address
    /// @param _lienTerm Seconds a borrower has to repay a lien, > 0
    /// @param _tipBps Keeper tip in bps, <= MAX_TIP_BPS
    constructor(
        IERC20 _musd,
        IBorrowerOperations _borrowerOperations,
        ITroveManager _troveManager,
        IPriceFeed _priceFeed,
        IFeePricer _pricer,
        VaultFactory _factory,
        uint256 _lienTerm,
        uint256 _tipBps
    ) {
        if (
            address(_musd) == address(0) || address(_borrowerOperations) == address(0)
                || address(_troveManager) == address(0) || address(_priceFeed) == address(0)
                || address(_pricer) == address(0) || address(_factory) == address(0)
        ) revert ZeroAddress();
        if (_lienTerm == 0 || _tipBps > MAX_TIP_BPS) revert InvalidParams();
        if (_factory.market() != address(this)) revert FactoryMismatch();
        musd = _musd;
        borrowerOperations = _borrowerOperations;
        troveManager = _troveManager;
        priceFeed = _priceFeed;
        pricer = _pricer;
        factory = _factory;
        lienTerm = _lienTerm;
        tipBps = _tipBps;
    }

    // ------------------------------------------------------------ providers

    /// @notice Deposits MUSD and mints shares to the caller.
    /// @param assets MUSD to deposit // 1e18
    /// @return shares Shares minted
    function deposit(uint256 assets) external nonReentrant returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        shares = previewDeposit(assets);
        if (shares == 0) revert ZeroShares();

        sharesOf[msg.sender] += shares;
        totalShares += shares;
        _totalManaged += assets;
        emit Deposited(msg.sender, assets, shares);

        musd.safeTransferFrom(msg.sender, address(this), assets);
    }

    /// @notice Burns the caller's shares and sends the corresponding MUSD. Limited to liquid
    ///         assets: MUSD lent out in rescues can't be withdrawn until repaid.
    /// @param shares Shares to burn
    /// @return assets MUSD paid out // 1e18
    function withdraw(uint256 shares) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        if (shares > sharesOf[msg.sender]) revert InsufficientShares();
        assets = previewWithdraw(shares);
        if (assets == 0) revert ZeroAmount();
        if (assets > liquidAssets()) revert InsufficientLiquidity();

        sharesOf[msg.sender] -= shares;
        totalShares -= shares;
        _totalManaged -= assets;
        emit Withdrawn(msg.sender, shares, assets);

        musd.safeTransfer(msg.sender, assets);
    }

    // ------------------------------------------------------------ rescue

    /// @notice Rescues `vault`: repays enough debt to restore its target ICR (capped by its
    ///         maxRescue, pool liquidity and MUSD's min net debt), records a lien of
    ///         repay + fee + tip, and pays the caller the tip.
    /// @dev Hints must be computed for `previewRescue(vault).newNICR`.
    /// @param vault Vault to rescue
    /// @param upperHint Insert-position hint
    /// @param lowerHint Insert-position hint
    function rescue(address vault, address upperHint, address lowerHint) external nonReentrant {
        Quote memory q = previewRescue(vault);
        _revertIfNotOk(q.status);

        uint256 lent = q.repay + q.tip;
        uint256 dueBy = block.timestamp + lienTerm;
        outstanding += lent;
        lienRecords[vault] = LienRecord(lent, q.fee);
        emit Rescued(vault, msg.sender, q.repay, q.fee, q.tip, dueBy);

        musd.safeTransfer(vault, q.repay);
        PositionVault(payable(vault)).applyRescue(q.repay, q.fee + q.tip, dueBy, upperHint, lowerHint);
        if (q.tip > 0) musd.safeTransfer(msg.sender, q.tip);
    }

    /// @notice What `rescue(vault)` would do now. Never reverts for an unrescuable vault: the
    ///         status says why. Used by keepers (hints) and the UI (cost before signing).
    /// @param vault Vault to price
    /// @return q The quote
    function previewRescue(address vault) public view returns (Quote memory q) {
        if (!factory.isVault(vault)) return _status(q, RescueStatus.NotVault);
        PositionVault v = PositionVault(payable(vault));
        if (!v.optedIn()) return _status(q, RescueStatus.NotOptedIn);
        (,, bool lienActive) = v.lien();
        if (lienActive) return _status(q, RescueStatus.LienActive);

        return _quoteBelowTrigger(vault, v, q);
    }

    // ------------------------------------------------------------ views

    /// @notice Pool assets backing all shares: liquid MUSD + outstanding rescues.
    /// @return MUSD // 1e18
    function totalAssets() public view returns (uint256) {
        return _totalManaged;
    }

    /// @notice MUSD available for withdrawals and new rescues.
    /// @return MUSD // 1e18
    function liquidAssets() public view returns (uint256) {
        return _totalManaged - outstanding;
    }

    /// @notice Shares a deposit of `assets` would mint now (rounded down).
    /// @param assets MUSD // 1e18
    /// @return Shares
    function previewDeposit(uint256 assets) public view returns (uint256) {
        return Math.mulDiv(assets, totalShares + VIRTUAL_SHARES, _totalManaged + VIRTUAL_ASSETS, Math.Rounding.Floor);
    }

    /// @notice MUSD that burning `shares` would pay out now (rounded down).
    /// @param shares Shares
    /// @return MUSD // 1e18
    function previewWithdraw(uint256 shares) public view returns (uint256) {
        return Math.mulDiv(shares, _totalManaged + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES, Math.Rounding.Floor);
    }

    // ------------------------------------------------------------ internals

    /// @dev Debt to repay so ICR reaches `target`, capped by maxRescue, liquidity (repay + tip
    ///      must fit) and MUSD's rule that net debt (debt - gas comp) stays >= minNetDebt.
    ///      Rounds the target debt down so a full rescue lands at or just above `target`.
    function _repayAmount(uint256 coll, uint256 debt, uint256 price, uint256 target, uint256 maxRescue)
        internal
        view
        returns (uint256 repay)
    {
        uint256 targetDebt = Math.mulDiv(coll, price, target);
        if (debt <= targetDebt) return 0;
        repay = Math.min(debt - targetDebt, maxRescue);
        repay = Math.min(repay, Math.mulDiv(liquidAssets(), BPS, BPS + tipBps));

        uint256 netDebt = debt - borrowerOperations.MUSD_GAS_COMPENSATION();
        uint256 minNetDebt = borrowerOperations.minNetDebt();
        uint256 headroom = netDebt > minNetDebt ? netDebt - minNetDebt : 0;
        repay = Math.min(repay, headroom);
    }

    /// @dev Second half of previewRescue (split to keep the stack shallow): trigger check,
    ///      repay sizing, fee and tip.
    function _quoteBelowTrigger(address vault, PositionVault v, Quote memory q) internal view returns (Quote memory) {
        (uint256 trigger, uint256 target, uint256 maxRescue) = v.rescueTerms();
        uint256 price = priceFeed.fetchPrice();
        q.icr = troveManager.getCurrentICR(vault, price);
        if (q.icr >= trigger) return _status(q, RescueStatus.AboveTrigger);

        (uint256 coll, uint256 debt) = _collAndDebt(vault);
        q.repay = _repayAmount(coll, debt, price, target, maxRescue);
        if (q.repay == 0) return _status(q, RescueStatus.NothingToRescue);

        _setFeeAndTip(q, coll, price);
        q.newNICR = Math.mulDiv(coll, NICR_PRECISION, debt - q.repay);
        return q;
    }

    /// @dev Collateral and entire debt (incl. accrued interest and pending redistributions),
    ///      the same figures MUSD uses for ICR and for the min-net-debt check on repay.
    function _collAndDebt(address vault) internal view returns (uint256 coll, uint256 debt) {
        uint256 principal;
        uint256 interest;
        (coll, principal, interest,,,) = troveManager.getEntireDebtAndColl(vault);
        debt = principal + interest;
    }

    /// @dev Fee from the pricer (rounded up, in the pool's favour) and keeper tip (rounded down).
    function _setFeeAndTip(Quote memory q, uint256 coll, uint256 price) internal view {
        uint256 collValue = Math.mulDiv(coll, price, DECIMAL_PRECISION);
        uint256 sizeRatio = Math.mulDiv(q.repay, DECIMAL_PRECISION, collValue);
        uint256 feeBps = pricer.feeBps(q.icr, sizeRatio, troveManager.getTCR(price));
        q.fee = Math.mulDiv(q.repay, feeBps, BPS, Math.Rounding.Ceil);
        q.tip = Math.mulDiv(q.repay, tipBps, BPS);
    }

    function _status(Quote memory q, RescueStatus status) internal pure returns (Quote memory) {
        q.status = status;
        return q;
    }

    function _revertIfNotOk(RescueStatus status) internal pure {
        if (status == RescueStatus.Ok) return;
        if (status == RescueStatus.NotVault) revert NotVault();
        if (status == RescueStatus.NotOptedIn) revert NotOptedIn();
        if (status == RescueStatus.LienActive) revert LienActive();
        if (status == RescueStatus.AboveTrigger) revert AboveTrigger();
        revert NothingToRescue();
    }
}
