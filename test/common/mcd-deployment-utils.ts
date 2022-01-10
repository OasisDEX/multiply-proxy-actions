import BigNumber from 'bignumber.js'
import _ from 'lodash'
import { curry } from 'ramda'
import { ethers } from 'hardhat'
import { BigNumber as EthersBN, Contract, Signer } from 'ethers'
import DSProxyRegistryABI from '../../abi/external/ds-proxy-registry.json'
import DSProxyABI from '../../abi/external/ds-proxy.json'
import WETHABI from '../../abi/IWETH.json'
import ERC20ABI from '../../abi/IERC20.json'
import GetCDPsABI from '../../abi/external/get-cdps.json'
import UniswapRouterV3ABI from '../../abi/external/IUniswapRouter.json'
import MAINNET_ADDRESSES from '../../addresses/mainnet.json'

import { JsonRpcProvider } from '@ethersproject/providers'
import { balanceOf, one, zero, WETH_ADDRESS } from '../utils'

import {
  amountToWei,
  amountFromWei,
  addressRegistryFactory,
  ensureWeiFormat,
} from './params-calculation-utils'
import { getMarketPrice } from './http-apis'

export const FEE = 20
export const FEE_BASE = 10000

export interface MCDInitParams {
  blockNumber?: string
  provider?: JsonRpcProvider
  signer?: Signer
}

export interface ERC20TokenData {
  name: string
  address: string
  precision: number
  pip?: string
}

export async function init(params: MCDInitParams = {}): Promise<[JsonRpcProvider, Signer]> {
  const provider = params.provider || new ethers.providers.JsonRpcProvider()
  const signer = params.signer || provider.getSigner(0)

  const forking = {
    jsonRpcUrl: process.env.ALCHEMY_NODE,
  }

  if (params.blockNumber) {
    // TODO:
    ;(forking as any).blockNumber = params.blockNumber
      ? parseInt(params.blockNumber, 10)
      : undefined
  }

  await provider.send('hardhat_reset', [
    {
      forking,
    },
  ])

  return [provider, signer]
}

/**
 * tokenIn: string - asset address
 * tokenOut: string - asset address
 * amountIn: BigNumber - already formatted to wei
 * amountOutMinimum: BigNumber - already fromatted to wei. The least amount to receive.
 * recipient: string - wallet's addrees that's going to receive the funds
 */

export async function swapTokens(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  amountOutMinimum: string,
  recipient: string,
  provider: JsonRpcProvider,
  signer: Signer,
) {
  const value = tokenIn === MAINNET_ADDRESSES.ETH ? amountIn : 0

  const UNISWAP_ROUTER_V3 = '0xe592427a0aece92de3edee1f18e0157c05861564'
  const uniswapV3 = new ethers.Contract(UNISWAP_ROUTER_V3, UniswapRouterV3ABI, provider).connect(
    signer,
  )

  const swapParams = {
    tokenIn,
    tokenOut,
    fee: 3000,
    recipient,
    deadline: new Date().getTime(),
    amountIn,
    amountOutMinimum,
    sqrtPriceLimitX96: 0,
  }

  await uniswapV3.exactInputSingle(swapParams, { value })
}

export async function dsproxyExecuteAction(
  proxyActions: Contract,
  dsProxy: Contract,
  fromAddress: string,
  method: string,
  params: any[],
  value = new BigNumber(0),
  debug = false,
) {
  try {
    const calldata = proxyActions.interface.encodeFunctionData(method, params)

    debug && console.log(`\x1b[33m ${method} started \x1b[0m`, new Date())
    const tx = await dsProxy['execute(address,bytes)'](proxyActions.address, calldata, {
      from: fromAddress,
      value: ensureWeiFormat(value),
      gasLimit: 8500000,
      gasPrice: 1000000000,
    })

    const retVal = await tx.wait()
    debug &&
      console.log(
        `\x1b[33m  ${method} completed  gasCost = ${retVal.gasUsed.toString()} \x1b[0m`,
        new Date(),
      )

    return [true, retVal]
  } catch (ex) {
    debug && console.log(`\x1b[33m  ${method} failed  \x1b[0m`, ex, params)
    return [false, ex]
  }
}

