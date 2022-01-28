// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity >=0.7.6;
pragma abicoder v2;

import "../interfaces/mcd/IJoin.sol";
import "../interfaces/mcd/IManager.sol";
import "./ActionBase.sol";
import "hardhat/console.sol";

contract Deposit is ActionBase {
  function executeAction(bytes[] memory _callData) public payable override returns (bytes32) {
    console.log("TODO EXECUTE DEPOSIT");
  }

  function actionType() public pure override returns (uint8) {
    return uint8(ActionType.DEFAULT);
  }

  function _deposit() internal returns (uint256 vaultId) {}

  function parseInputs(bytes[] memory _callData)
    internal
    pure
    returns (
      uint256 vaultId,
      uint256 amount,
      address joinAddr,
      address from,
      address mcdManager
    )
  {
    vaultId = abi.decode(_callData[0], (uint256));
    amount = abi.decode(_callData[1], (uint256));
    joinAddr = abi.decode(_callData[2], (address));
    from = abi.decode(_callData[3], (address));
    mcdManager = abi.decode(_callData[4], (address));
  }
}
