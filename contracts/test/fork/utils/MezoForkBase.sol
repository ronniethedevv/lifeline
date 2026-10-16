// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

/// @notice Stand-in for Mezo's price-oracle precompile. Forge's EVM cannot run the real
///         precompile (its on-chain stub calls itself), so fork tests etch this at the
///         precompile address. Everything else on the fork stays real MUSD code.
/// @dev `updatedAt` follows block.timestamp so PriceFeed's 60s staleness check passes
///      after vm.warp. Tests can move the price with setPrice.
contract MockMezoOracle {
    int256 public price; // oracle decimals
    uint8 public decimals;

    function setPrice(int256 newPrice) external {
        price = newPrice;
    }

    function setDecimals(uint8 newDecimals) external {
        decimals = newDecimals;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, price, block.timestamp, block.timestamp, 1);
    }
}

/// @notice Base for Mezo testnet fork tests: forks at a pinned block, then replaces the
///         oracle precompile with MockMezoOracle seeded from the real oracle at that block.
/// @dev Run with FOUNDRY_PROFILE=fork (evm_version shanghai: Mezo's contracts use PUSH0).
///      The pinned block makes runs reproducible and lets Forge cache RPC state on disk.
///      Override with MEZO_FORK_BLOCK=<n>, or MEZO_FORK_BLOCK=0 for latest (e.g. to catch a
///      Mezo upgrade). Bump PINNED_FORK_BLOCK deliberately, together with deployments/testnet.json.
abstract contract MezoForkBase is Test {
    /// @dev Mezo price-oracle precompile read by MUSD's PriceFeed (PriceFeed.oracle()).
    address internal constant MEZO_ORACLE = 0x7b7c000000000000000000000000000000000015;
    /// @dev Same block as deployments/testnet.json "pinned.block" (T0.3).
    uint256 internal constant PINNED_FORK_BLOCK = 16_185_009;

    MockMezoOracle internal oracle;

    function setUp() public virtual {
        uint256 forkBlock = vm.envOr("MEZO_FORK_BLOCK", PINNED_FORK_BLOCK);
        string memory blockTag = forkBlock == 0 ? "latest" : _hexQuantity(forkBlock);

        // Read the real oracle on the node before forking (eth_call runs the real precompile).
        bytes memory roundData =
            vm.rpc("mezo_testnet", "eth_call", _callParams(bytes4(keccak256("latestRoundData()")), blockTag));
        bytes memory decData =
            vm.rpc("mezo_testnet", "eth_call", _callParams(bytes4(keccak256("decimals()")), blockTag));
        (, int256 livePrice,,,) = abi.decode(roundData, (uint80, int256, uint256, uint256, uint80));
        uint8 liveDecimals = abi.decode(decData, (uint8));

        if (forkBlock == 0) vm.createSelectFork("mezo_testnet");
        else vm.createSelectFork("mezo_testnet", forkBlock);
        vm.etch(MEZO_ORACLE, type(MockMezoOracle).runtimeCode);
        oracle = MockMezoOracle(MEZO_ORACLE);
        oracle.setDecimals(liveDecimals);
        oracle.setPrice(livePrice);
    }

    function _callParams(bytes4 selector, string memory blockTag) private pure returns (string memory) {
        return string.concat(
            '[{"to":"',
            vm.toString(MEZO_ORACLE),
            '","data":"',
            vm.toString(abi.encodePacked(selector)),
            '"},"',
            blockTag,
            '"]'
        );
    }

    /// @dev JSON-RPC quantity: 0x-prefixed hex, no leading zeros.
    function _hexQuantity(uint256 value) private pure returns (string memory) {
        bytes memory digits = "0123456789abcdef";
        bytes memory buf = new bytes(64);
        uint256 len;
        do {
            buf[63 - len] = digits[value & 0xf];
            value >>= 4;
            len++;
        } while (value != 0);
        bytes memory out = new bytes(len);
        for (uint256 i; i < len; i++) {
            out[i] = buf[64 - len + i];
        }
        return string.concat("0x", string(out));
    }
}
