// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PositionVault} from "./PositionVault.sol";
import {IBorrowerOperations} from "./interfaces/IBorrowerOperations.sol";
import {ITroveManager} from "./interfaces/ITroveManager.sol";

/// @title VaultFactory
/// @notice Deploys PositionVaults. MUSD binds one trove to one address, so each position
///         gets its own vault; an owner may hold several.
contract VaultFactory {
    error ZeroAddress();

    /// @notice Emitted when a vault is created.
    /// @param owner Vault owner
    /// @param vault New vault address
    event VaultCreated(address indexed owner, address indexed vault);

    /// @notice MUSD BorrowerOperations passed to every vault.
    IBorrowerOperations public immutable borrowerOperations;
    /// @notice MUSD TroveManager passed to every vault.
    ITroveManager public immutable troveManager;
    /// @notice MUSD token passed to every vault.
    IERC20 public immutable musd;
    /// @notice RescueMarket passed to every vault.
    address public immutable market;

    /// @notice True for every vault this factory created (RescueMarket only rescues these).
    mapping(address vault => bool) public isVault;

    address[] internal _allVaults;
    mapping(address owner => address[] vaults) internal _vaultsOf;

    /// @param _borrowerOperations MUSD BorrowerOperations
    /// @param _troveManager MUSD TroveManager
    /// @param _musd MUSD token
    /// @param _market RescueMarket
    constructor(IBorrowerOperations _borrowerOperations, ITroveManager _troveManager, IERC20 _musd, address _market) {
        if (
            address(_borrowerOperations) == address(0) || address(_troveManager) == address(0)
                || address(_musd) == address(0) || _market == address(0)
        ) revert ZeroAddress();
        market = _market;
        borrowerOperations = _borrowerOperations;
        troveManager = _troveManager;
        musd = _musd;
    }

    /// @notice Deploys a new PositionVault owned by the caller.
    /// @return vault Address of the new vault
    function createVault() external returns (address vault) {
        vault = address(new PositionVault(msg.sender, borrowerOperations, troveManager, musd, market));
        isVault[vault] = true;
        _allVaults.push(vault);
        _vaultsOf[msg.sender].push(vault);
        emit VaultCreated(msg.sender, vault);
    }

    /// @notice Vaults created by `owner`, oldest first.
    /// @param owner Vault owner
    /// @return Vault addresses
    function vaultsOf(address owner) external view returns (address[] memory) {
        return _vaultsOf[owner];
    }

    /// @notice All vaults ever created, oldest first (for keepers).
    /// @return Vault addresses
    function allVaults() external view returns (address[] memory) {
        return _allVaults;
    }

    /// @notice Number of vaults ever created.
    /// @return Count
    function allVaultsLength() external view returns (uint256) {
        return _allVaults.length;
    }
}
