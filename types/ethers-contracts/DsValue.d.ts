/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import {
  ethers,
  EventFilter,
  Signer,
  BigNumber,
  BigNumberish,
  PopulatedTransaction,
  Contract,
  ContractTransaction,
  Overrides,
  CallOverrides,
} from "ethers";
import { BytesLike } from "@ethersproject/bytes";
import { Listener, Provider } from "@ethersproject/providers";
import { FunctionFragment, EventFragment, Result } from "@ethersproject/abi";
import { TypedEventFilter, TypedEvent, TypedListener } from "./commons";

interface DsValueInterface extends ethers.utils.Interface {
  functions: {
    "setOwner(address)": FunctionFragment;
    "poke(bytes32)": FunctionFragment;
    "read()": FunctionFragment;
    "peek()": FunctionFragment;
    "setAuthority(address)": FunctionFragment;
    "owner()": FunctionFragment;
    "void()": FunctionFragment;
    "authority()": FunctionFragment;
  };

  encodeFunctionData(functionFragment: "setOwner", values: [string]): string;
  encodeFunctionData(functionFragment: "poke", values: [BytesLike]): string;
  encodeFunctionData(functionFragment: "read", values?: undefined): string;
  encodeFunctionData(functionFragment: "peek", values?: undefined): string;
  encodeFunctionData(
    functionFragment: "setAuthority",
    values: [string]
  ): string;
  encodeFunctionData(functionFragment: "owner", values?: undefined): string;
  encodeFunctionData(functionFragment: "void", values?: undefined): string;
  encodeFunctionData(functionFragment: "authority", values?: undefined): string;

  decodeFunctionResult(functionFragment: "setOwner", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "poke", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "read", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "peek", data: BytesLike): Result;
  decodeFunctionResult(
    functionFragment: "setAuthority",
    data: BytesLike
  ): Result;
  decodeFunctionResult(functionFragment: "owner", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "void", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "authority", data: BytesLike): Result;

  events: {
    "LogNote(bytes4,address,bytes32,bytes32,uint256,bytes)": EventFragment;
    "LogSetAuthority(address)": EventFragment;
    "LogSetOwner(address)": EventFragment;
  };

  getEvent(nameOrSignatureOrTopic: "LogNote"): EventFragment;
  getEvent(nameOrSignatureOrTopic: "LogSetAuthority"): EventFragment;
  getEvent(nameOrSignatureOrTopic: "LogSetOwner"): EventFragment;
}

export class DsValue extends Contract {
  connect(signerOrProvider: Signer | Provider | string): this;
  attach(addressOrName: string): this;
  deployed(): Promise<this>;

  listeners<EventArgsArray extends Array<any>, EventArgsObject>(
    eventFilter?: TypedEventFilter<EventArgsArray, EventArgsObject>
  ): Array<TypedListener<EventArgsArray, EventArgsObject>>;
  off<EventArgsArray extends Array<any>, EventArgsObject>(
    eventFilter: TypedEventFilter<EventArgsArray, EventArgsObject>,
    listener: TypedListener<EventArgsArray, EventArgsObject>
  ): this;
  on<EventArgsArray extends Array<any>, EventArgsObject>(
    eventFilter: TypedEventFilter<EventArgsArray, EventArgsObject>,
    listener: TypedListener<EventArgsArray, EventArgsObject>
  ): this;
  once<EventArgsArray extends Array<any>, EventArgsObject>(
    eventFilter: TypedEventFilter<EventArgsArray, EventArgsObject>,
    listener: TypedListener<EventArgsArray, EventArgsObject>
  ): this;
  removeListener<EventArgsArray extends Array<any>, EventArgsObject>(
    eventFilter: TypedEventFilter<EventArgsArray, EventArgsObject>,
    listener: TypedListener<EventArgsArray, EventArgsObject>
  ): this;
  removeAllListeners<EventArgsArray extends Array<any>, EventArgsObject>(
    eventFilter: TypedEventFilter<EventArgsArray, EventArgsObject>
  ): this;

  listeners(eventName?: string): Array<Listener>;
  off(eventName: string, listener: Listener): this;
  on(eventName: string, listener: Listener): this;
  once(eventName: string, listener: Listener): this;
  removeListener(eventName: string, listener: Listener): this;
  removeAllListeners(eventName?: string): this;

  queryFilter<EventArgsArray extends Array<any>, EventArgsObject>(
    event: TypedEventFilter<EventArgsArray, EventArgsObject>,
    fromBlockOrBlockhash?: string | number | undefined,
    toBlock?: string | number | undefined
  ): Promise<Array<TypedEvent<EventArgsArray & EventArgsObject>>>;

  interface: DsValueInterface;

