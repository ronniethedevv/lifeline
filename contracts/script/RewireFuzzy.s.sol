// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IFeePricer} from "../src/interfaces/IFeePricer.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {RescueMarket} from "../src/RescueMarket.sol";
import {IBorrowerOperations} from "../src/interfaces/IBorrowerOperations.sol";
import {ITroveManager} from "../src/interfaces/ITroveManager.sol";
import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";

/// @notice Redeploys VaultFactory + RescueMarket (current bytecode: fuzzy pricing + T1.7b seizure /
///         loss accounting / two-asset pool / strategic-default guard) wired to the already-deployed
///         FuzzyFeePricer (deployments/testnet.json). The pricer is reused; the previous factory/market
///         and any vaults under them are superseded.
/// @dev No constructor reads a price, so `forge script` simulation is safe (see Deploy.s.sol).
///      Dry run: forge script script/RewireFuzzy.s.sol --rpc-url mezo_testnet --sender <deployer>
///      Deploy:  add --broadcast --private-key $DEPLOYER_PRIVATE_KEY
contract RewireFuzzy is Script {
    error WrongChain(uint256 chainId);
    error MusdUpgraded(string name, address pinned, address current);
    error WiringMismatch();

    uint256 internal constant MEZO_TESTNET = 31_611;
    uint256 internal constant LIEN_TERM = 7 days;
    uint256 internal constant TIP_BPS = 10; // 0.1%
    uint256 internal constant SEIZE_PENALTY_BPS = 500; // 5%
    uint256 internal constant COMBINED_ICR_FLOOR = 1.2e18; // 120%
    bytes32 internal constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    string internal constant DEPLOYMENTS = "../deployments/testnet.json";

    function run() external returns (VaultFactory factory, RescueMarket market) {
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
        IFeePricer pricer = IFeePricer(vm.parseJsonAddress(json, ".lifeline.FuzzyFeePricer.address"));

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        // factory at nonce n, market at n+1 (no pricer deploy here)
        address predictedMarket = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        factory = new VaultFactory(bo, tm, musd, predictedMarket);
        market = new RescueMarket(
            musd, bo, tm, pf, pricer, factory, LIEN_TERM, TIP_BPS, SEIZE_PENALTY_BPS, COMBINED_ICR_FLOOR
        );
        vm.stopBroadcast();

        if (
            address(market) != predictedMarket || factory.market() != address(market)
                || address(market.factory()) != address(factory) || address(market.pricer()) != address(pricer)
        ) revert WiringMismatch();

        console2.log("FuzzyFeePricer (reused)", address(pricer));
        console2.log("VaultFactory   (new)   ", address(factory));
        console2.log("RescueMarket   (new)   ", address(market));
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