export async function getOrCreateProxy(provider: JsonRpcProvider, signer: Signer) {
  const address = await signer.getAddress()
  const dsProxyRegistry = new ethers.Contract(
    MAINNET_ADDRESSES.PROXY_REGISTRY,
    DSProxyRegistryABI,
    provider,
  ).connect(signer)
  let proxyAddress = await dsProxyRegistry.proxies(address)
  if (proxyAddress === ethers.constants.AddressZero) {
    await (await dsProxyRegistry['build()']()).wait()
    proxyAddress = await dsProxyRegistry.proxies(address)
  }
  return proxyAddress
}

async function exchangeToToken(provider: JsonRpcProvider, signer: Signer, token: ERC20TokenData) {
  const UNISWAP_ROUTER_V3 = '0xe592427a0aece92de3edee1f18e0157c05861564'
  const uniswapV3 = new ethers.Contract(UNISWAP_ROUTER_V3, UniswapRouterV3ABI, provider).connect(
    signer,
  )

  const address = await signer.getAddress()

  const swapParams = {
    tokenIn: MAINNET_ADDRESSES.ETH,
    tokenOut: token.address,
    fee: 3000,
    recipient: address,
    deadline: 1751366148,
    amountIn: amountToWei(200).toFixed(0),
    amountOutMinimum: amountToWei(zero, token.precision).toFixed(0),
    sqrtPriceLimitX96: 0,
  }

  const uniswapTx = await uniswapV3.exactInputSingle(swapParams, {
    value: amountToWei(200).toFixed(0),
  })

  await uniswapTx.wait()
}

async function transferToExchange(
  provider: JsonRpcProvider,
  signer: Signer,
  exchangeAddress: string,
  token: ERC20TokenData,
  amount: BigNumber.Value,
) {
  const contract = new ethers.Contract(token.address, ERC20ABI, provider).connect(signer)

  const tokenTransferToExchangeTx = await contract.transfer(exchangeAddress, amount)

  await tokenTransferToExchangeTx.wait()
}

const addFundsDummyExchange = async function (
  provider: JsonRpcProvider,
  signer: Signer,
  WETH_ADDRESS: string, // TODO: remove
  erc20Tokens: ERC20TokenData[], // TODO:
  exchange: Contract,
  debug: boolean,
) {
  const WETH = new ethers.Contract(WETH_ADDRESS, WETHABI, provider).connect(signer)
  const address = await signer.getAddress()

  const exchangeToTokenCurried = curry(exchangeToToken)(provider, signer)
  const transferToExchangeCurried = curry(transferToExchange)(provider, signer, exchange.address)

  const wethDeposit = await WETH.deposit({
    value: amountToWei(1000).toFixed(0),
  })
  await wethDeposit.wait()

  const wethTransferToExchangeTx = await WETH.transfer(
    exchange.address,
    amountToWei(500).toFixed(0),
  )
  await wethTransferToExchangeTx.wait()

  // Exchange ETH for the `token`
  await Promise.all(erc20Tokens.map(token => exchangeToTokenCurried(token)))

  // Transfer half of the accounts balance of each token to the dummy exchange.
  await Promise.all(
    erc20Tokens.map(async token => {
      const balance = await balanceOf(token.address, address)
      return transferToExchangeCurried(token, balance.div(2).toFixed(0))
    }),
  )

  if (debug) {
    // Diplays balances of the exchange and account for each token
    await Promise.all(
      erc20Tokens.map(async function (token) {
        const [exchangeTokenBalance, addressTokenBalance] = await Promise.all([
          balanceOf(token.address, exchange.address),
          balanceOf(token.address, address),
        ])
        console.log(
          `Exchange ${token.name} balance: ${amountFromWei(
            exchangeTokenBalance,
            token.precision,
          ).toString()}`,
        )
        console.log(
          `${address} ${token.name} balance: ${amountFromWei(
            addressTokenBalance,
            token.precision,
          ).toString()}`,
        )
      }),
    )
  }
}

