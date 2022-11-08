// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity ^0.8.1;

struct CdpData {
  address gemJoin;
  address payable fundsReceiver;
  uint256 cdpId;
  bytes32 ilk;
  uint256 requiredDebt;
  uint256 borrowCollateral;
  uint256 withdrawCollateral;
  uint256 withdrawDai;
  uint256 depositDai;
  uint256 depositCollateral;
  bool skipFL;
  string methodName;
}
