// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FuzzyFeePricer} from "../src/FuzzyFeePricer.sol";
import {ITroveManager} from "../src/interfaces/ITroveManager.sol";

/// @notice Deploys the FuzzyFeePricer (T1.4) to Mezo testnet with the committed rule table. The
///         constructor validates the table (in [minFee,maxFee] and monotonic in risk) and emits it
///         as the on-chain commitment. No constructor reads a price, so `forge script` simulation is
///         safe (unlike price-touching live txs, which must use cast/viem — see Deploy.s.sol).
/// @dev Dry run: forge script script/DeployFuzzyPricer.s.sol --rpc-url mezo_testnet
///      Deploy:  add --broadcast --private-key $DEPLOYER_PRIVATE_KEY
contract DeployFuzzyPricer is Script {
    error WrongChain(uint256 chainId);

    uint256 internal constant MEZO_TESTNET = 31_611;
    uint256 internal constant ONE = 1e18;
    uint256 internal constant MIN_FEE_BPS = 100; // 1%  — safest corner
    uint256 internal constant MAX_FEE_BPS = 1000; // 10% — riskiest corner
    string internal constant DEPLOYMENTS = "../deployments/testnet.json";

    function run() external returns (FuzzyFeePricer pricer) {
        if (block.chainid != MEZO_TESTNET) revert WrongChain(block.chainid);
        string memory json = vm.readFile(DEPLOYMENTS);
        ITroveManager tm = ITroveManager(vm.parseJsonAddress(json, ".musd.TroveManager.address"));
        uint256 mcr = tm.MCR(); // liquidation ratio (≈110%)
        uint256 ccr = tm.CCR(); // Recovery-Mode ratio (≈150%)

        // Breakpoints anchored to the live MCR/CCR; the size ratio is absolute.
        uint256[3] memory icrK = [mcr, mcr + (15 * ONE) / 100, mcr + (40 * ONE) / 100]; // ≈110/125/150%
        uint256[3] memory sizeK = [(5 * ONE) / 100, (20 * ONE) / 100, (40 * ONE) / 100]; // 5/20/40%
        uint256[3] memory tcrK = [ccr, ccr + (20 * ONE) / 100, ccr + (50 * ONE) / 100]; // ≈150/170/200%
        uint256[27] memory rules = _rules();

        _log(icrK, sizeK, tcrK, rules, mcr, ccr);

        vm.startBroadcast();
        pricer = new FuzzyFeePricer(MIN_FEE_BPS, MAX_FEE_BPS, icrK, sizeK, tcrK, rules);
        vm.stopBroadcast();

        console2.log("FuzzyFeePricer", address(pricer));
    }

    /// @dev Committed 27-cell table from per-axis risk weights (ICR dominates). Monotonic in risk;
    ///      fee = minFee + (maxFee-minFee) * risk / rmax, floored.
    function _rules() internal pure returns (uint256[27] memory r) {
        uint8[3] memory r1 = [uint8(16), 6, 0]; // ICR: at-liquidation -> safe
        uint8[3] memory r2 = [uint8(0), 4, 10]; // size: small -> large
        uint8[3] memory r3 = [uint8(8), 3, 0]; // TCR: Recovery -> healthy
        uint256 rmax = 34;
        for (uint256 i; i < 3; ++i) {
            for (uint256 j; j < 3; ++j) {
                for (uint256 k; k < 3; ++k) {
                    uint256 risk = uint256(r1[i]) + r2[j] + r3[k];
                    r[i * 9 + j * 3 + k] = MIN_FEE_BPS + ((MAX_FEE_BPS - MIN_FEE_BPS) * risk) / rmax;
                }
            }
        }
    }

    function _log(
        uint256[3] memory icrK,
        uint256[3] memory sizeK,
        uint256[3] memory tcrK,
        uint256[27] memory rules,
        uint256 mcr,
        uint256 ccr
    ) internal view {
        console2.log("mcr", mcr);
        console2.log("ccr", ccr);
        console2.log("icrLo", icrK[0]);
        console2.log("icrMid", icrK[1]);
        console2.log("icrHi", icrK[2]);
        console2.log("sizeLo", sizeK[0]);
        console2.log("sizeMid", sizeK[1]);
        console2.log("sizeHi", sizeK[2]);
        console2.log("tcrLo", tcrK[0]);
        console2.log("tcrMid", tcrK[1]);
        console2.log("tcrHi", tcrK[2]);
        for (uint256 x; x < 27; ++x) {
            console2.log("rule", x, rules[x]);
        }
    }
}
