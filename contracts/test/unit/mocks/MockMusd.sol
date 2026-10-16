// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ITroveManager} from "../../../src/interfaces/ITroveManager.sol";

/// @notice Minimal MUSD stack for unit tests. Mirrors only what PositionVault relies on:
///         trove bound to msg.sender, MUSD minted to / burned from the caller, BTC held by an
///         ActivePool and returned from it, surplus BTC paid from a CollSurplusPool.
///         Every MUSD interaction is also covered by fork tests against the real contracts.
contract MockMUSD is ERC20 {
    address public immutable minter;

    constructor() ERC20("Mock MUSD", "MUSD") {
        minter = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == minter, "MockMUSD: not minter");
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(msg.sender == minter, "MockMUSD: not minter");
        _burn(from, amount);
    }
}

contract MockBTCPool {
    address public immutable bo;

    constructor() {
        bo = msg.sender;
    }

    function send(address to, uint256 amount) external {
        require(msg.sender == bo, "MockBTCPool: not BO");
        (bool ok,) = to.call{value: amount}("");
        require(ok, "Sending BTC failed");
    }

    receive() external payable {}
}

contract MockTroveManager {
    struct Trove {
        ITroveManager.Status status;
        uint256 coll;
        uint256 debt;
    }

    uint256 public constant MCR = 1.1e18; // 110%, as on testnet

    address public immutable bo;
    mapping(address => Trove) public troves;

    constructor() {
        bo = msg.sender;
    }

    function set(address borrower, ITroveManager.Status status, uint256 coll, uint256 debt) external {
        require(msg.sender == bo, "MockTM: not BO");
        troves[borrower] = Trove(status, coll, debt);
    }

    function getTroveStatus(address b) external view returns (ITroveManager.Status) {
        return troves[b].status;
    }

    function getTroveColl(address b) external view returns (uint256) {
        return troves[b].coll;
    }

    function getTroveDebt(address b) external view returns (uint256) {
        return troves[b].debt;
    }

    uint256 public tcr = 2e18; // settable system TCR

    function setTCR(uint256 _tcr) external {
        tcr = _tcr;
    }

    function getTCR(uint256) external view returns (uint256) {
        return tcr;
    }

    /// @dev Same formula as MUSD: coll * price / debt, max uint when debt is 0.
    function getCurrentICR(address b, uint256 price) external view returns (uint256) {
        if (troves[b].debt == 0) return type(uint256).max;
        return troves[b].coll * price / troves[b].debt;
    }

    /// @dev Real TM splits debt into principal + interest (+ pending); the mock reports it all as principal.
    function getEntireDebtAndColl(address b)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, uint256)
    {
        return (troves[b].coll, troves[b].debt, 0, 0, 0, 0);
    }
}

contract MockPriceFeed {
    uint256 public price = 5000e18;

    function setPrice(uint256 _price) external {
        price = _price;
    }

    function fetchPrice() external view returns (uint256) {
        return price;
    }
}

