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
    error NoActiveLien();
    error LienNotDue();
    error NothingSeized();
    error NotLiquidated();
    error BTCTransferFailed();

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
    /// @notice Emitted when a provider withdraws (pro-rata MUSD + seized BTC).
    /// @param provider Withdrawer
    /// @param shares Shares burned
    /// @param musdOut MUSD paid out // 1e18
    /// @param btcOut BTC paid out // 1e18
    event Withdrawn(address indexed provider, uint256 shares, uint256 musdOut, uint256 btcOut);
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

    /// @notice Emitted when a lien is repaid in full.
    /// @param vault Vault whose lien was repaid
    /// @param payer Who paid (owner or anyone else)
    /// @param principal MUSD returned to the pool (repay + tip) // 1e18
    /// @param fee Fee booked as provider income // 1e18
    event LienRepaid(address indexed vault, address indexed payer, uint256 principal, uint256 fee);

    /// @notice Emitted when a keeper seizes BTC toward an overdue lien (T1.7b).
    /// @param vault Vault seized from
    /// @param keeper Caller
    /// @param btcSeized BTC taken into the pool // 1e18
    /// @param lienReduced MUSD of lien the seizure satisfied // 1e18
    /// @param remaining Lien still outstanding after the seizure (0 if cleared) // 1e18
    event LienClaimed(
        address indexed vault, address indexed keeper, uint256 btcSeized, uint256 lienReduced, uint256 remaining
    );

    /// @notice Emitted when the pool writes off a lien whose trove was liquidated (T1.7b).
    /// @param vault Vault whose trove was liquidated
    /// @param principalLost MUSD principal the pool can no longer recover // 1e18
    event LossRecognized(address indexed vault, uint256 principalLost);

    /// @dev Virtual shares/assets (OZ ERC4626 decimals-offset pattern, offset 3).
    uint256 internal constant VIRTUAL_SHARES = 1e3;
    uint256 internal constant VIRTUAL_ASSETS = 1;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant DECIMAL_PRECISION = 1e18;
    uint256 internal constant NICR_PRECISION = 1e20;
    /// @notice Upper bound on the keeper tip (1%).
    uint256 public constant MAX_TIP_BPS = 100;
    /// @notice Upper bound on the seizure penalty (20%).
    uint256 public constant MAX_PENALTY_BPS = 2000;

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
    /// @notice Penalty added to the lien value a seizure claims, in basis points (T1.7b).
    uint256 public immutable seizePenaltyBps;
    /// @notice Combined-ICR floor a rescue must keep the borrower above, guarding against strategic
    ///         default (T1.7b). // 1e18 = 100%
    uint256 public immutable combinedICRFloor;

    /// @notice Shares held per provider.
    mapping(address provider => uint256 shares) public sharesOf;
    /// @notice Total shares outstanding.
    uint256 public totalShares;
    /// @notice MUSD lent out in active rescues (repay + tip) // 1e18
    uint256 public outstanding;
    /// @notice Native BTC held by the pool from seizures; shares carry a pro-rata claim on it // 1e18
    uint256 public btcHeld;
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
    /// @param _seizePenaltyBps Seizure penalty in bps, <= MAX_PENALTY_BPS
    /// @param _combinedICRFloor Combined-ICR floor a rescue must preserve, >= 100% // 1e18
    constructor(
        IERC20 _musd,
        IBorrowerOperations _borrowerOperations,
        ITroveManager _troveManager,
        IPriceFeed _priceFeed,
        IFeePricer _pricer,
        VaultFactory _factory,
        uint256 _lienTerm,
        uint256 _tipBps,
        uint256 _seizePenaltyBps,
        uint256 _combinedICRFloor
    ) {
        if (
            address(_musd) == address(0) || address(_borrowerOperations) == address(0)
                || address(_troveManager) == address(0) || address(_priceFeed) == address(0)
                || address(_pricer) == address(0) || address(_factory) == address(0)
        ) revert ZeroAddress();
        if (
            _lienTerm == 0 || _tipBps > MAX_TIP_BPS || _seizePenaltyBps > MAX_PENALTY_BPS
                || _combinedICRFloor < DECIMAL_PRECISION
        ) revert InvalidParams();
        if (_factory.market() != address(this)) revert FactoryMismatch();
        musd = _musd;
        borrowerOperations = _borrowerOperations;
        troveManager = _troveManager;
        priceFeed = _priceFeed;
        pricer = _pricer;
        factory = _factory;
        lienTerm = _lienTerm;
        tipBps = _tipBps;
        seizePenaltyBps = _seizePenaltyBps;
        combinedICRFloor = _combinedICRFloor;
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

    /// @notice Burns the caller's shares and sends their value as pro-rata MUSD + seized BTC.
    ///         The MUSD portion is limited to liquid assets: MUSD lent out in rescues can't be
    ///         withdrawn until repaid or seized.
    /// @param shares Shares to burn
    /// @return musdOut MUSD paid out // 1e18
    /// @return btcOut BTC paid out // 1e18
    function withdraw(uint256 shares) external nonReentrant returns (uint256 musdOut, uint256 btcOut) {
        if (shares == 0) revert ZeroAmount();
        if (shares > sharesOf[msg.sender]) revert InsufficientShares();

        uint256 price = priceFeed.fetchPrice();
        uint256 value = _previewWithdraw(shares, price); // total MUSD-equiv value of the shares
        if (value == 0) revert ZeroAmount();

        // Pro-rata BTC, capped so its value never exceeds the shares' value (rounds to the pool).
        uint256 proRataBtc = totalShares == 0 ? 0 : Math.mulDiv(shares, btcHeld, totalShares);
        uint256 maxBtcByValue = Math.mulDiv(value, DECIMAL_PRECISION, price);
        btcOut = Math.min(proRataBtc, maxBtcByValue);
        musdOut = value - Math.mulDiv(btcOut, price, DECIMAL_PRECISION);
        if (musdOut > liquidAssets()) revert InsufficientLiquidity();

        sharesOf[msg.sender] -= shares;
        totalShares -= shares;
        _totalManaged -= musdOut;
        btcHeld -= btcOut;
        emit Withdrawn(msg.sender, shares, musdOut, btcOut);

        if (musdOut > 0) musd.safeTransfer(msg.sender, musdOut);
        if (btcOut > 0) _sendBTC(msg.sender, btcOut);
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

    /// @notice Repays `vault`'s lien in full (repay + fee + tip) from the caller's MUSD and
    ///         clears it. Anyone may pay. The fee becomes provider income; the lent MUSD is liquid
    ///         again. Allowed after `dueBy` until the lien is claimed (claiming is T1.7b, Wave 2).
    /// @param vault Rescued vault
    function repayLien(address vault) external nonReentrant {
        if (!factory.isVault(vault)) revert NotVault();
        LienRecord memory rec = lienRecords[vault];
        if (rec.principal == 0) revert NoActiveLien();

        delete lienRecords[vault];
        outstanding -= rec.principal;
        _totalManaged += rec.fee;
        emit LienRepaid(vault, msg.sender, rec.principal, rec.fee);

        musd.safeTransferFrom(msg.sender, address(this), rec.principal + rec.fee);
        PositionVault(payable(vault)).clearLien();
    }

    /// @notice Seizes BTC from an overdue vault toward its lien (anyone, after `dueBy`). Takes BTC
    ///         worth the lien + penalty, capped by the `(ICR − MCR)/ICR` withdraw ceiling (0 in
    ///         Recovery Mode), holds it in the pool, and reduces the lien by the value recovered.
    ///         A ceiling-capped claim is partial and may be repeated as the trove's ICR recovers.
    /// @dev Hints are for the vault's trove after the withdrawal; a keeper computes them from the
    ///      post-seizure collateral. Checks-Effects-Interactions: pool accounting updates before the
    ///      external seizure, and the BTC arrives via `receive` during it.
    /// @param vault Vault to seize from
    /// @param upperHint Insert-position hint
    /// @param lowerHint Insert-position hint
    function claimLien(address vault, address upperHint, address lowerHint) external nonReentrant {
        if (!factory.isVault(vault)) revert NotVault();
        LienRecord memory rec = lienRecords[vault];
        if (rec.principal == 0) revert NoActiveLien();
        (uint256 lienAmount, uint256 dueBy, bool active) = PositionVault(payable(vault)).lien();
        if (!active) revert NoActiveLien();
        if (block.timestamp < dueBy) revert LienNotDue();

        // Seizure math is in a helper to keep this frame shallow (avoids "stack too deep").
        (uint256 seizeBtc, uint256 lienReduced, uint256 principalRecovered) =
            _seizureAmounts(vault, priceFeed.fetchPrice(), lienAmount, rec.principal);
        if (seizeBtc == 0) revert NothingSeized();

        uint256 remaining = lienAmount - lienReduced;
        if (remaining == 0) {
            delete lienRecords[vault];
        } else {
            lienRecords[vault].principal = rec.principal - principalRecovered;
            lienRecords[vault].fee = rec.fee - (lienReduced - principalRecovered);
        }
        outstanding -= principalRecovered; // receivable settled by BTC
        _totalManaged -= principalRecovered;
        btcHeld += seizeBtc;
        emit LienClaimed(vault, msg.sender, seizeBtc, lienReduced, remaining);

        PositionVault(payable(vault)).seizeForLien(seizeBtc, lienReduced, upperHint, lowerHint);
    }

    /// @dev BTC to seize, lien value it satisfies, and principal recovered. Takes BTC worth the
    ///      lien + penalty, capped by the withdraw ceiling; the lien reduces by the seized value net
    ///      of penalty (capped at the lien), and principal is recovered pro-rata of the lien.
    function _seizureAmounts(address vault, uint256 price, uint256 lienAmount, uint256 principal)
        internal
        view
        returns (uint256 seizeBtc, uint256 lienReduced, uint256 principalRecovered)
    {
        uint256 totalClaim = lienAmount + Math.mulDiv(lienAmount, seizePenaltyBps, BPS);
        uint256 desiredBtc = Math.mulDiv(totalClaim, DECIMAL_PRECISION, price, Math.Rounding.Ceil);
        seizeBtc = Math.min(desiredBtc, _seizeCeiling(vault, price));
        if (seizeBtc == 0) return (0, 0, 0);
        uint256 seizedValue = Math.mulDiv(seizeBtc, price, DECIMAL_PRECISION);
        lienReduced = Math.min(lienAmount, Math.mulDiv(seizedValue, BPS, BPS + seizePenaltyBps));
        principalRecovered = Math.mulDiv(lienReduced, principal, lienAmount);
    }

    /// @notice Writes off a lien whose trove was liquidated by MUSD (anyone). The lent principal is
    ///         unrecoverable, so the pool realises the loss; the fee (never booked) is simply dropped.
    /// @param vault Vault whose trove was liquidated
    function recognizeLoss(address vault) external nonReentrant {
        if (!factory.isVault(vault)) revert NotVault();
        LienRecord memory rec = lienRecords[vault];
        if (rec.principal == 0) revert NoActiveLien();
        if (troveManager.getTroveStatus(vault) != ITroveManager.Status.closedByLiquidation) revert NotLiquidated();

        delete lienRecords[vault];
        outstanding -= rec.principal;
        _totalManaged -= rec.principal; // loss to providers
        emit LossRecognized(vault, rec.principal);

        (,, bool active) = PositionVault(payable(vault)).lien();
        if (active) PositionVault(payable(vault)).clearLien();
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

    /// @notice Pool assets backing all shares, in MUSD terms: liquid MUSD + outstanding rescues +
    ///         held BTC valued at the live price.
    /// @return MUSD-equivalent // 1e18
    function totalAssets() public view returns (uint256) {
        return _totalAssets(priceFeed.fetchPrice());
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
        return Math.mulDiv(assets, totalShares + VIRTUAL_SHARES, totalAssets() + VIRTUAL_ASSETS, Math.Rounding.Floor);
    }

    /// @notice MUSD-equivalent value that burning `shares` would pay out now (MUSD + BTC, rounded down).
    /// @param shares Shares
    /// @return MUSD-equivalent // 1e18
    function previewWithdraw(uint256 shares) public view returns (uint256) {
        return _previewWithdraw(shares, priceFeed.fetchPrice());
    }

    /// @dev Pool value in MUSD terms at an explicit price (avoids a second oracle read in withdraw).
    function _totalAssets(uint256 price) internal view returns (uint256) {
        return _totalManaged + Math.mulDiv(btcHeld, price, DECIMAL_PRECISION);
    }

    /// @dev Shares' MUSD-equivalent value at an explicit price (rounded down, in the pool's favour).
    function _previewWithdraw(uint256 shares, uint256 price) internal view returns (uint256) {
        return
            Math.mulDiv(shares, _totalAssets(price) + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES, Math.Rounding.Floor);
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
        // Strategic-default guard (T1.7b): keep combined ICR (collateral vs base debt + fee + tip)
        // at or above combinedICRFloor. A capped repay recomputes its (smaller) fee and tip.
        uint256 capped = _combinedCap(coll, debt, price, q.fee + q.tip, q.repay);
        if (capped < q.repay) {
            q.repay = capped;
            if (q.repay == 0) return _status(q, RescueStatus.NothingToRescue);
            _setFeeAndTip(q, coll, price);
        }

        q.newNICR = Math.mulDiv(coll, NICR_PRECISION, debt - q.repay);
        return q;
    }

    /// @dev Largest repay keeping combined ICR >= combinedICRFloor. A rescue moves the borrower's
    ///      obligation from `debt` to `debt + fee + tip`, so the extra (fee + tip) must fit the
    ///      budget `collValue/floor − debt`. Returns `repay` unchanged when it already fits, a
    ///      smaller value to shrink it, or 0 when the position is already at or below the floor.
    function _combinedCap(uint256 coll, uint256 debt, uint256 price, uint256 feeTip, uint256 repay)
        internal
        view
        returns (uint256)
    {
        uint256 budgetCap =
            Math.mulDiv(Math.mulDiv(coll, price, DECIMAL_PRECISION), DECIMAL_PRECISION, combinedICRFloor);
        if (budgetCap <= debt) return 0;
        uint256 budget = budgetCap - debt; // max fee + tip the floor allows
        if (feeTip <= budget) return repay;
        return Math.mulDiv(repay, budget, feeTip); // scale down so fee + tip ~ budget (fee is sub-linear)
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

    /// @dev Max BTC a standalone withdrawal can pull: `(ICR − MCR)/ICR · coll`, and 0 in Recovery
    ///      Mode (MUSD blocks any withdrawal then). Floored so a seizure stays within MUSD's limit.
    function _seizeCeiling(address vault, uint256 price) internal view returns (uint256) {
        if (troveManager.checkRecoveryMode(price)) return 0;
        uint256 icr = troveManager.getCurrentICR(vault, price);
        uint256 mcr = troveManager.MCR();
        if (icr <= mcr) return 0;
        (uint256 coll,) = _collAndDebt(vault);
        return Math.mulDiv(coll, icr - mcr, icr, Math.Rounding.Floor);
    }

    /// @dev Sends native BTC, reverting on failure.
    function _sendBTC(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert BTCTransferFailed();
    }

    /// @notice Accepts BTC forwarded by a vault during a seizure. `btcHeld` is only credited inside
    ///         `claimLien`, so stray BTC sent here is ignored by the share price (like MUSD donations).
    receive() external payable {}
}
