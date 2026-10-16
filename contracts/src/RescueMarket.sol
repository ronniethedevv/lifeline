// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title RescueMarket
/// @notice Pool of MUSD from rescue providers. Providers deposit MUSD for shares and withdraw
///         their pro-rata share of pool assets.
/// @dev Shares are internal (no token in Wave 1). Share math is ERC-4626 style with a virtual
///      offset, rounding in the pool's favour. Pool assets are tracked in `_totalManaged`, not read
///      from the MUSD balance, so direct transfers ("donations") cannot move the share price.
///      Rescues, liens and fees are added in T1.6/T1.7.
contract RescueMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroAmount();
    error ZeroShares();
    error InsufficientShares();

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

    /// @dev Virtual shares/assets (OZ ERC4626 decimals-offset pattern, offset 3): bounds what
    ///      rounding can take from depositors when the pool is small.
    uint256 internal constant VIRTUAL_SHARES = 1e3;
    uint256 internal constant VIRTUAL_ASSETS = 1;

    /// @notice MUSD token.
    IERC20 public immutable musd;

    /// @notice Shares held per provider.
    mapping(address provider => uint256 shares) public sharesOf;
    /// @notice Total shares outstanding.
    uint256 public totalShares;

    /// @dev Pool assets in MUSD // 1e18
    uint256 internal _totalManaged;

    /// @param _musd MUSD token
    constructor(IERC20 _musd) {
        if (address(_musd) == address(0)) revert ZeroAddress();
        musd = _musd;
    }

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

    /// @notice Burns the caller's shares and sends the corresponding MUSD.
    /// @param shares Shares to burn
    /// @return assets MUSD paid out // 1e18
    function withdraw(uint256 shares) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        if (shares > sharesOf[msg.sender]) revert InsufficientShares();
        assets = previewWithdraw(shares);
        if (assets == 0) revert ZeroAmount();

        sharesOf[msg.sender] -= shares;
        totalShares -= shares;
        _totalManaged -= assets;
        emit Withdrawn(msg.sender, shares, assets);

        musd.safeTransfer(msg.sender, assets);
    }

    /// @notice Pool assets backing all shares.
    /// @return MUSD // 1e18
    function totalAssets() public view returns (uint256) {
        return _totalManaged;
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
}
