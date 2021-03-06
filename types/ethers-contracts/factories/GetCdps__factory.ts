/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import { Contract, Signer } from "ethers";
import { Provider } from "@ethersproject/providers";

import type { GetCdps } from "../GetCdps";

export class GetCdps__factory {
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): GetCdps {
    return new Contract(address, _abi, signerOrProvider) as GetCdps;
  }
}

const _abi = [
  {
    constant: true,
    inputs: [
      {
        internalType: "address",
        name: "manager",
        type: "address",
      },
      {
        internalType: "address",
        name: "guy",
        type: "address",
      },
    ],
    name: "getCdpsAsc",
    outputs: [
      {
        internalType: "uint256[]",
        name: "ids",
        type: "uint256[]",
      },
      {
        internalType: "address[]",
        name: "urns",
        type: "address[]",
      },
      {
        internalType: "bytes32[]",
        name: "ilks",
        type: "bytes32[]",
      },
    ],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [
      {
        internalType: "address",
        name: "manager",
        type: "address",
      },
      {
        internalType: "address",
        name: "guy",
        type: "address",
      },
    ],
    name: "getCdpsDesc",
    outputs: [
      {
        internalType: "uint256[]",
        name: "ids",
        type: "uint256[]",
      },
      {
        internalType: "address[]",
        name: "urns",
        type: "address[]",
      },
      {
        internalType: "bytes32[]",
        name: "ilks",
        type: "bytes32[]",
      },
    ],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
];
