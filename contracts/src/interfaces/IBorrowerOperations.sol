// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IBorrowerOperations
/// @notice Minimal MUSD BorrowerOperations interface. Signatures copied from the pinned
///         matsnet ABI (deployments/abis/matsnet/BorrowerOperations.json, mezo-org/musd commit aa25fd6).
/// @dev Every trove function acts on msg.sender's trove. Hints come from
///      IHintHelpers.getApproxHint + ISortedTroves.findInsertPosition.
interface IBorrowerOperations {
    /// @notice Opens a trove for msg.sender with msg.value BTC as collateral.
    /// @param _debtAmount MUSD to borrow (excludes borrowing fee and gas compensation) // 1e18
    /// @param _upperHint Insert-position hint (neighbour with higher NICR)
    /// @param _lowerHint Insert-position hint (neighbour with lower NICR)
    function openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) external payable;

    /// @notice Adds msg.value BTC to msg.sender's trove.
    /// @param _upperHint Insert-position hint
    /// @param _lowerHint Insert-position hint
    function addColl(address _upperHint, address _lowerHint) external payable;

    /// @notice Withdraws BTC collateral from msg.sender's trove to msg.sender.
    /// @param _amount BTC to withdraw // 1e18
    /// @param _upperHint Insert-position hint
    /// @param _lowerHint Insert-position hint
    function withdrawColl(uint256 _amount, address _upperHint, address _lowerHint) external;

    /// @notice Borrows more MUSD against msg.sender's trove.
    /// @param _amount MUSD to borrow // 1e18
    /// @param _upperHint Insert-position hint
    /// @param _lowerHint Insert-position hint
    function withdrawMUSD(uint256 _amount, address _upperHint, address _lowerHint) external;

    /// @notice Repays MUSD debt of msg.sender's trove from msg.sender's MUSD balance.
    /// @param _amount MUSD to repay // 1e18
    /// @param _upperHint Insert-position hint
    /// @param _lowerHint Insert-position hint
    function repayMUSD(uint256 _amount, address _upperHint, address _lowerHint) external;

    /// @notice Adjusts collateral and debt of msg.sender's trove in one call (msg.value adds coll).
    /// @param _collWithdrawal BTC to withdraw // 1e18
    /// @param _debtChange MUSD debt change // 1e18
    /// @param _isDebtIncrease True to borrow `_debtChange`, false to repay it
    /// @param _upperHint Insert-position hint
    /// @param _lowerHint Insert-position hint
    function adjustTrove(
        uint256 _collWithdrawal,
        uint256 _debtChange,
        bool _isDebtIncrease,
        address _upperHint,
        address _lowerHint
    ) external payable;

    /// @notice Closes msg.sender's trove, burning its debt from msg.sender's MUSD and returning all BTC.
    function closeTrove() external;

    /// @notice Moves msg.sender's trove to the current interest rate.
    /// @param _upperHint Insert-position hint
    /// @param _lowerHint Insert-position hint
    function refinance(address _upperHint, address _lowerHint) external;

    /// @notice Claims msg.sender's surplus collateral from CollSurplusPool.
    function claimCollateral() external;

    /// @notice Current minimum net debt (governable).
    /// @return Minimum net debt in MUSD // 1e18
    function minNetDebt() external view returns (uint256);

    /// @notice Gas compensation added to every trove's debt.
    /// @return Gas compensation in MUSD // 1e18
    function MUSD_GAS_COMPENSATION() external view returns (uint256);

    /// @notice Borrowing fee charged on a given debt amount.
    /// @param _debt Debt amount // 1e18
    /// @return Fee in MUSD // 1e18
    function getBorrowingFee(uint256 _debt) external view returns (uint256);
}
