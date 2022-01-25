// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity >=0.7.6;
pragma abicoder v2;

import "../interfaces/mcd/IJoin.sol";
import "../interfaces/mcd/IManager.sol";
import "./ActionBase.sol";
import "hardhat/console.sol";
import "../ServiceRegistry.sol";

struct Operation {
  string name;
  bytes[][] callData;
  bytes32[] actionIds;
  address serviceRegistryAddr;
}

contract OperationRunner {
  function executeOperation(Operation memory operation) public payable {
    _executeActions(operation);
  }

  function _executeActions(Operation memory operation) internal {
    // address firstActionAddr = ServiceRegistry(operation.serviceRegistryAddr)
    // .getServiceAddress(operation.actionIds[0]);

    bytes32[] memory returnValues = new bytes32[](operation.actionIds.length);

    // if (isFlashLoanAction(firstActionAddr)) {
    //     executeFlashloan(operation, firstActionAddr, returnValues);
    // } else {
    for (uint256 i = 0; i < operation.actionIds.length; ++i) {
      returnValues[i] = _executeAction(operation, i, returnValues);
      // _executeAction(operation, i);
    }
    // }
  }

  function _executeAction(
    Operation memory operation,
    uint256 _index,
    bytes32[] memory returnValues
  ) internal returns (bytes32 response) {
    address actionAddress = ServiceRegistry(operation.serviceRegistryAddr).getServiceAddress(
      operation.actionIds[_index]
    );

    actionAddress.delegatecall(
      abi.encodeWithSignature("executeAction(bytes[])", operation.callData[_index])
    );

    return "";
  }

  function isFlashLoanAction(address actionAddr) internal pure returns (bool) {
    return ActionBase(actionAddr).actionType() == uint8(ActionBase.ActionType.FLASHLOAN);
  }
}
