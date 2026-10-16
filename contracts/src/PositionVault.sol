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

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Creates a vault for `_owner`. Normally called by VaultFactory.
    /// @param _owner Vault owner
    /// @param _borrowerOperations MUSD BorrowerOperations
    /// @param _troveManager MUSD TroveManager
    /// @param _musd MUSD token
    constructor(address _owner, IBorrowerOperations _borrowerOperations, ITroveManager _troveManager, IERC20 _musd) {
        if (
            _owner == address(0) || address(_borrowerOperations) == address(0) || address(_troveManager) == address(0)
                || address(_musd) == address(0)
        ) revert ZeroAddress();
        owner = _owner;
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
    function open(uint256 debt, address upperHint, address lowerHint) external payable onlyOwner nonReentrant {
        borrowerOperations.openTrove{value: msg.value}(debt, upperHint, lowerHint);
        musd.safeTransfer(owner, debt);
    }

    /// @notice Adds msg.value BTC to the vault's trove.
    /// @param upperHint Insert-position hint
    /// @param lowerHint Insert-position hint
    function addColl(address upperHint, address lowerHint) external payable onlyOwner nonReentrant {
        borrowerOperations.addColl{value: msg.value}(upperHint, lowerHint);
    }

    /// @notice Withdraws BTC from the trove and sends it to the owner.
    /// @param amount BTC to withdraw // 1e18
    /// @param upperHint Insert-position hint
    /// @param lowerHint Insert-position hint
    function withdrawColl(uint256 amount, address upperHint, address lowerHint) external onlyOwner nonReentrant {
        borrowerOperations.withdrawColl(amount, upperHint, lowerHint);
        _sendBTC(owner, amount);
    }

    /// @notice Borrows more MUSD against the trove and sends it to the owner.
    /// @param amount MUSD to borrow // 1e18
    /// @param upperHint Insert-position hint
    /// @param lowerHint Insert-position hint
    function borrow(uint256 amount, address upperHint, address lowerHint) external onlyOwner nonReentrant {
        borrowerOperations.withdrawMUSD(amount, upperHint, lowerHint);
        musd.safeTransfer(owner, amount);
    }

    /// @notice Repays trove debt with MUSD pulled from the owner (owner approves the vault first).
    /// @param amount MUSD to repay // 1e18
    /// @param upperHint Insert-position hint
    /// @param lowerHint Insert-position hint
    function repay(uint256 amount, address upperHint, address lowerHint) external onlyOwner nonReentrant {
        musd.safeTransferFrom(owner, address(this), amount);
        borrowerOperations.repayMUSD(amount, upperHint, lowerHint);
    }

    /// @notice Closes the trove. Pulls from the owner exactly the MUSD the vault lacks to repay
    ///         the debt (excluding gas compensation), then sends all BTC and any MUSD left to the owner.
    /// @dev closeTrove accrues interest and applies pending redistributions before burning
    ///      `debt - gas compensation`; getEntireDebtAndColl includes both, so the pull is exact.
    function close() external onlyOwner nonReentrant {
        (, uint256 principal, uint256 interest,,,) = troveManager.getEntireDebtAndColl(address(this));
        uint256 toBurn = principal + interest - borrowerOperations.MUSD_GAS_COMPENSATION();
        uint256 held = musd.balanceOf(address(this));
        if (toBurn > held) musd.safeTransferFrom(owner, address(this), toBurn - held);

        borrowerOperations.closeTrove();

        _sendBTC(owner, address(this).balance);
        uint256 leftover = musd.balanceOf(address(this));
        if (leftover > 0) musd.safeTransfer(owner, leftover);
    }

    /// @notice Moves the trove to the current interest rate (MUSD adds the fee to the debt).
    /// @param upperHint Insert-position hint
    /// @param lowerHint Insert-position hint
    function refinance(address upperHint, address lowerHint) external onlyOwner nonReentrant {
        borrowerOperations.refinance(upperHint, lowerHint);
    }

    /// @notice Claims surplus BTC left after a liquidation or redemption and sends it to the owner.
    function claimCollateral() external onlyOwner nonReentrant {
        borrowerOperations.claimCollateral();
        _sendBTC(owner, address(this).balance);
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