export async function loadDummyExchangeFixtures(
  provider: JsonRpcProvider,
  signer: Signer,
  dummyExchangeInstance: Contract,
  debug: boolean,
) {
  const tokens = [
    {
      name: 'ETH',
      address: MAINNET_ADDRESSES.ETH,
      pip: MAINNET_ADDRESSES.PIP_ETH,
      precision: 18,
    },
    {
      name: 'DAI',
      address: MAINNET_ADDRESSES.MCD_DAI,
      pip: undefined,
      precision: 18,
    },
    {
      name: 'LINK',
      address: MAINNET_ADDRESSES.LINK,
      pip: MAINNET_ADDRESSES.PIP_LINK,
      precision: 18,
    },
    {
      name: 'WBTC',
      address: MAINNET_ADDRESSES.WBTC,
      pip: MAINNET_ADDRESSES.PIP_WBTC,
      precision: 8,
    },
    {
      name: 'USDC',
      address: MAINNET_ADDRESSES.USDC,
      pip: MAINNET_ADDRESSES.PIP_USDC,
      precision: 6,
    },
  ]

  // Exchanging ETH for other @tokens
  await addFundsDummyExchange(
    provider,
    signer,
    WETH_ADDRESS,
    tokens.filter(token => token.address !== MAINNET_ADDRESSES.ETH),
    dummyExchangeInstance,
    debug,
  )

  // Setting precision for each @token that is going to be used.
  await Promise.all(
    tokens.map(token => {
      if (debug) {
        console.log(`${token.name} precision: ${token.precision}`)
      }

      if (dummyExchangeInstance.setPrecision) {
        return dummyExchangeInstance.setPrecision(token.address, token.precision)
      }

      return true
    }),
  )

  // Setting price for each @token that has PIP
  await Promise.all(
    tokens
      .filter(token => !!token.pip)
      .map(async token => {
        const price = await getMarketPrice(
          token.address,
          MAINNET_ADDRESSES.MCD_DAI,
          token.precision,
        )
        const priceInWei = amountToWei(price).toFixed(0)

        if (debug) {
          console.log(`${token.name} Price: ${price.toString()} and Price(wei): ${priceInWei}`)
        }

        if (dummyExchangeInstance.setPrice) {
          return dummyExchangeInstance.setPrice(token.address, priceInWei)
        }

        return true
      }),
  )

  if (debug) {
    tokens.map(token => {
      console.log(`${token.name}: ${token.address}`)
    })
  }
}

export async function deploySystem(
  provider: JsonRpcProvider,
  signer: Signer,
  usingDummyExchange = false,
  debug = false,
) {
  // TODO:
  const deployedContracts: any = {
    // defined during system deployment
    mcdViewInstance: undefined,
    exchangeInstance: undefined,
    multiplyProxyActionsInstance: undefined,
    dsProxyInstance: undefined,
    gems: {
      wethTokenInstance: undefined,
    },
    daiTokenInstance: undefined,
    guni: undefined,
  }

  const userProxyAddress = await getOrCreateProxy(provider, signer)
  const dsProxy = new ethers.Contract(userProxyAddress, DSProxyABI, provider).connect(signer)

  deployedContracts.userProxyAddress = userProxyAddress // TODO:
  deployedContracts.dsProxyInstance = dsProxy

  // GUNI DEPLOYMENT

  const GUni = await ethers.getContractFactory('GuniMultiplyProxyActions', signer)
  const guni = await GUni.deploy()
  deployedContracts.guni = await guni.deployed()

  // const multiplyProxyActions = await deploy("MultiplyProxyActions");
  const MPActions = await ethers.getContractFactory('MultiplyProxyActions', signer)
  const multiplyProxyActions = await MPActions.deploy()
  deployedContracts.multiplyProxyActionsInstance = await multiplyProxyActions.deployed()

  const incompleteRegistry = addressRegistryFactory(
    deployedContracts.multiplyProxyActionsInstance,
    '', // TODO:
  )

  const McdView = await ethers.getContractFactory('McdView', signer)
  const mcdView = await McdView.deploy()
  deployedContracts.mcdViewInstance = await mcdView.deployed()

  const Exchange = await ethers.getContractFactory('Exchange', signer)
  const exchange = await Exchange.deploy(
    multiplyProxyActions.address,
    incompleteRegistry.feeRecepient,
    FEE,
  )
  const exchangeInstance = await exchange.deployed()

  const DummyExchange = await ethers.getContractFactory('DummyExchange', signer)
  const dummyExchange = await DummyExchange.deploy()
  const dummyExchangeInstance = await dummyExchange.deployed()

  if (usingDummyExchange == false) {
    deployedContracts.exchangeInstance = exchangeInstance
  } else {
    deployedContracts.exchangeInstance = dummyExchangeInstance
  }

  await loadDummyExchangeFixtures(provider, signer, dummyExchangeInstance, debug)

  if (debug) {
    console.log('Signer address:', await signer.getAddress())
    console.log('Exchange address:', deployedContracts.exchangeInstance.address)
    console.log('User Proxy Address:', deployedContracts.userProxyAddress) // TODO:
    console.log('DSProxy address:', deployedContracts.dsProxyInstance.address)
    console.log(
      'MultiplyProxyActions address:',
      deployedContracts.multiplyProxyActionsInstance.address,
    )
    console.log('GuniMultiplyProxyActions address:', guni.address)
    console.log('MCDView address:', deployedContracts.mcdViewInstance.address)
  }

  return deployedContracts
}

