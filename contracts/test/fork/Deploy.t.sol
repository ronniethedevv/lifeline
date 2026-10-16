// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MezoForkBase} from "./utils/MezoForkBase.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {RescueMarket} from "../../src/RescueMarket.sol";
import {PositionVault} from "../../src/PositionVault.sol";

/// @notice T1.10: the deploy script's logic on a Mezo testnet fork.
contract DeployForkTest is MezoForkBase {
    function test_deploy_wiresContractsAndPreflightPasses() public {
        Deploy script = new Deploy();
        Deploy.Deployed memory d = script.run();

        assertEq(d.factory.market(), address(d.market));
        assertEq(address(d.market.factory()), address(d.factory));
        assertEq(address(d.market.pricer()), address(d.pricer));
        assertEq(d.market.lienTerm(), 7 days);
        assertEq(d.market.tipBps(), 10);
        assertEq(d.pricer.lowICR(), 1.1e18);
        assertEq(d.pricer.highICR(), 1.5e18);
        assertEq(d.pricer.minFeeBps(), 100);
        assertEq(d.pricer.maxFeeBps(), 500);

        // The deployed factory works and the market sees its vaults.
        address alice = makeAddr("alice");
        vm.prank(alice);
        PositionVault v = PositionVault(payable(d.factory.createVault()));
        assertTrue(d.factory.isVault(address(v)));
        assertEq(v.market(), address(d.market));
        assertEq(uint8(d.market.previewRescue(address(v)).status), uint8(RescueMarket.RescueStatus.NotOptedIn));
    }

    function test_deploy_refusesWhenMusdUpgraded() public {
        // Simulate Mezo upgrading TroveManager to a new implementation.
        address tm = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
        bytes32 slot = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
        vm.store(tm, slot, bytes32(uint256(uint160(makeAddr("newImpl")))));
        Deploy script = new Deploy();
        vm.expectRevert();
        script.run();
    }
}
