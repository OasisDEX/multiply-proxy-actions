// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity >=0.7.6;
pragma abicoder v2;

import "../interfaces/mcd/IJoin.sol";
import "../interfaces/mcd/IManager.sol";
import "./ActionBase.sol";
import "hardhat/console.sol";
import "../ServiceRegistry.sol";
import "./OperationData.sol";

contract OperationRunner {
  address public constant serviceRegistryAddr = 0x2B0d36FACD61B71CC05ab8F3D2355ec3631C0dd5;

  function executeOperation(Operation memory operation) public payable {
    _executeActions(operation);
  }

  function _executeActionsAfterFlashLoan(Operation memory operation, bytes32 _flashloanAmount)
    public
    payable
  {
    bytes32[] memory returnValues = new bytes32[](operation.actionIds.length);
    returnValues[0] = _flashloanAmount;

    for (uint256 i = 2; i < operation.actionIds.length; ++i) {
      console.log("RUN THIRD OPERATION");
      returnValues[i] = _executeAction(operation, i, returnValues);
    }
  }

  function _executeActions(Operation memory operation) internal {
    address firstActionAddr = ServiceRegistry(serviceRegistryAddr).getServiceAddress(
      operation.actionIds[1]
    );

    bytes32[] memory returnValues = new bytes32[](operation.actionIds.length);

    if (isFlashLoanAction(firstActionAddr)) {
      returnValues[0] = _executeAction(operation, 0, returnValues);
      returnValues[1] = _executeFlashLoan(operation, firstActionAddr, returnValues);
    } else {
      for (uint256 i = 0; i < operation.actionIds.length; ++i) {
        returnValues[i] = _executeAction(operation, i, returnValues);
      }
    }
  }

  function _executeAction(
    Operation memory operation,
    uint256 _index,
    bytes32[] memory returnValues
  ) internal returns (bytes32 response) {
    address actionAddress = ServiceRegistry(serviceRegistryAddr).getServiceAddress(
      operation.actionIds[_index]
    );

    actionAddress.delegatecall(
      abi.encodeWithSignature("executeAction(bytes[])", operation.callData[_index])
    );

    return "";
  }

  function _executeFlashLoan(
    Operation memory operation,
    address _flashloanActionAddr,
    bytes32[] memory _returnValues
  ) internal returns (bytes32) {
    bytes memory operationFL = abi.encode(operation);
    operation.callData[1][operation.callData[1].length - 1] = operationFL;

    _flashloanActionAddr.delegatecall(
      abi.encodeWithSignature("executeAction(bytes[])", operation.callData[1])
    );
    return bytes32(0);
  }

  function isFlashLoanAction(address actionAddr) internal pure returns (bool) {
    return ActionBase(actionAddr).actionType() == uint8(ActionBase.ActionType.FLASHLOAN);
  }
}
