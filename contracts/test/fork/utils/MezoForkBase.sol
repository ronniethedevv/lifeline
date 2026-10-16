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

/// @notice Base for Mezo testnet fork tests: forks, then replaces the oracle precompile
///         with MockMezoOracle seeded from the live oracle's current values.
/// @dev Run with FOUNDRY_PROFILE=fork (evm_version shanghai: Mezo's contracts use PUSH0).
abstract contract MezoForkBase is Test {
    /// @dev Mezo price-oracle precompile read by MUSD's PriceFeed (PriceFeed.oracle()).
    address internal constant MEZO_ORACLE = 0x7b7c000000000000000000000000000000000015;

    MockMezoOracle internal oracle;

    function setUp() public virtual {
        // Read live values from the real node before forking (eth_call runs the real precompile).
        bytes memory roundData = vm.rpc("mezo_testnet", "eth_call", _callParams(bytes4(keccak256("latestRoundData()"))));
        bytes memory decData = vm.rpc("mezo_testnet", "eth_call", _callParams(bytes4(keccak256("decimals()"))));
        (, int256 livePrice,,,) = abi.decode(roundData, (uint80, int256, uint256, uint256, uint80));
        uint8 liveDecimals = abi.decode(decData, (uint8));

        vm.createSelectFork("mezo_testnet");
        vm.etch(MEZO_ORACLE, type(MockMezoOracle).runtimeCode);
        oracle = MockMezoOracle(MEZO_ORACLE);
        oracle.setDecimals(liveDecimals);
        oracle.setPrice(livePrice);
    }

    function _callParams(bytes4 selector) private pure returns (string memory) {
        return string.concat(
            '[{"to":"', vm.toString(MEZO_ORACLE), '","data":"', vm.toString(abi.encodePacked(selector)), '"},"latest"]'
        );
    }
}