export const ONE = one // TODO: omg

export async function getOraclePrice(
  provider: JsonRpcProvider,
  pipAddress = MAINNET_ADDRESSES.PIP_ETH,
) {
  const storageHexToBigNumber = (uint256: string) => {
    const match = uint256.match(/^0x(\w+)$/)
    if (!match) {
      throw new Error(`invalid uint256: ${uint256}`)
    }
    return match[0].length <= 32
      ? [new BigNumber(0), new BigNumber(uint256)]
      : [
          new BigNumber(`0x${match[0].substr(0, match[0].length - 32)}`),
          new BigNumber(`0x${match[0].substr(match[0].length - 32, 32)}`),
        ]
  }
  const slotCurrent = 3
  const priceHex = await provider.getStorageAt(pipAddress, slotCurrent)
  const p = storageHexToBigNumber(priceHex)
  return p[1].shiftedBy(-18)
}

export async function getLastCDP(provider: JsonRpcProvider, signer: Signer, proxyAddress: string) {
  const getCdps = new ethers.Contract(MAINNET_ADDRESSES.GET_CDPS, GetCDPsABI, provider).connect(
    signer,
  )
  const { ids, urns, ilks } = await getCdps.getCdpsAsc(MAINNET_ADDRESSES.CDP_MANAGER, proxyAddress)
  const cdp = _.last(
    _.map(_.zip(ids, urns, ilks), cdp => ({
      id: (cdp[0] as EthersBN).toNumber(), // TODO:
      urn: cdp[1],
      ilk: cdp[2],
    })),
  )
  if (_.isUndefined(cdp)) {
    throw new Error('No CDP available')
  }
  return cdp
}

// TODO:
export function findMPAEvent(txResult: any) {
  const abi = [
    'event MultipleActionCalled(string methodName, uint indexed cdpId, uint swapMinAmount, uint swapOptimistAmount, uint collateralLeft, uint daiLeft)',
  ]
  const iface = new ethers.utils.Interface(abi)
  const events = txResult.events
    // TODO:
    .filter((x: any) => {
      return x.topics[0] == iface.getEventTopic('MultipleActionCalled')
    })
    // TODO:
    .map((x: any) => {
      const result = iface.decodeEventLog('MultipleActionCalled', x.data, x.topics)
      const retVal = {
        methodName: result.methodName,
        cdpId: result.cdpId.toString(),
        swapMinAmount: result.swapMinAmount.toString(),
        swapOptimistAmount: result.swapOptimistAmount.toString(),
        collateralLeft: result.collateralLeft.toString(),
        daiLeft: result.daiLeft.toString(),
      }
      return retVal
    })
  return events
}
