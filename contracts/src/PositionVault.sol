// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBorrowerOperations} from "./interfaces/IBorrowerOperations.sol";
import {ITroveManager} from "./interfaces/ITroveManager.sol";

/// @title PositionVault
/// @notice Owns exactly one MUSD trove on behalf of its owner. MUSD binds a trove to the
///         calling address, so the vault is the borrower and the owner acts through it.
/// @dev The vault holds no funds between calls: borrowed MUSD and withdrawn BTC go straight to
///      the owner. Only the vault can mutate its trove: MUSD's signature path accepts EOA
///      (ECDSA) signatures only, so this contract must never implement ERC-1271.
contract PositionVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error NotOwner();
    error ZeroAddress();
    error UnauthorizedBTCSender();
    error BTCTransferFailed();
    error InvalidTerms();
    error TermsNotSet();
    error AlreadyOptedIn();
    error NotOptedIn();
    error NotMarket();
    error LienActive();
    error NoActiveLien();
    error LienNotDue();
    error ZeroRescue();
    error RescueTooLarge();
    error InvalidDeadline();
    error InsufficientRescueFunds();

    /// @notice Borrower-chosen rescue terms.
    /// @param triggerICR Rescue allowed when ICR falls below this // 1e18 = 100%
    /// @param targetICR ICR a rescue restores // 1e18 = 100%
    /// @param maxRescue Largest MUSD amount a rescue may repay // 1e18
    struct RescueTerms {
        uint256 triggerICR;
        uint256 targetICR;
        uint256 maxRescue;
    }

    /// @notice A rescue lien: the market's senior claim on the vault.
    /// @param amount MUSD owed to the market: repaid debt + fee // 1e18
    /// @param dueBy Timestamp after which the market may claim BTC (T1.7)
    /// @param active Whether the lien is outstanding
    struct Lien {
        uint256 amount;
        uint256 dueBy;
        bool active;
    }

    /// @notice Emitted when the owner sets rescue terms.
    /// @param triggerICR Rescue trigger // 1e18 = 100%
    /// @param targetICR Rescue target // 1e18 = 100%
    /// @param maxRescue Max MUSD per rescue // 1e18
    event TermsSet(uint256 triggerICR, uint256 targetICR, uint256 maxRescue);
    /// @notice Emitted when the owner opts the vault into rescues.
    event OptedIn();
    /// @notice Emitted when the owner opts the vault out of rescues.
    event OptedOut();
    /// @notice Emitted when the market rescues the vault and records a lien.
    /// @param repaid MUSD debt repaid by the market // 1e18
    /// @param fee Rescue fee added to the lien // 1e18
    /// @param dueBy Lien deadline (unix seconds)
    event LienCreated(uint256 repaid, uint256 fee, uint256 dueBy);
    /// @notice Emitted when the market clears a repaid lien.
    /// @param amount Lien amount that was cleared // 1e18
    event LienCleared(uint256 amount);
    /// @notice Emitted when the market seizes BTC toward an overdue lien (T1.7b).
    /// @param btcAmount BTC withdrawn from the trove and sent to the market // 1e18
    /// @param lienReduced MUSD the seizure credits against the lien // 1e18
    /// @param remaining Lien amount still outstanding after this seizure (0 if cleared) // 1e18
    event LienSeized(uint256 btcAmount, uint256 lienReduced, uint256 remaining);

    /// @notice Owner of the vault and its position.
    address public immutable owner;
    /// @notice MUSD BorrowerOperations.
    IBorrowerOperations public immutable borrowerOperations;
    /// @notice MUSD TroveManager.
    ITroveManager public immutable troveManager;
    /// @notice MUSD token.
    IERC20 public immutable musd;
    /// @notice MUSD ActivePool: sends BTC on withdrawColl and closeTrove.
    address public immutable activePool;
    /// @notice MUSD CollSurplusPool: sends surplus BTC on claimCollateral.
    address public immutable collSurplusPool;
    /// @notice RescueMarket: the only caller of applyRescue / clearLien.
    address public immutable market;

    /// @notice Current rescue terms (all zero until set).
    RescueTerms public rescueTerms;
    /// @notice Whether the vault can currently be rescued.
    bool public optedIn;
    /// @notice Outstanding rescue lien (inactive when zeroed).
    Lien public lien;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyMarket() {
        if (msg.sender != market) revert NotMarket();
        _;
    }

    /// @dev Invariant 2: while a lien is active, collateral stays and the position can't be weakened.
    modifier noLien() {
        if (lien.active) revert LienActive();
        _;
    }

    /// @notice Creates a vault for `_owner`. Normally called by VaultFactory.
    /// @param _owner Vault owner
    /// @param _borrowerOperations MUSD BorrowerOperations
    /// @param _troveManager MUSD TroveManager
    /// @param _musd MUSD token
    /// @param _market RescueMarket
    constructor(
        address _owner,
        IBorrowerOperations _borrowerOperations,
        ITroveManager _troveManager,
        IERC20 _musd,
        address _market
    ) {
        if (
            _owner == address(0) || address(_borrowerOperations) == address(0) || address(_troveManager) == address(0)
                || address(_musd) == address(0) || _market == address(0)
        ) revert ZeroAddress();
        owner = _owner;
        market = _market;
        borrowerOperations = _borrowerOperations;
        troveManager = _troveManager;
        musd = _musd;
        activePool = _borrowerOperations.activePool();
        collSurplusPool = _borrowerOperations.collSurplusPool();
        if (activePool == address(0) || collSurplusPool == address(0)) revert ZeroAddress();
    }

    /// @notice Opens the vault's trove with msg.value BTC and sends the borrowed MUSD to the owner.
    /// @param debt MUSD to borrow (fee and gas compensation are added to the trove's debt) // 1e18
    /// @param upperHint Insert-position hint
    /// @param lowerHint Insert-position hint
    function open(uint256 debt, address upperHint, address lowerHint) external payable nonReentrant onlyOwner {
        borrowerOperations.openTrove{value: msg.value}(debt, upperHint, lowerHint);
        musd.safeTransfer(owner, debt);
    }

    /// @notice Adds msg.value BTC to the vault's trove.
    /// @param upperHint Insert-position hint
    /// @param lowerHint Insert-position hint
    function addColl(address upperHint, address lowerHint) external payable nonReentrant onlyOwner {
        borrowerOperations.addColl{value: msg.value}(upperHint, lowerHint);
    }

    /// @notice Withdraws BTC from the trove and sends it to the owner.
    /// @param amount BTC to withdraw // 1e18
    /// @param upperHint Insert-position hint
    /// @param lowerHint Insert-position hint
    function withdrawColl(uint256 amount, address upperHint, address lowerHint) external nonReentrant onlyOwner noLien {
        borrowerOperations.withdrawColl(amount, upperHint, lowerHint);
        _sendBTC(owner, amount);
    }

    /// @notice Borrows more MUSD against the trove and sends it to the owner.
    /// @param amount MUSD to borrow // 1e18
    /// @param upperHint Insert-position hint
    /// @param lowerHint Insert-position hint
    function borrow(uint256 amount, address upperHint, address lowerHint) external nonReentrant onlyOwner noLien {
        borrowerOperations.withdrawMUSD(amount, upperHint, lowerHint);
        musd.safeTransfer(owner, amount);
    }

    /// @notice Repays trove debt with MUSD pulled from the owner (owner approves the vault first).
    /// @param amount MUSD to repay // 1e18
    /// @param upperHint Insert-position hint
    /// @param lowerHint Insert-position hint
    function repay(uint256 amount, address upperHint, address lowerHint) external nonReentrant onlyOwner {
        musd.safeTransferFrom(msg.sender, address(this), amount); // msg.sender == owner
        borrowerOperations.repayMUSD(amount, upperHint, lowerHint);
    }

    /// @notice Closes the trove. Pulls from the owner exactly the MUSD the vault lacks to repay
    ///         the debt (excluding gas compensation), then sends all BTC and any MUSD left to the owner.
    /// @dev closeTrove accrues interest and applies pending redistributions before burning
    ///      `debt - gas compensation`; getEntireDebtAndColl includes both, so the pull is exact.
    function close() external nonReentrant onlyOwner noLien {
        (, uint256 principal, uint256 interest,,,) = troveManager.getEntireDebtAndColl(address(this));
        uint256 toBurn = principal + interest - borrowerOperations.MUSD_GAS_COMPENSATION();
        uint256 held = musd.balanceOf(address(this));
        if (toBurn > held) musd.safeTransferFrom(msg.sender, address(this), toBurn - held); // msg.sender == owner

        borrowerOperations.closeTrove();

        _sendBTC(owner, address(this).balance);
        uint256 leftover = musd.balanceOf(address(this));
        if (leftover > 0) musd.safeTransfer(owner, leftover);
    }

    /// @notice Moves the trove to the current interest rate (MUSD adds the fee to the debt).
    /// @param upperHint Insert-position hint
    /// @param lowerHint Insert-position hint
    function refinance(address upperHint, address lowerHint) external nonReentrant onlyOwner {
        borrowerOperations.refinance(upperHint, lowerHint);
    }

    /// @notice Claims surplus BTC left after a liquidation or redemption and sends it to the owner.
    function claimCollateral() external nonReentrant onlyOwner noLien {
        borrowerOperations.claimCollateral();
        _sendBTC(owner, address(this).balance);
    }

    /// @notice Sets rescue terms. Requires MCR < trigger < target and maxRescue > 0.
    /// @dev May be changed while opted in; a rescue applies the terms in force when it runs.
    /// @param triggerICR Rescue allowed below this ICR // 1e18 = 100%
    /// @param targetICR ICR a rescue restores // 1e18 = 100%
    /// @param maxRescue Largest MUSD amount a rescue may repay // 1e18
    function setRescueTerms(uint256 triggerICR, uint256 targetICR, uint256 maxRescue) external onlyOwner noLien {
        if (triggerICR <= troveManager.MCR() || targetICR <= triggerICR || maxRescue == 0) revert InvalidTerms();
        rescueTerms = RescueTerms(triggerICR, targetICR, maxRescue);
        emit TermsSet(triggerICR, targetICR, maxRescue);
    }

    /// @notice Opts the vault into rescues. Requires terms to be set.
    function optIn() external onlyOwner {
        if (rescueTerms.maxRescue == 0) revert TermsNotSet();
        if (optedIn) revert AlreadyOptedIn();
        optedIn = true;
        emit OptedIn();
    }

    /// @notice Opts the vault out of rescues.
    function optOut() external onlyOwner noLien {
        if (!optedIn) revert NotOptedIn();
        optedIn = false;
        emit OptedOut();
    }

    /// @notice Repays `repayAmount` of the trove's debt with MUSD the market already sent to the
    ///         vault, and records a lien of `repayAmount + fee` due by `dueBy`.
    /// @dev The market checks the trigger and sizes the repay (T1.6). Repaying debt only raises
    ///      ICR (invariant 4). Lien <= maxRescue + fee holds by the maxRescue check (invariant 3).
    /// @param repayAmount MUSD debt to repay, <= maxRescue // 1e18
    /// @param fee Rescue fee owed on top // 1e18
    /// @param dueBy Lien deadline, must be in the future (unix seconds)
    /// @param upperHint Insert-position hint
    /// @param lowerHint Insert-position hint
    function applyRescue(uint256 repayAmount, uint256 fee, uint256 dueBy, address upperHint, address lowerHint)
        external
        nonReentrant
        onlyMarket
        noLien
    {
        if (!optedIn) revert NotOptedIn();
        if (repayAmount == 0) revert ZeroRescue();
        if (repayAmount > rescueTerms.maxRescue) revert RescueTooLarge();
        if (dueBy <= block.timestamp) revert InvalidDeadline();
        if (musd.balanceOf(address(this)) < repayAmount) revert InsufficientRescueFunds();

        lien = Lien(repayAmount + fee, dueBy, true);
        emit LienCreated(repayAmount, fee, dueBy);

        borrowerOperations.repayMUSD(repayAmount, upperHint, lowerHint);
    }

    /// @notice Clears the lien once the market has been repaid (RescueMarket.repayLien, T1.7).
    function clearLien() external onlyMarket {
        if (!lien.active) revert NoActiveLien();
        uint256 amount = lien.amount;
        delete lien;
        emit LienCleared(amount);
    }

    /// @notice After the lien is due, withdraws `btcAmount` BTC from the trove and sends it to the
    ///         market toward the lien, crediting `lienReduced` MUSD against the outstanding lien
    ///         (clearing it if that covers the full amount). Partial seizures leave the lien active.
    /// @dev The market sizes `btcAmount` to the `(ICR − MCR)/ICR` withdraw ceiling and values
    ///      `lienReduced`; MUSD's `withdrawColl` is the hard guard (it reverts beyond the ceiling
    ///      and entirely in Recovery Mode), so a capped claim simply seizes less. Checks-Effects-
    ///      Interactions: the lien is updated before the external withdrawal.
    /// @param btcAmount BTC to withdraw from the trove and forward to the market // 1e18
    /// @param lienReduced MUSD this seizure credits against the lien // 1e18
    /// @param upperHint Insert-position hint
    /// @param lowerHint Insert-position hint
    function seizeForLien(uint256 btcAmount, uint256 lienReduced, address upperHint, address lowerHint)
        external
        nonReentrant
        onlyMarket
    {
        if (!lien.active) revert NoActiveLien();
        if (block.timestamp < lien.dueBy) revert LienNotDue();

        uint256 remaining;
        if (lienReduced >= lien.amount) {
            delete lien;
        } else {
            lien.amount -= lienReduced;
            remaining = lien.amount;
        }
        emit LienSeized(btcAmount, lienReduced, remaining);

        if (btcAmount > 0) {
            borrowerOperations.withdrawColl(btcAmount, upperHint, lowerHint);
            _sendBTC(market, btcAmount);
        }
    }

    /// @notice Accepts BTC only from MUSD's pools (withdrawals, close, surplus claims).
    receive() external payable {
        if (msg.sender != activePool && msg.sender != collSurplusPool) revert UnauthorizedBTCSender();
    }

    function _sendBTC(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert BTCTransferFailed();
    }
}