contract MockBorrowerOperations {
    uint256 public constant MUSD_GAS_COMPENSATION = 200e18;
    uint256 public constant FEE_DIVISOR = 1000; // 0.1% borrowing fee, as on testnet

    MockMUSD public immutable musd;
    MockTroveManager public immutable troveManager;
    MockBTCPool public immutable activePool;
    MockBTCPool public immutable collSurplusPool;
    uint256 public minNetDebt = 1800e18;

    mapping(address => uint256) public refinanceCount;
    mapping(address => uint256) public surplus;

    constructor() {
        musd = new MockMUSD();
        troveManager = new MockTroveManager();
        activePool = new MockBTCPool();
        collSurplusPool = new MockBTCPool();
    }

    /// @dev Test helper: MUSD's minNetDebt is governable.
    function setMinNetDebt(uint256 value) external {
        minNetDebt = value;
    }

    function getBorrowingFee(uint256 debt) public pure returns (uint256) {
        return debt / FEE_DIVISOR;
    }

    function _trove(address b) internal view returns (ITroveManager.Status s, uint256 coll, uint256 debt) {
        (s, coll, debt) = troveManager.troves(b);
    }

    function openTrove(uint256 debt, address, address) external payable {
        (ITroveManager.Status s,,) = _trove(msg.sender);
        require(s != ITroveManager.Status.active, "BorrowerOps: Trove is active");
        require(debt >= minNetDebt, "BorrowerOps: below min net debt");
        troveManager.set(
            msg.sender, ITroveManager.Status.active, msg.value, debt + getBorrowingFee(debt) + MUSD_GAS_COMPENSATION
        );
        (bool ok,) = address(activePool).call{value: msg.value}("");
        require(ok);
        musd.mint(msg.sender, debt);
    }

    function addColl(address, address) external payable {
        (ITroveManager.Status s, uint256 coll, uint256 debt) = _trove(msg.sender);
        require(s == ITroveManager.Status.active, "BorrowerOps: Trove does not exist or is closed");
        troveManager.set(msg.sender, s, coll + msg.value, debt);
        (bool ok,) = address(activePool).call{value: msg.value}("");
        require(ok);
    }

    function withdrawColl(uint256 amount, address, address) external {
        (ITroveManager.Status s, uint256 coll, uint256 debt) = _trove(msg.sender);
        require(s == ITroveManager.Status.active, "BorrowerOps: Trove does not exist or is closed");
        troveManager.set(msg.sender, s, coll - amount, debt);
        activePool.send(msg.sender, amount);
    }

    function withdrawMUSD(uint256 amount, address, address) external {
        (ITroveManager.Status s, uint256 coll, uint256 debt) = _trove(msg.sender);
        require(s == ITroveManager.Status.active, "BorrowerOps: Trove does not exist or is closed");
        troveManager.set(msg.sender, s, coll, debt + amount + getBorrowingFee(amount));
        musd.mint(msg.sender, amount);
    }

    function repayMUSD(uint256 amount, address, address) external {
        (ITroveManager.Status s, uint256 coll, uint256 debt) = _trove(msg.sender);
        require(s == ITroveManager.Status.active, "BorrowerOps: Trove does not exist or is closed");
        // Same rule as MUSD: net debt after repay must stay >= minNetDebt.
        require(
            debt - MUSD_GAS_COMPENSATION >= amount && debt - MUSD_GAS_COMPENSATION - amount >= minNetDebt,
            "BorrowerOps: Trove's net debt must be greater than minimum"
        );
        musd.burn(msg.sender, amount);
        troveManager.set(msg.sender, s, coll, debt - amount);
    }

    function closeTrove() external {
        (ITroveManager.Status s, uint256 coll, uint256 debt) = _trove(msg.sender);
        require(s == ITroveManager.Status.active, "BorrowerOps: Trove does not exist or is closed");
        musd.burn(msg.sender, debt - MUSD_GAS_COMPENSATION);
        troveManager.set(msg.sender, ITroveManager.Status.closedByOwner, 0, 0);
        activePool.send(msg.sender, coll);
    }

    function refinance(address, address) external {
        (ITroveManager.Status s,,) = _trove(msg.sender);
        require(s == ITroveManager.Status.active, "BorrowerOps: Trove does not exist or is closed");
        refinanceCount[msg.sender]++;
    }

    function claimCollateral() external {
        uint256 amount = surplus[msg.sender];
        require(amount > 0, "CollSurplusPool: No collateral available to claim");
        surplus[msg.sender] = 0;
        collSurplusPool.send(msg.sender, amount);
    }

    /// @dev Test helper: credit `account` with surplus BTC claimable from the CollSurplusPool.
    function seedSurplus(address account) external payable {
        surplus[account] += msg.value;
        (bool ok,) = address(collSurplusPool).call{value: msg.value}("");
        require(ok);
    }
}
