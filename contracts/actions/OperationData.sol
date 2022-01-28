// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity >=0.7.6;
pragma abicoder v2;

struct Operation {
  string name;
  bytes[][] callData;
  bytes32[] actionIds;
}