  functions: {
    setOwner(
      owner_: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;

    "setOwner(address)"(
      owner_: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;

    poke(
      wut: BytesLike,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;

    "poke(bytes32)"(
      wut: BytesLike,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;

    read(overrides?: CallOverrides): Promise<[string]>;

    "read()"(overrides?: CallOverrides): Promise<[string]>;

    peek(overrides?: CallOverrides): Promise<[string, boolean]>;

    "peek()"(overrides?: CallOverrides): Promise<[string, boolean]>;

    setAuthority(
      authority_: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;

    "setAuthority(address)"(
      authority_: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;

    owner(overrides?: CallOverrides): Promise<[string]>;

    "owner()"(overrides?: CallOverrides): Promise<[string]>;

    void(
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;

    "void()"(
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;

    authority(overrides?: CallOverrides): Promise<[string]>;

    "authority()"(overrides?: CallOverrides): Promise<[string]>;
  };

  setOwner(
    owner_: string,
    overrides?: Overrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  "setOwner(address)"(
    owner_: string,
    overrides?: Overrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  poke(
    wut: BytesLike,
    overrides?: Overrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  "poke(bytes32)"(
    wut: BytesLike,
    overrides?: Overrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  read(overrides?: CallOverrides): Promise<string>;

  "read()"(overrides?: CallOverrides): Promise<string>;

  peek(overrides?: CallOverrides): Promise<[string, boolean]>;

  "peek()"(overrides?: CallOverrides): Promise<[string, boolean]>;

  setAuthority(
    authority_: string,
    overrides?: Overrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  "setAuthority(address)"(
    authority_: string,
    overrides?: Overrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  owner(overrides?: CallOverrides): Promise<string>;

  "owner()"(overrides?: CallOverrides): Promise<string>;

  void(
    overrides?: Overrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  "void()"(
    overrides?: Overrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  authority(overrides?: CallOverrides): Promise<string>;

  "authority()"(overrides?: CallOverrides): Promise<string>;

  callStatic: {
    setOwner(owner_: string, overrides?: CallOverrides): Promise<void>;

    "setOwner(address)"(
      owner_: string,
      overrides?: CallOverrides
    ): Promise<void>;

    poke(wut: BytesLike, overrides?: CallOverrides): Promise<void>;

    "poke(bytes32)"(wut: BytesLike, overrides?: CallOverrides): Promise<void>;

    read(overrides?: CallOverrides): Promise<string>;

    "read()"(overrides?: CallOverrides): Promise<string>;

    peek(overrides?: CallOverrides): Promise<[string, boolean]>;

    "peek()"(overrides?: CallOverrides): Promise<[string, boolean]>;

    setAuthority(authority_: string, overrides?: CallOverrides): Promise<void>;

    "setAuthority(address)"(
      authority_: string,
      overrides?: CallOverrides
    ): Promise<void>;

    owner(overrides?: CallOverrides): Promise<string>;

    "owner()"(overrides?: CallOverrides): Promise<string>;

    void(overrides?: CallOverrides): Promise<void>;

    "void()"(overrides?: CallOverrides): Promise<void>;

    authority(overrides?: CallOverrides): Promise<string>;

    "authority()"(overrides?: CallOverrides): Promise<string>;
  };

  filters: {
    LogNote(
      sig: BytesLike | null,
      guy: string | null,
      foo: BytesLike | null,
      bar: BytesLike | null,
      wad: null,
      fax: null
    ): TypedEventFilter<
      [string, string, string, string, BigNumber, string],
      {
        sig: string;
        guy: string;
        foo: string;
        bar: string;
        wad: BigNumber;
        fax: string;
      }
    >;

    LogSetAuthority(
      authority: string | null
    ): TypedEventFilter<[string], { authority: string }>;

    LogSetOwner(
      owner: string | null
    ): TypedEventFilter<[string], { owner: string }>;
  };

  estimateGas: {
    setOwner(
      owner_: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;

    "setOwner(address)"(
      owner_: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;

    poke(
      wut: BytesLike,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;

    "poke(bytes32)"(
      wut: BytesLike,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;

    read(overrides?: CallOverrides): Promise<BigNumber>;

    "read()"(overrides?: CallOverrides): Promise<BigNumber>;

    peek(overrides?: CallOverrides): Promise<BigNumber>;

    "peek()"(overrides?: CallOverrides): Promise<BigNumber>;

    setAuthority(
      authority_: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;

    "setAuthority(address)"(
      authority_: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;

    owner(overrides?: CallOverrides): Promise<BigNumber>;

    "owner()"(overrides?: CallOverrides): Promise<BigNumber>;

    void(
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;

    "void()"(
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;

    authority(overrides?: CallOverrides): Promise<BigNumber>;

    "authority()"(overrides?: CallOverrides): Promise<BigNumber>;
  };

  populateTransaction: {
    setOwner(
      owner_: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;

    "setOwner(address)"(
      owner_: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;

    poke(
      wut: BytesLike,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;

    "poke(bytes32)"(
      wut: BytesLike,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;

    read(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    "read()"(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    peek(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    "peek()"(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    setAuthority(
      authority_: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;

    "setAuthority(address)"(
      authority_: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;

    owner(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    "owner()"(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    void(
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;

    "void()"(
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;

    authority(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    "authority()"(overrides?: CallOverrides): Promise<PopulatedTransaction>;
  };
}
