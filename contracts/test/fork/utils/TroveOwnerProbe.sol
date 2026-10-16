// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBorrowerOperations} from "../../../src/interfaces/IBorrowerOperations.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Throwaway contract for T0.5: proves a contract (not an EOA) can own and manage an
///         MUSD trove. Not the PositionVault. Deployed on a fork (part A) and on live testnet (part B).
contract TroveOwnerProbe {
    error NotOwner();
    error SendFailed();

    IBorrowerOperations public immutable borrowerOps;
    IERC20 public immutable musd;
    address public immutable owner;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IBorrowerOperations _borrowerOps, IERC20 _musd) {
        borrowerOps = _borrowerOps;
        musd = _musd;
        owner = msg.sender;
    }

    /// @notice Opens this contract's trove with msg.value BTC.
    function open(uint256 debt, address upper, address lower) external payable onlyOwner {
        borrowerOps.openTrove{value: msg.value}(debt, upper, lower);
    }

    /// @notice Adds msg.value BTC to this contract's trove.
    function addColl(address upper, address lower) external payable onlyOwner {
        borrowerOps.addColl{value: msg.value}(upper, lower);
    }

    /// @notice Withdraws BTC from the trove into this contract.
    function withdrawColl(uint256 amount, address upper, address lower) external onlyOwner {
        borrowerOps.withdrawColl(amount, upper, lower);
    }

    /// @notice Borrows more MUSD into this contract.
    function borrow(uint256 amount, address upper, address lower) external onlyOwner {
        borrowerOps.withdrawMUSD(amount, upper, lower);
    }

    /// @notice Repays trove debt from this contract's MUSD (MUSD burns from the caller; no approval).
    function repay(uint256 amount, address upper, address lower) external onlyOwner {
        borrowerOps.repayMUSD(amount, upper, lower);
    }

    /// @notice Closes the trove; needs MUSD >= debt - gas compensation in this contract.
    function close() external onlyOwner {
        borrowerOps.closeTrove();
    }

    /// @notice Sends all BTC and MUSD held by this contract to the owner.
    function sweep() external onlyOwner {
        uint256 musdBal = musd.balanceOf(address(this));
        if (musdBal > 0) musd.transfer(owner, musdBal);
        (bool ok,) = owner.call{value: address(this).balance}("");
        if (!ok) revert SendFailed();
    }

    /// @notice Accepts BTC sent back by MUSD (withdrawColl, closeTrove).
    receive() external payable {}
}
