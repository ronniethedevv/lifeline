// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ITroveManager
/// @notice Minimal MUSD TroveManager interface. Signatures copied from the pinned
///         matsnet ABI (deployments/abis/matsnet/TroveManager.json, mezo-org/musd commit aa25fd6).
/// @dev Ratios use MUSD's convention: 1e18 = 100%.
interface ITroveManager {
    /// @notice Trove status, same order as musd's ITroveManager.Status.
    enum Status {
        nonExistent,
        active,
        closedByOwner,
        closedByLiquidation,
        closedByRedemption
    }

    /// @notice A trove's individual collateral ratio at a given price.
    /// @param _borrower Trove owner
    /// @param _price BTC price in MUSD // 1e18
    /// @return ICR // 1e18 = 100%
    function getCurrentICR(address _borrower, uint256 _price) external view returns (uint256);

    /// @notice A trove's status.
    /// @param _borrower Trove owner
    /// @return Status enum value
    function getTroveStatus(address _borrower) external view returns (Status);

    /// @notice A trove's collateral and debt including pending redistribution rewards.
    /// @param _borrower Trove owner
    /// @return coll Collateral // 1e18
    /// @return principal Principal debt // 1e18
    /// @return interest Accrued interest // 1e18
    /// @return pendingCollateral Pending redistributed collateral // 1e18
    /// @return pendingPrincipal Pending redistributed principal // 1e18
    /// @return pendingInterest Pending redistributed interest // 1e18
    function getEntireDebtAndColl(address _borrower)
        external
        view
        returns (
            uint256 coll,
            uint256 principal,
            uint256 interest,
            uint256 pendingCollateral,
            uint256 pendingPrincipal,
            uint256 pendingInterest
        );

    /// @notice A trove's recorded debt.
    /// @param _borrower Trove owner
    /// @return Debt // 1e18
    function getTroveDebt(address _borrower) external view returns (uint256);

    /// @notice A trove's recorded collateral.
    /// @param _borrower Trove owner
    /// @return Collateral // 1e18
    function getTroveColl(address _borrower) external view returns (uint256);

    /// @notice Total collateral ratio of the system at a given price.
    /// @param _price BTC price in MUSD // 1e18
    /// @return TCR // 1e18 = 100%
    function getTCR(uint256 _price) external view returns (uint256);

    /// @notice Whether the system is in Recovery Mode (TCR < CCR) at a given price.
    /// @param _price BTC price in MUSD // 1e18
    /// @return True if in Recovery Mode
    function checkRecoveryMode(uint256 _price) external view returns (bool);

    /// @notice Minimum collateral ratio; troves below it can be liquidated.
    /// @return MCR // 1e18 = 100%
    function MCR() external view returns (uint256);

    /// @notice Critical system collateral ratio; Recovery Mode below it.
    /// @return CCR // 1e18 = 100%
    function CCR() external view returns (uint256);
}
