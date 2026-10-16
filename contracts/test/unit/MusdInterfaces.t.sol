// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IBorrowerOperations} from "../../src/interfaces/IBorrowerOperations.sol";
import {ITroveManager} from "../../src/interfaces/ITroveManager.sol";
import {IPriceFeed} from "../../src/interfaces/IPriceFeed.sol";
import {IHintHelpers} from "../../src/interfaces/IHintHelpers.sol";
import {ISortedTroves} from "../../src/interfaces/ISortedTroves.sol";

/// @notice Every function in our minimal MUSD interfaces must exist, with identical
///         input and output types, in the pinned matsnet ABI (T0.3).
contract MusdInterfacesTest is Test {
    using stdJson for string;

    string internal constant ABI_DIR = "../deployments/abis/matsnet/";

    /// @dev Builds "name(inTypes)->(outTypes)" for every function in a pinned ABI file.
    function _abiSignatures(string memory name) internal view returns (string[] memory sigs) {
        string memory json = vm.readFile(string.concat(ABI_DIR, name, ".json"));
        uint256 n;
        while (vm.keyExistsJson(json, string.concat("[", vm.toString(n), "]"))) n++;
        sigs = new string[](n);
        for (uint256 i; i < n; i++) {
            string memory p = string.concat("[", vm.toString(i), "]");
            if (keccak256(bytes(json.readString(string.concat(p, ".type")))) != keccak256("function")) continue;
            sigs[i] = string.concat(
                json.readString(string.concat(p, ".name")),
                _types(json, string.concat(p, ".inputs")),
                "->",
                _types(json, string.concat(p, ".outputs"))
            );
        }
    }

    function _types(string memory json, string memory key) internal view returns (string memory out) {
        out = "(";
        for (uint256 j; vm.keyExistsJson(json, string.concat(key, "[", vm.toString(j), "]")); j++) {
            if (j > 0) out = string.concat(out, ",");
            out = string.concat(out, json.readString(string.concat(key, "[", vm.toString(j), "].type")));
        }
        out = string.concat(out, ")");
    }

    /// @dev Asserts `selector` matches `sigIn` and that `sigIn->sigOut` is in the pinned ABI.
    function _check(string[] memory abiSigs, bytes4 selector, string memory sigIn, string memory sigOut) internal pure {
        assertEq(selector, bytes4(keccak256(bytes(sigIn))), string.concat("selector mismatch: ", sigIn));
        bytes32 want = keccak256(bytes(string.concat(sigIn, "->", sigOut)));
        for (uint256 i; i < abiSigs.length; i++) {
            if (keccak256(bytes(abiSigs[i])) == want) return;
        }
        revert(string.concat("not in pinned ABI: ", sigIn, "->", sigOut));
    }

    function test_borrowerOperations_matchesPinnedAbi() public view {
        string[] memory a = _abiSignatures("BorrowerOperations");
        _check(a, IBorrowerOperations.openTrove.selector, "openTrove(uint256,address,address)", "()");
        _check(a, IBorrowerOperations.addColl.selector, "addColl(address,address)", "()");
        _check(a, IBorrowerOperations.withdrawColl.selector, "withdrawColl(uint256,address,address)", "()");
        _check(a, IBorrowerOperations.withdrawMUSD.selector, "withdrawMUSD(uint256,address,address)", "()");
        _check(a, IBorrowerOperations.repayMUSD.selector, "repayMUSD(uint256,address,address)", "()");
        _check(a, IBorrowerOperations.adjustTrove.selector, "adjustTrove(uint256,uint256,bool,address,address)", "()");
        _check(a, IBorrowerOperations.closeTrove.selector, "closeTrove()", "()");
        _check(a, IBorrowerOperations.refinance.selector, "refinance(address,address)", "()");
        _check(a, IBorrowerOperations.claimCollateral.selector, "claimCollateral()", "()");
        _check(a, IBorrowerOperations.minNetDebt.selector, "minNetDebt()", "(uint256)");
        _check(a, IBorrowerOperations.MUSD_GAS_COMPENSATION.selector, "MUSD_GAS_COMPENSATION()", "(uint256)");
        _check(a, IBorrowerOperations.getBorrowingFee.selector, "getBorrowingFee(uint256)", "(uint256)");
    }

    function test_troveManager_matchesPinnedAbi() public view {
        string[] memory a = _abiSignatures("TroveManager");
        _check(a, ITroveManager.getCurrentICR.selector, "getCurrentICR(address,uint256)", "(uint256)");
        _check(a, ITroveManager.getTroveStatus.selector, "getTroveStatus(address)", "(uint8)");
        _check(
            a,
            ITroveManager.getEntireDebtAndColl.selector,
            "getEntireDebtAndColl(address)",
            "(uint256,uint256,uint256,uint256,uint256,uint256)"
        );
        _check(a, ITroveManager.getTroveDebt.selector, "getTroveDebt(address)", "(uint256)");
        _check(a, ITroveManager.getTroveColl.selector, "getTroveColl(address)", "(uint256)");
        _check(a, ITroveManager.getTCR.selector, "getTCR(uint256)", "(uint256)");
        _check(a, ITroveManager.checkRecoveryMode.selector, "checkRecoveryMode(uint256)", "(bool)");
        _check(a, ITroveManager.MCR.selector, "MCR()", "(uint256)");
        _check(a, ITroveManager.CCR.selector, "CCR()", "(uint256)");
    }

    function test_priceFeed_matchesPinnedAbi() public view {
        _check(_abiSignatures("PriceFeed"), IPriceFeed.fetchPrice.selector, "fetchPrice()", "(uint256)");
    }

    function test_hintHelpers_matchesPinnedAbi() public view {
        _check(
            _abiSignatures("HintHelpers"),
            IHintHelpers.getApproxHint.selector,
            "getApproxHint(uint256,uint256,uint256)",
            "(address,uint256,uint256)"
        );
    }

    function test_sortedTroves_matchesPinnedAbi() public view {
        _check(
            _abiSignatures("SortedTroves"),
            ISortedTroves.findInsertPosition.selector,
            "findInsertPosition(uint256,address,address)",
            "(address,address)"
        );
    }
}
