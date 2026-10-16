// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VaultFactory} from "../../src/VaultFactory.sol";
import {PositionVault} from "../../src/PositionVault.sol";
import {IBorrowerOperations} from "../../src/interfaces/IBorrowerOperations.sol";
import {ITroveManager} from "../../src/interfaces/ITroveManager.sol";
import {MockBorrowerOperations} from "./mocks/MockMusd.sol";

contract VaultFactoryTest is Test {
    event VaultCreated(address indexed owner, address indexed vault);

    MockBorrowerOperations internal bo;
    VaultFactory internal factory;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        bo = new MockBorrowerOperations();
        factory = new VaultFactory(
            IBorrowerOperations(address(bo)), ITroveManager(address(bo.troveManager())), IERC20(address(bo.musd()))
        );
    }

    function test_constructor_setsImmutables() public view {
        assertEq(address(factory.borrowerOperations()), address(bo));
        assertEq(address(factory.troveManager()), address(bo.troveManager()));
        assertEq(address(factory.musd()), address(bo.musd()));
    }

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert(VaultFactory.ZeroAddress.selector);
        new VaultFactory(IBorrowerOperations(address(0)), ITroveManager(address(1)), IERC20(address(1)));
        vm.expectRevert(VaultFactory.ZeroAddress.selector);
        new VaultFactory(IBorrowerOperations(address(1)), ITroveManager(address(0)), IERC20(address(1)));
        vm.expectRevert(VaultFactory.ZeroAddress.selector);
        new VaultFactory(IBorrowerOperations(address(1)), ITroveManager(address(1)), IERC20(address(0)));
    }

    function test_createVault_deploysVaultOwnedByCaller() public {
        vm.prank(alice);
        PositionVault vault = PositionVault(payable(factory.createVault()));
        assertEq(vault.owner(), alice);
        assertEq(address(vault.borrowerOperations()), address(bo));
        assertEq(address(vault.troveManager()), address(bo.troveManager()));
        assertEq(address(vault.musd()), address(bo.musd()));
    }

    function test_createVault_emitsVaultCreated() public {
        address predicted = vm.computeCreateAddress(address(factory), vm.getNonce(address(factory)));
        vm.expectEmit(true, true, false, true, address(factory));
        emit VaultCreated(alice, predicted);
        vm.prank(alice);
        factory.createVault();
    }

    function test_createVault_tracksVaultsPerOwnerAndGlobally() public {
        vm.startPrank(alice);
        address a1 = factory.createVault();
        address a2 = factory.createVault(); // one vault per position: owners can hold several
        vm.stopPrank();
        vm.prank(bob);
        address b1 = factory.createVault();

        address[] memory aliceVaults = factory.vaultsOf(alice);
        assertEq(aliceVaults.length, 2);
        assertEq(aliceVaults[0], a1);
        assertEq(aliceVaults[1], a2);
        assertEq(factory.vaultsOf(bob).length, 1);
        assertEq(factory.vaultsOf(bob)[0], b1);
        assertEq(factory.vaultsOf(makeAddr("nobody")).length, 0);

        assertEq(factory.allVaultsLength(), 3);
        address[] memory all = factory.allVaults();
        assertEq(all[0], a1);
        assertEq(all[1], a2);
        assertEq(all[2], b1);
        assertTrue(a1 != a2 && a2 != b1);
    }
}
