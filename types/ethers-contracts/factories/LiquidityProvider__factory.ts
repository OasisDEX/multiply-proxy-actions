/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import { Contract, Signer } from "ethers";
import { Provider } from "@ethersproject/providers";

import type { LiquidityProvider } from "../LiquidityProvider";

export class LiquidityProvider__factory {
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): LiquidityProvider {
    return new Contract(address, _abi, signerOrProvider) as LiquidityProvider;
  }
}

const _abi = [
  {
    constant: false,
    inputs: [
      {
        name: "otc",
        type: "address",
      },
      {
        name: "baseToken",
        type: "address",
      },
      {
        name: "quoteToken",
        type: "address",
      },
    ],
    name: "cancelMyOffers",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      {
        name: "otc",
        type: "address",
      },
      {
        name: "baseToken",
        type: "address",
      },
      {
        name: "quoteToken",
        type: "address",
      },
      {
        name: "midPrice",
        type: "uint256",
      },
      {
        name: "delta",
        type: "uint256",
      },
      {
        name: "baseAmount",
        type: "uint256",
      },
      {
        name: "count",
        type: "uint256",
      },
    ],
    name: "linearOffers",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "constructor",
  },
];
