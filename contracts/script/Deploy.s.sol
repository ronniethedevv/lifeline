// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MinimalFeePricer} from "../src/MinimalFeePricer.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {RescueMarket} from "../src/RescueMarket.sol";
import {IBorrowerOperations} from "../src/interfaces/IBorrowerOperations.sol";
import {ITroveManager} from "../src/interfaces/ITroveManager.sol";
import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";

/// @notice Deploys Lifeline to Mezo testnet (T1.10): MinimalFeePricer -> VaultFactory (market
///         address predicted) -> RescueMarket. Refuses to run on any other chain or if Mezo has
///         upgraded an MUSD contract since the ABIs were pinned in deployments/testnet.json (T0.3).
/// @dev No constructor reads a price, so `forge script` simulation is safe here.
///      Dry run:  forge script script/Deploy.s.sol --rpc-url mezo_testnet
///      Deploy:   add --broadcast --private-key $DEPLOYER_PRIVATE_KEY
contract Deploy is Script {
    error WrongChain(uint256 chainId);
    error MusdUpgraded(string name, address pinned, address current);
    error WiringMismatch();

    struct Deployed {
        MinimalFeePricer pricer;
        VaultFactory factory;
        RescueMarket market;
    }

    uint256 internal constant MEZO_TESTNET = 31_611;
    uint256 internal constant MIN_FEE_BPS = 100; // 1%
    uint256 internal constant MAX_FEE_BPS = 500; // 5%
    uint256 internal constant LIEN_TERM = 7 days;
    uint256 internal constant TIP_BPS = 10; // 0.1%
    uint256 internal constant SEIZE_PENALTY_BPS = 500; // 5%
    uint256 internal constant COMBINED_ICR_FLOOR = 1.2e18; // 120%
    /// @dev EIP-1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1
    bytes32 internal constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    string internal constant DEPLOYMENTS = "../deployments/testnet.json";

    function run() external returns (Deployed memory d) {
        if (block.chainid != MEZO_TESTNET) revert WrongChain(block.chainid);
        string memory json = vm.readFile(DEPLOYMENTS);
        _requireNotUpgraded(json, "BorrowerOperations");
        _requireNotUpgraded(json, "TroveManager");
        _requireNotUpgraded(json, "PriceFeed");
        _requireNotUpgraded(json, "HintHelpers");
        _requireNotUpgraded(json, "SortedTroves");

        IBorrowerOperations bo = IBorrowerOperations(_musd(json, "BorrowerOperations"));
        ITroveManager tm = ITroveManager(_musd(json, "TroveManager"));
        IPriceFeed pf = IPriceFeed(_musd(json, "PriceFeed"));
        IERC20 musd = IERC20(_musd(json, "MUSD"));
        uint256 mcr = tm.MCR();
        uint256 ccr = tm.CCR();

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        // pricer at nonce n, factory at n+1, market at n+2
        address predictedMarket = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 2);
        d.pricer = new MinimalFeePricer(MIN_FEE_BPS, MAX_FEE_BPS, mcr, ccr);
        d.factory = new VaultFactory(bo, tm, musd, predictedMarket);
        d.market = new RescueMarket(
            musd, bo, tm, pf, d.pricer, d.factory, LIEN_TERM, TIP_BPS, SEIZE_PENALTY_BPS, COMBINED_ICR_FLOOR
        );
        vm.stopBroadcast();

        if (
            address(d.market) != predictedMarket || d.factory.market() != address(d.market)
                || address(d.market.factory()) != address(d.factory) || address(d.market.pricer()) != address(d.pricer)
        ) revert WiringMismatch();

        console2.log("deployer         ", deployer);
        console2.log("MinimalFeePricer ", address(d.pricer));
        console2.log("VaultFactory     ", address(d.factory));
        console2.log("RescueMarket     ", address(d.market));
    }

    function _musd(string memory json, string memory name) internal pure returns (address) {
        return vm.parseJsonAddress(json, string.concat(".musd.", name, ".address"));
    }

    /// @dev Architecture §3: MUSD is upgradeable on Mezo's side; recheck before each deploy.
    function _requireNotUpgraded(string memory json, string memory name) internal view {
        address proxy = _musd(json, name);
        address pinned = vm.parseJsonAddress(json, string.concat(".musd.", name, ".implementation"));
        address current = address(uint160(uint256(vm.load(proxy, IMPL_SLOT))));
        if (current != pinned) revert MusdUpgraded(name, pinned, current);
    }
}
