// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity >=0.7.6;
pragma abicoder v2;

import "../interfaces/mcd/IJoin.sol";
import "../interfaces/mcd/IManager.sol";
import "./ActionBase.sol";
import "hardhat/console.sol";

contract Deposit is ActionBase {
  function executeAction(bytes[] memory _callData)
    public
    payable
    override
    returns (
      // ) public payable virtual override returns (bytes32) {
      bytes32
    )
  {
    (address joinAddr, address mcdManager) = parseInputs(_callData);
    // address joinAddr = 0x2F0b23f53734252Bda2277357e97e1517d6B042A;
    // address mcdManager = 0x5ef30b9986345249bc32d8928B7ee64DE9435E39;

    // // joinAddr = _parseParamAddr(joinAddr, _paramMapping[0], _subData, _returnValues);

    console.log("address this", address(this));

    uint256 newVaultId = _mcdOpen(joinAddr, mcdManager);

    return bytes32(newVaultId);
  }

  function actionType() public pure override returns (uint8) {
    return uint8(ActionType.DEFAULT);
  }

  function _mcdOpen(address _joinAddr, address _mcdManager) internal returns (uint256 vaultId) {
    bytes32 ilk = IJoin(_joinAddr).ilk();
    vaultId = IManager(_mcdManager).open(ilk, address(this));
  }

  function parseInputs(bytes[] memory _callData)
    internal
    pure
    returns (address joinAddr, address mcdManager)
  {
    joinAddr = abi.decode(_callData[0], (address));
    mcdManager = abi.decode(_callData[1], (address));
  }
}
