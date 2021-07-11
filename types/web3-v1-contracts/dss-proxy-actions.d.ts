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

export interface DssProxyActions extends BaseContract {
  constructor(
    jsonInterface: any[],
    address?: string,
    options?: ContractOptions
  ): DssProxyActions;
  clone(): DssProxyActions;
  methods: {
    cdpAllow(
      manager: string,
      cdp: number | string,
      usr: string,
      ok: number | string
    ): NonPayableTransactionObject<void>;

    daiJoin_join(
      apt: string,
      urn: string,
      wad: number | string
    ): NonPayableTransactionObject<void>;

    draw(
      manager: string,
      jug: string,
      daiJoin: string,
      cdp: number | string,
      wad: number | string
    ): NonPayableTransactionObject<void>;

    enter(
      manager: string,
      src: string,
      cdp: number | string
    ): NonPayableTransactionObject<void>;

    ethJoin_join(apt: string, urn: string): PayableTransactionObject<void>;

    exitETH(
      manager: string,
      ethJoin: string,
      cdp: number | string,
      wad: number | string
    ): NonPayableTransactionObject<void>;

    exitGem(
      manager: string,
      gemJoin: string,
      cdp: number | string,
      amt: number | string
    ): NonPayableTransactionObject<void>;

    flux(
      manager: string,
      cdp: number | string,
      dst: string,
      wad: number | string
    ): NonPayableTransactionObject<void>;

    freeETH(
      manager: string,
      ethJoin: string,
      cdp: number | string,
      wad: number | string
    ): NonPayableTransactionObject<void>;

    freeGem(
      manager: string,
      gemJoin: string,
      cdp: number | string,
      amt: number | string
    ): NonPayableTransactionObject<void>;

    frob(
      manager: string,
      cdp: number | string,
      dink: number | string,
      dart: number | string
    ): NonPayableTransactionObject<void>;

    gemJoin_join(
      apt: string,
      urn: string,
      amt: number | string,
      transferFrom: boolean
    ): NonPayableTransactionObject<void>;

    give(
      manager: string,
      cdp: number | string,
      usr: string
    ): NonPayableTransactionObject<void>;

    giveToProxy(
      proxyRegistry: string,
      manager: string,
      cdp: number | string,
      dst: string
    ): NonPayableTransactionObject<void>;

    hope(obj: string, usr: string): NonPayableTransactionObject<void>;

    lockETH(
      manager: string,
      ethJoin: string,
      cdp: number | string
    ): PayableTransactionObject<void>;

    lockETHAndDraw(
      manager: string,
      jug: string,
      ethJoin: string,
      daiJoin: string,
      cdp: number | string,
      wadD: number | string
    ): PayableTransactionObject<void>;

    lockGem(
      manager: string,
      gemJoin: string,
      cdp: number | string,
      amt: number | string,
      transferFrom: boolean
    ): NonPayableTransactionObject<void>;

    lockGemAndDraw(
      manager: string,
      jug: string,
      gemJoin: string,
      daiJoin: string,
      cdp: number | string,
      amtC: number | string,
      wadD: number | string,
      transferFrom: boolean
    ): NonPayableTransactionObject<void>;

    makeGemBag(gemJoin: string): NonPayableTransactionObject<string>;

    move(
      manager: string,
      cdp: number | string,
      dst: string,
      rad: number | string
    ): NonPayableTransactionObject<void>;

    nope(obj: string, usr: string): NonPayableTransactionObject<void>;

    open(
      manager: string,
      ilk: string | number[],
      usr: string
    ): NonPayableTransactionObject<string>;

    openLockETHAndDraw(
      manager: string,
      jug: string,
      ethJoin: string,
      daiJoin: string,
      ilk: string | number[],
      wadD: number | string
    ): PayableTransactionObject<string>;

    openLockGNTAndDraw(
      manager: string,
      jug: string,
      gntJoin: string,
      daiJoin: string,
      ilk: string | number[],
      amtC: number | string,
      wadD: number | string
    ): NonPayableTransactionObject<{
      bag: string;
      cdp: string;
      0: string;
      1: string;
    }>;

    openLockGemAndDraw(
      manager: string,
      jug: string,
      gemJoin: string,
      daiJoin: string,
      ilk: string | number[],
      amtC: number | string,
      wadD: number | string,
      transferFrom: boolean
    ): NonPayableTransactionObject<string>;

    quit(
      manager: string,
      cdp: number | string,
      dst: string
    ): NonPayableTransactionObject<void>;

    safeLockETH(
      manager: string,
      ethJoin: string,
      cdp: number | string,
      owner: string
    ): PayableTransactionObject<void>;

    safeLockGem(
      manager: string,
      gemJoin: string,
      cdp: number | string,
      amt: number | string,
      transferFrom: boolean,
      owner: string
    ): NonPayableTransactionObject<void>;

    safeWipe(
      manager: string,
      daiJoin: string,
      cdp: number | string,
      wad: number | string,
      owner: string
    ): NonPayableTransactionObject<void>;

    safeWipeAll(
      manager: string,
      daiJoin: string,
      cdp: number | string,
      owner: string
    ): NonPayableTransactionObject<void>;

    shift(
      manager: string,
      cdpSrc: number | string,
      cdpOrg: number | string
    ): NonPayableTransactionObject<void>;

    transfer(
      gem: string,
      dst: string,
      amt: number | string
    ): NonPayableTransactionObject<void>;

    urnAllow(
      manager: string,
      usr: string,
      ok: number | string
    ): NonPayableTransactionObject<void>;

    wipe(
      manager: string,
      daiJoin: string,
      cdp: number | string,
      wad: number | string
    ): NonPayableTransactionObject<void>;

    wipeAll(
      manager: string,
      daiJoin: string,
      cdp: number | string
    ): NonPayableTransactionObject<void>;

    wipeAllAndFreeETH(
      manager: string,
      ethJoin: string,
      daiJoin: string,
      cdp: number | string,
      wadC: number | string
    ): NonPayableTransactionObject<void>;

    wipeAllAndFreeGem(
      manager: string,
      gemJoin: string,
      daiJoin: string,
      cdp: number | string,
      amtC: number | string
    ): NonPayableTransactionObject<void>;

    wipeAndFreeETH(
      manager: string,
      ethJoin: string,
      daiJoin: string,
      cdp: number | string,
      wadC: number | string,
      wadD: number | string
    ): NonPayableTransactionObject<void>;

    wipeAndFreeGem(
      manager: string,
      gemJoin: string,
      daiJoin: string,
      cdp: number | string,
      amtC: number | string,
      wadD: number | string
    ): NonPayableTransactionObject<void>;
  };
  events: {
    allEvents(options?: EventOptions, cb?: Callback<EventLog>): EventEmitter;
  };
}
