// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MezoForkBase} from "./MezoForkBase.sol";
import {RescueMarket} from "../../../src/RescueMarket.sol";
import {VaultFactory} from "../../../src/VaultFactory.sol";
import {MinimalFeePricer} from "../../../src/MinimalFeePricer.sol";
import {IBorrowerOperations} from "../../../src/interfaces/IBorrowerOperations.sol";
import {ITroveManager} from "../../../src/interfaces/ITroveManager.sol";
import {IPriceFeed} from "../../../src/interfaces/IPriceFeed.sol";
import {IHintHelpers} from "../../../src/interfaces/IHintHelpers.sol";
import {ISortedTroves} from "../../../src/interfaces/ISortedTroves.sol";

/// @notice Real MUSD addresses (deployments/testnet.json) + the Lifeline stack deployed on the
///         fork the same way the deploy script will (market address predicted, then asserted).
abstract contract LifelineForkBase is MezoForkBase {
    IBorrowerOperations internal constant BO = IBorrowerOperations(0xCdF7028ceAB81fA0C6971208e83fa7872994beE5);
    ITroveManager internal constant TM = ITroveManager(0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0);
    IPriceFeed internal constant PF = IPriceFeed(0x86bCF0841622a5dAC14A313a15f96A95421b9366);
    IHintHelpers internal constant HH = IHintHelpers(0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6);
    ISortedTroves internal constant ST = ISortedTroves(0x722E4D24FD6Ff8b0AC679450F3D91294607268fA);
    IERC20 internal constant MUSD = IERC20(0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503);

    uint256 internal constant NICR_PRECISION = 1e20;
    uint256 internal constant HINT_TRIALS = 15;
    uint256 internal constant LIEN_TERM = 7 days;
    uint256 internal constant TIP_BPS = 10;

    MinimalFeePricer internal pricer;
    VaultFactory internal factory;
    RescueMarket internal market;

    function setUp() public virtual override {
        super.setUp();
        pricer = new MinimalFeePricer(100, 500, TM.MCR(), TM.CCR());
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        factory = new VaultFactory(BO, TM, MUSD, predicted);
        market = new RescueMarket(MUSD, BO, TM, PF, pricer, factory, LIEN_TERM, TIP_BPS);
        assertEq(address(market), predicted, "market at predicted address");
    }

    function _hintsForNicr(uint256 nicr) internal view returns (address upper, address lower) {
        (address approx,,) = HH.getApproxHint(nicr, HINT_TRIALS, 42);
        return ST.findInsertPosition(nicr, approx, approx);
    }

    function _hints(uint256 coll, uint256 debt) internal view returns (address, address) {
        return _hintsForNicr(coll * NICR_PRECISION / debt);
    }
}
