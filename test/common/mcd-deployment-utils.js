const dsProxyRegistryAbi = require('../../abi/external/ds-proxy-registry.json')
const dsProxyAbi = require('../../abi/external/ds-proxy.json')
const WethAbi = require('../../abi/IWETH.json')
const Erc20Abi = require('../../abi/IERC20.json')
const { default: BigNumber } = require('bignumber.js')
const getCdpsAbi = require('../../abi/external/get-cdps.json')
const _ = require('lodash')
const {
  amountToWei,
  amountFromWei,
  addressRegistryFactory,
  MAINNET_ADRESSES,
  ensureWeiFormat,
  convertToBigNumber,
} = require('./params-calculation-utils')

const UniswapRouterV3Abi = require('../../abi/external/IUniswapRouter.json')

let CONTRACTS = {}

const { balanceOf, TEN, one, zero } = require('../utils')
const { getVaultInfo } = require('../utils-mcd.js')
const { curry } = require('ramda')

const FEE = 2
const FEE_BASE = 10000

const init = async function (blockNumber, provider, signer) {
  blockNumber = blockNumber ? parseInt(blockNumber) : undefined
  provider = provider || new hre.ethers.providers.JsonRpcProvider()
  signer = signer || provider.getSigner(0)

  let forking = {
    jsonRpcUrl: process.env.ALCHEMY_NODE,
  }

  if (blockNumber) {
    forking = { ...forking, blockNumber }
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

const swapTokens = async function (
  tokenIn,
  tokenOut,
  amountIn,
  amountOutMinimum,
  recipient,
  provider,
  signer,
) {
  let value = 0

  if (tokenIn === MAINNET_ADRESSES.ETH) {
    value = amountIn
  }

  const UNISWAP_ROUTER_V3 = '0xe592427a0aece92de3edee1f18e0157c05861564'
  const uniswapV3 = new ethers.Contract(UNISWAP_ROUTER_V3, UniswapRouterV3Abi, provider).connect(
    signer,
  )

  let swapParams = {
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

const dsproxyExecuteAction = async function (
  proxyActions,
  dsProxy,
  fromAddress,
  method,
  params,
  value = new BigNumber(0),
  debug = false,
) {
  try {
    const calldata = proxyActions.interface.encodeFunctionData(method, params)

    debug && console.log(`\x1b[33m ${method} started \x1b[0m`, new Date())
    var tx = await dsProxy['execute(address,bytes)'](proxyActions.address, calldata, {
      from: fromAddress,
      value: ensureWeiFormat(value),
      gasLimit: 8500000,
      gasPrice: '1000000000',
    })

    var retVal = await tx.wait()
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

const getOrCreateProxy = async function getOrCreateProxy(provider, signer) {
  const address = await signer.getAddress()
  const dsProxyRegistry = new ethers.Contract(
    MAINNET_ADRESSES.PROXY_REGISTRY,
    dsProxyRegistryAbi,
    provider,
  ).connect(signer)
  let proxyAddress = await dsProxyRegistry.proxies(address)
  if (proxyAddress === ethers.constants.AddressZero) {
    await (await dsProxyRegistry['build()']()).wait()
    proxyAddress = await dsProxyRegistry.proxies(address)
  }
  return proxyAddress
}

async function exchangeToToken(provider, signer, token) {
  const UNISWAP_ROUTER_V3 = '0xe592427a0aece92de3edee1f18e0157c05861564'
  const uniswapV3 = new ethers.Contract(UNISWAP_ROUTER_V3, UniswapRouterV3Abi, provider).connect(
    signer,
  )

  const address = await signer.getAddress()

  let swapParams = {
    tokenIn: MAINNET_ADRESSES.ETH,
    tokenOut: token.address,
    fee: 3000,
    recipient: address,
    deadline: 1751366148,
    amountIn: amountToWei(new BigNumber(200)).toFixed(0),
    amountOutMinimum: amountToWei(zero, token.precision).toFixed(0),
    sqrtPriceLimitX96: 0,
  }

  const uniswapTx = await uniswapV3.exactInputSingle(swapParams, {
    value: amountToWei(new BigNumber(200)).toFixed(0),
  })

  await uniswapTx.wait()
}

async function transferToExchange(provider, signer, exchangeAddress, token, amount) {
  const Token = new ethers.Contract(token.address, Erc20Abi, provider).connect(signer)

  const tokenTransferToExchangeTx = await Token.transfer(exchangeAddress, amount)

  await tokenTransferToExchangeTx.wait()
}

const addFundsDummyExchange = async function (
  provider,
  signer,
  WETH_ADDRESS,
  erc20Tokens,
  exchange,
  debug,
) {
  const WETH = new ethers.Contract(WETH_ADDRESS, WethAbi, provider).connect(signer)
  const address = await signer.getAddress()

  const exchangeToTokenCurried = curry(exchangeToToken)(provider, signer)
  const transferToExchangeCurried = curry(transferToExchange)(provider, signer, exchange.address)

  const wethDeposit = await WETH.deposit({
    value: amountToWei(new BigNumber(1000)).toFixed(0),
  })
  await wethDeposit.wait()

  const wethTransferToExchangeTx = await WETH.transfer(
    exchange.address,
    amountToWei(new BigNumber(500)).toFixed(0),
  )
  await wethTransferToExchangeTx.wait()

  // Exchange ETH for the `token`
  await Promise.all(erc20Tokens.map((token) => exchangeToTokenCurried(token)))

  // Transfer half of the accounts balance of each token to the dummy exchange.
  await Promise.all(
    erc20Tokens.map(async function (token) {
      const balance = await balanceOf(token.address, address)
      const amountToTransfer = new BigNumber(balance.toString()).dividedBy(2).toFixed(0)
      return transferToExchangeCurried(token, amountToTransfer)
    }),
  )

  if (debug) {
    // Diplays balances of the exchange and account for each token
    await Promise.all(
      erc20Tokens.map(async function (token) {
        const exchangeTokenBalance = convertToBigNumber(
          await balanceOf(token.address, exchange.address),
        )
        const addressTokenBalance = convertToBigNumber(await balanceOf(token.address, address))
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

const loadDummyExchangeFixtures = async function (provider, signer, dummyExchangeInstance, debug) {
  const tokens = [
    {
      name: 'ETH',
      address: MAINNET_ADRESSES.ETH,
      pip: MAINNET_ADRESSES.PIP_ETH,
      precision: 18,
    },
    {
      name: 'DAI',
      address: MAINNET_ADRESSES.MCD_DAI,
      pip: undefined,
      precision: 18,
    },
    {
      name: 'LINK',
      address: MAINNET_ADRESSES.LINK,
      pip: MAINNET_ADRESSES.PIP_LINK,
      precision: 18,
    },
    {
      name: 'WBTC',
      address: MAINNET_ADRESSES.WBTC,
      pip: MAINNET_ADRESSES.PIP_WBTC,
      precision: 8,
    },
  ]

  // Exchanging ETH for other @tokens
  await addFundsDummyExchange(
    provider,
    signer,
    MAINNET_ADRESSES.WETH_ADDRESS,
    tokens.filter((token) => token.address !== MAINNET_ADRESSES.ETH),
    dummyExchangeInstance,
    debug,
  )

  // Setting precision for each @token that is going to be used.
  await Promise.all(
    tokens.map((token) => {
      if (debug) {
        console.log(`${token.name} precision: ${token.precision}`)
      }
      return dummyExchangeInstance.setPrecision(token.address, token.precision)
    }),
  )

  // Setting price for each @token that has PIP
  await Promise.all(
    tokens
      .filter((token) => !!token.pip)
      .map(async (token) => {
        const price = await getOraclePrice(provider, token.pip)
        const priceInWei = amountToWei(price).toFixed(0)
        if (debug) {
          console.log(`${token.name} Price: ${price.toString()} and Price(wei): ${priceInWei}`)
        }
        return dummyExchangeInstance.setPrice(token.address, priceInWei)
      }),
  )

  if (debug) {
    tokens.map((token) => {
      console.log(`${token.name}: ${token.address}`)
    })
  }
}

const deploySystem = async function (provider, signer, isExchangeDummy = false, debug = false) {
  let deployedContracts = {
    // defined during system deployment
    mcdViewInstance: undefined,
    exchangeInstance: undefined,
    multiplyProxyActionsInstance: undefined,
    dsProxyInstance: undefined,
    gems: {
      wethTokenInstance: undefined,
    },
    daiTokenInstance: undefined,
  }

  const userProxyAddress = await getOrCreateProxy(provider, signer)
  const dsProxy = new ethers.Contract(userProxyAddress, dsProxyAbi, provider).connect(signer)

  deployedContracts.userProxyAddress = userProxyAddress
  deployedContracts.dsProxyInstance = dsProxy

  // const multiplyProxyActions = await deploy("MultiplyProxyActions");
  const MPActions = await ethers.getContractFactory('MultiplyProxyActions', signer)
  const multiplyProxyActions = await MPActions.deploy()
  deployedContracts.multiplyProxyActionsInstance = await multiplyProxyActions.deployed()

  const incompleteRegistry = addressRegistryFactory(
    deployedContracts.multiplyProxyActionsInstance,
    undefined,
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

  if (isExchangeDummy == false) {
    deployedContracts.exchangeInstance = exchangeInstance
  } else {
    deployedContracts.exchangeInstance = dummyExchangeInstance
  }

  if (debug) {
    console.log('Signer address:', await signer.getAddress())
    console.log('Exchange address:', deployedContracts.exchangeInstance.address)
    console.log('User Proxy Address:', deployedContracts.userProxyAddress)
    console.log('DSProxy address:', deployedContracts.dsProxyInstance.address)
    console.log(
      'MultiplyProxyActions address:',
      deployedContracts.multiplyProxyActionsInstance.address,
    )
    console.log('MCDView address:', deployedContracts.mcdViewInstance.address)
  }

  return deployedContracts
}

const ONE = one

async function getOraclePrice(provider, pipAddress = MAINNET_ADRESSES.PIP_ETH) {
  const storageHexToBigNumber = (uint256) => {
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

const getLastCDP = async function (provider, signer, proxyAddress) {
  const getCdps = new ethers.Contract(MAINNET_ADRESSES.GET_CDPS, getCdpsAbi, provider).connect(
    signer,
  )
  const { ids, urns, ilks } = await getCdps.getCdpsAsc(MAINNET_ADRESSES.CDP_MANAGER, proxyAddress)
  const cdp = _.last(
    _.map(_.zip(ids, urns, ilks), (cdp) => ({
      id: cdp[0].toNumber(),
      urn: cdp[1],
      ilk: cdp[2],
    })),
  )
  if (_.isUndefined(cdp)) {
    throw new Error('No CDP available')
  }
  return cdp
}

const findMPAEvent = function (txResult) {
  let abi = [
    'event MultipleActionCalled(string methodName, uint indexed cdpId, uint swapMinAmount, uint swapOptimistAmount, uint collateralLeft, uint daiLeft)',
  ]
  let iface = new ethers.utils.Interface(abi)
  let events = txResult.events
    .filter((x) => {
      return x.topics[0] == iface.getEventTopic('MultipleActionCalled')
    })
    .map((x) => {
      let result = iface.decodeEventLog('MultipleActionCalled', x.data, x.topics)
      let retVal = {
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

module.exports = {
  getOrCreateProxy,
  deploySystem,
  dsproxyExecuteAction,
  getOraclePrice,
  getLastCDP,
  getVaultInfo,
  balanceOf,
  addressRegistryFactory,
  loadDummyExchangeFixtures,
  swapTokens,
  findMPAEvent,
  init,
  ONE,
  TEN,
  FEE,
  FEE_BASE,
  MAINNET_ADRESSES,
  CONTRACTS,
}
