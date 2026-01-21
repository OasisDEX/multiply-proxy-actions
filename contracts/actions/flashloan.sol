// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity >=0.7.6;
pragma abicoder v2;

import "../interfaces/mcd/IJoin.sol";
import "../interfaces/mcd/IManager.sol";
import "./ActionBase.sol";
import "hardhat/console.sol";

contract Flashloan is ActionBase {
  function actionType() public pure override returns (uint8) {
    return uint8(ActionType.FLASHLOAN);
  }

  function executeAction(bytes[] memory _callData)
    public
    payable
    override
    returns (
      // ) public payable virtual override returns (bytes32) {
      bytes32
    )
  {
    return "";
  }
}
