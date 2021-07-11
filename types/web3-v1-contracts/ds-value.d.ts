/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import BN from "bn.js";
import { ContractOptions } from "web3-eth-contract";
import { EventLog } from "web3-core";
import { EventEmitter } from "events";
import {
  Callback,
  PayableTransactionObject,
  NonPayableTransactionObject,
  BlockType,
  ContractEventLog,
  BaseContract,
} from "./types";

interface EventOptions {
  filter?: object;
  fromBlock?: BlockType;
  topics?: string[];
}

export type LogNote = ContractEventLog<{
  sig: string;
  guy: string;
  foo: string;
  bar: string;
  wad: string;
  fax: string;
  0: string;
  1: string;
  2: string;
  3: string;
  4: string;
  5: string;
}>;
export type LogSetAuthority = ContractEventLog<{
  authority: string;
  0: string;
}>;
export type LogSetOwner = ContractEventLog<{
  owner: string;
  0: string;
}>;

export interface DsValue extends BaseContract {
  constructor(
    jsonInterface: any[],
    address?: string,
    options?: ContractOptions
  ): DsValue;
  clone(): DsValue;
  methods: {
    setOwner(owner_: string): NonPayableTransactionObject<void>;

    poke(wut: string | number[]): NonPayableTransactionObject<void>;

    read(): NonPayableTransactionObject<string>;

    peek(): NonPayableTransactionObject<{
      0: string;
      1: boolean;
    }>;

    setAuthority(authority_: string): NonPayableTransactionObject<void>;

    owner(): NonPayableTransactionObject<string>;

    void(): NonPayableTransactionObject<void>;

    authority(): NonPayableTransactionObject<string>;
  };
  events: {
    LogSetAuthority(cb?: Callback<LogSetAuthority>): EventEmitter;
    LogSetAuthority(
      options?: EventOptions,
      cb?: Callback<LogSetAuthority>
    ): EventEmitter;

    LogSetOwner(cb?: Callback<LogSetOwner>): EventEmitter;
    LogSetOwner(
      options?: EventOptions,
      cb?: Callback<LogSetOwner>
    ): EventEmitter;

    allEvents(options?: EventOptions, cb?: Callback<EventLog>): EventEmitter;
  };

  once(event: "LogSetAuthority", cb: Callback<LogSetAuthority>): void;
  once(
    event: "LogSetAuthority",
    options: EventOptions,
    cb: Callback<LogSetAuthority>
  ): void;

  once(event: "LogSetOwner", cb: Callback<LogSetOwner>): void;
  once(
    event: "LogSetOwner",
    options: EventOptions,
    cb: Callback<LogSetOwner>
  ): void;
}
