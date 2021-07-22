const dsProxyRegistryAbi = require('../../abi/external/ds-proxy-registry.json')
const dsProxyAbi = require('../../abi/external/ds-proxy.json')
const WethAbi = require('../../abi/IWETH.json')
const Erc20Abi = require('../../abi/IERC20.json')
const { default: BigNumber } = require('bignumber.js')
const getCdpsAbi = require('../../abi/external/get-cdps.json')
const _ = require('lodash')
const {
  amountToWei,
  addressRegistryFactory,
  MAINNET_ADRESSES,
  ensureWeiFormat,
} = require('./params-calculation-utils')

const UniswapRouterV3Abi = require('../../abi/external/IUniswapRouter.json')

let CONTRACTS = {}

const { balanceOf, TEN, one } = require('../utils')
const { getVaultInfo } = require('../utils-mcd.js')

const FEE = 2
const FEE_BASE = 10000

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

    var tx = await dsProxy['execute(address,bytes)'](proxyActions.address, calldata, {
      from: fromAddress,
      value: ensureWeiFormat(value),
      gasLimit: 8500000,
      gasPrice: '1000000000',
    })

    var retVal = await tx.wait();
    console.log(`${method} completed`)

    return [true, retVal]
  } catch (ex) {
    console.log(`${method} failed`)
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

const addFundsDummyExchange = async function (
  provider,
  signer,
  WETH_ADDRESS,
  DAI_ADDRESS,
  exchange,
) {
  const UNISWAP_ROUTER_V3 = '0xe592427a0aece92de3edee1f18e0157c05861564'
  const uniswapV3 = new ethers.Contract(UNISWAP_ROUTER_V3, UniswapRouterV3Abi, provider).connect(
    signer,
  )
  const WETH = new ethers.Contract(WETH_ADDRESS, WethAbi, provider).connect(signer)
  const DAI = new ethers.Contract(DAI_ADDRESS, Erc20Abi, provider).connect(signer)

  let swapParams = {
    tokenIn: MAINNET_ADRESSES.ETH,
    tokenOut: MAINNET_ADRESSES.MCD_DAI,
    fee: 3000,
    recipient: await signer.getAddress(),
    deadline: 1751366148,
    amountIn: amountToWei(new BigNumber(200)).toFixed(0),
    amountOutMinimum: amountToWei(new BigNumber(300000)).toFixed(0),
    sqrtPriceLimitX96: 0,
  }
  await uniswapV3.exactInputSingle(swapParams, {
    value: amountToWei(new BigNumber(200)).toFixed(0),
  })
  var address = await signer.getAddress()
  await WETH.deposit({
    value: amountToWei(new BigNumber(1000)).toFixed(0),
  })
  await WETH.transfer(exchange.address, amountToWei(new BigNumber(500)).toFixed(0))
  var balance = await balanceOf(DAI.address,address)
  console.log(balance.toString())
  await DAI.transfer(exchange.address, new BigNumber(balance.toString()).dividedBy(2).toFixed(0))
  return {
    daiC: DAI,
    ethC: WETH,
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
  let exchange

  if (isExchangeDummy == false) {
    const Exchange = await ethers.getContractFactory('Exchange', signer)
    exchange = await Exchange.deploy(
      multiplyProxyActions.address,
      incompleteRegistry.feeRecepient,
      FEE,
    )
    deployedContracts.exchangeInstance = await exchange.deployed()

    const WETH = new ethers.Contract(MAINNET_ADRESSES.WETH_ADDRESS, WethAbi, provider).connect(
      signer)
    const DAI = new ethers.Contract(MAINNET_ADRESSES.MCD_DAI, Erc20Abi, provider).connect(signer)
    deployedContracts.gems.wethTokenInstance = WETH
    deployedContracts.daiTokenInstance = DAI
  } else {
    const Exchange = await ethers.getContractFactory('DummyExchange', signer)
    exchange = await Exchange.deploy()
    deployedContracts.exchangeInstance = await exchange.deployed()
    await exchange.setFee(FEE)
    //await exchange.setSlippage(800);//8%
    let { daiC, ethC } = await addFundsDummyExchange(
      provider,
      signer,
      MAINNET_ADRESSES.WETH_ADDRESS,
      MAINNET_ADRESSES.MCD_DAI,
      exchange,
    )
    deployedContracts.gems.wethTokenInstance = ethC
    deployedContracts.daiTokenInstance = daiC
  }

  // const mcdView = await deploy("McdView");
  const McdView = await ethers.getContractFactory('McdView', signer)
  const mcdView = await McdView.deploy()
  deployedContracts.mcdViewInstance = await mcdView.deployed()
  if (debug) {
    console.log('Signer:',await signer.getAddress());
    console.log('Exchange:', deployedContracts.exchangeInstance.address)
    console.log('userProxyAddress:', deployedContracts.userProxyAddress)
    console.log('dsProxy:', deployedContracts.dsProxyInstance.address)
    console.log('multiplyProxyActions:', deployedContracts.multiplyProxyActionsInstance.address)
    console.log('mcdView:', deployedContracts.mcdViewInstance.address)
    console.log('daiToken:', deployedContracts.daiTokenInstance.address)
    console.log('wethToken:', deployedContracts.gems.wethTokenInstance.address)
  }

  return deployedContracts
}

const ONE = one

async function getOraclePrice(provider) {
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
  const priceHex = await provider.getStorageAt(MAINNET_ADRESSES.PIP_ETH, slotCurrent)
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

module.exports = {
  getOrCreateProxy,
  deploySystem,
  dsproxyExecuteAction,
  getOraclePrice,
  getLastCDP,
  getVaultInfo,
  balanceOf,
  addressRegistryFactory,
  ONE,
  TEN,
  FEE,
  FEE_BASE,
  MAINNET_ADRESSES,
  CONTRACTS,
}
