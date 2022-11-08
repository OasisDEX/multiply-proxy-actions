// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity >=0.7.6;
pragma abicoder v2;

abstract contract ActionBase {
  enum ActionType {
    FLASHLOAN,
    DEFAULT
  }

  function executeAction(bytes[] memory _callData) public payable virtual returns (bytes32);

  function actionType() public pure virtual returns (uint8);
}
