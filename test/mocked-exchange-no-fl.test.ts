import { expect } from 'chai'
import { ethers } from 'hardhat'
import BigNumber from 'bignumber.js'
import { Contract, Signer } from 'ethers'
import { JsonRpcProvider } from '@ethersproject/providers'
import MAINNET_ADDRESSES from '../addresses/mainnet.json'
import UniswapRouterV3Abi from '../abi/external/IUniswapRouter.json'
import wethAbi from '../abi/IWETH.json'
import erc20Abi from '../abi/IERC20.json'
import {
  amountToWei,
  calculateParamsIncreaseMP,
  calculateParamsDecreaseMP,
  prepareMultiplyParameters2,
} from './common/utils/params-calculation.utils'
import {
  deploySystem,
  getOraclePrice,
  dsproxyExecuteAction,
  getLastCDP,
  findMPAEvent,
  DeployedSystemInfo,
} from './common/utils/mcd-deployment.utils'
import { balanceOf } from './utils'
import { getVaultInfo } from './common/utils/mcd.utils'
import { expectToBe, expectToBeEqual } from './common/utils/test.utils'
import { one } from './common/cosntants'

async function addFundsDummyExchange(
  provider: JsonRpcProvider,
  signer: Signer,
  address: string,
  WETH: Contract,
  DAI: Contract,
  exchange: Contract,
) {
  const UNISWAP_ROUTER_V3 = '0xe592427a0aece92de3edee1f18e0157c05861564'
  const uniswapV3 = new ethers.Contract(UNISWAP_ROUTER_V3, UniswapRouterV3Abi, provider).connect(
    signer,
  )

  const swapParams = {
    tokenIn: MAINNET_ADDRESSES.ETH,
    tokenOut: MAINNET_ADDRESSES.MCD_DAI,
    fee: 3000,
    recipient: address,
    deadline: 1751366148,
    amountIn: amountToWei(200).toFixed(0),
    amountOutMinimum: amountToWei(400000).toFixed(0),
    sqrtPriceLimitX96: 0,
  }
  await uniswapV3.exactInputSingle(swapParams, {
    value: amountToWei(200).toFixed(0),
  })

  await WETH.deposit({
    value: amountToWei(1000).toFixed(0),
  })

  await WETH.transfer(exchange.address, amountToWei(500).toFixed(0))
  await DAI.transfer(exchange.address, amountToWei(400000).toFixed(0))
}

async function checkMPAPostState(tokenAddress: string, mpaAddress: string) {
  return {
    daiBalance: await balanceOf(MAINNET_ADDRESSES.MCD_DAI, mpaAddress),
    collateralBalance: await balanceOf(tokenAddress, mpaAddress),
  }
}

describe('Multiply Proxy Action with Mocked Exchange', async () => {
  const oazoFee = 2
  const oazoFeePct = new BigNumber(oazoFee).div(10000) // oasis fee
  const flashLoanFee = new BigNumber(0) // flashloan fee
  const slippage = new BigNumber(0.001) // percentage

  let provider: JsonRpcProvider
  let signer: Signer
  let address: string
  let system: DeployedSystemInfo
  let exchangeDataMock: { to: string; data: number } // TODO:
  let DAI: Contract
  let WETH: Contract

  let CDP_ID: any // TODO: // this test suite operates on one Vault that is created in first test case (opening Multiply Vault)
  let CDP_ILK: string

  before(async () => {
    provider = new ethers.providers.JsonRpcProvider()
    signer = provider.getSigner(0)
    address = await signer.getAddress()

    provider.send('hardhat_reset', [
      {
        forking: {
          jsonRpcUrl: process.env.ALCHEMY_NODE,
          blockNumber: 12763570,
        },
      },
    ])

    WETH = new ethers.Contract(MAINNET_ADDRESSES.ETH, wethAbi, provider).connect(signer)
    DAI = new ethers.Contract(MAINNET_ADDRESSES.MCD_DAI, erc20Abi, provider).connect(signer)

    system = await deploySystem(provider, signer, true)

    // Replace real Exchange contract with DummyExchange contract for testing purposes
    await addFundsDummyExchange(provider, signer, address, WETH, DAI, system.exchangeInstance)

    exchangeDataMock = {
      to: system.exchangeInstance.address,
      data: 0,
    }

    await system.exchangeInstance.setFee(oazoFee)
  })

  describe(`opening Multiply Vault`, async () => {
    const marketPrice = new BigNumber(2380)
    const currentColl = new BigNumber(100) // STARTING COLLATERAL AMOUNT
    const currentDebt = new BigNumber(0) // STARTING VAULT DEBT
    const requiredCollRatio = new BigNumber(8)
    let oraclePrice: BigNumber

    before(async () => {
      oraclePrice = await getOraclePrice(provider)
      await system.exchangeInstance.setPrice(
        MAINNET_ADDRESSES.ETH,
        amountToWei(marketPrice).toFixed(0),
      )
    })

    it(`should open vault with required collateralisation ratio`, async () => {
      const [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
        oraclePrice,
        marketPrice,
        oazoFeePct,
        flashLoanFee,
        currentColl,
        currentDebt,
        requiredCollRatio,
        slippage,
      )

      const desiredCdpState = {
        requiredDebt,
        toBorrowCollateralAmount,
        providedCollateral: currentColl,
        fromTokenAmount: requiredDebt,
        toTokenAmount: toBorrowCollateralAmount,
      }
      const params = prepareMultiplyParameters2(
        MAINNET_ADDRESSES.MCD_DAI,
        MAINNET_ADDRESSES.ETH,
        exchangeDataMock,
        '0',
        desiredCdpState,
        system.multiplyProxyActionsInstance.address,
        system.exchangeInstance.address,
        address,
        true,
      )
      const [status, result] = await dsproxyExecuteAction(
        system.multiplyProxyActionsInstance,
        system.dsProxyInstance,
        address,
        'openMultiplyVault',
        params,
        amountToWei(currentColl),
      )

      expect(status).to.be.true

      const lastCDP = await getLastCDP(provider, signer, system.userProxyAddress)
      const info = await getVaultInfo(system.mcdViewInstance, lastCDP.id, lastCDP.ilk)
      CDP_ID = lastCDP.id
      CDP_ILK = lastCDP.ilk as string
      const currentCollRatio = info.coll.times(oraclePrice).div(info.debt)

      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADDRESSES.ETH,
        system.multiplyProxyActionsInstance.address,
      )

      const requiredTotalCollateral = currentColl.plus(toBorrowCollateralAmount)
      const resultTotalCollateral = info.coll

      const actionEvents = findMPAEvent(result)

      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('openMultiplyVault')

      expectToBeEqual(daiBalance, 0)
      expectToBeEqual(collateralBalance.toFixed(0), 0)
      expectToBeEqual(currentCollRatio, requiredCollRatio, 2)
      expectToBe(resultTotalCollateral, 'gte', requiredTotalCollateral)
    })
  })

  describe(`Increasing Multiple`, async () => {
    const marketPrice = new BigNumber(2380)
    const requiredCollRatio = new BigNumber(7)
    let currentColl: BigNumber
    let currentDebt: BigNumber
    let oraclePrice: BigNumber

    before(async () => {
      oraclePrice = await getOraclePrice(provider)

      await system.exchangeInstance.setPrice(
        MAINNET_ADDRESSES.ETH,
        amountToWei(marketPrice).toFixed(0),
      )

      const info = await getVaultInfo(system.mcdViewInstance, CDP_ID, CDP_ILK)
      currentColl = new BigNumber(info.coll)
      currentDebt = new BigNumber(info.debt)
    })

    it(`should increase vault's multiple to required collateralization ratio`, async () => {
      const [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
        oraclePrice,
        marketPrice,
        oazoFeePct,
        flashLoanFee,
        currentColl,
        currentDebt,
        requiredCollRatio,
        slippage,
      )

      const desiredCdpState = {
        requiredDebt,
        toBorrowCollateralAmount,
        fromTokenAmount: requiredDebt,
        toTokenAmount: toBorrowCollateralAmount,
      }

      const params = prepareMultiplyParameters2(
        MAINNET_ADDRESSES.MCD_DAI,
        MAINNET_ADDRESSES.ETH,
        exchangeDataMock,
        CDP_ID,
        desiredCdpState,
        system.multiplyProxyActionsInstance.address,
        system.exchangeInstance.address,
        address,
        true,
      )

      ;(params[1] as any).skipFL = true // TODO:

      const [status, result] = await dsproxyExecuteAction(
        system.multiplyProxyActionsInstance,
        system.dsProxyInstance,
        address,
        'increaseMultiple',
        params,
      )
      expect(status).to.be.true

      const info = await getVaultInfo(system.mcdViewInstance, CDP_ID, CDP_ILK)
      const currentCollRatio = info.coll.times(oraclePrice).div(info.debt)
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADDRESSES.ETH,
        system.multiplyProxyActionsInstance.address,
      )

      const actionEvents = findMPAEvent(result)

      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('increaseMultiple')

      expectToBeEqual(daiBalance.toFixed(0), 0)
      expectToBeEqual(collateralBalance.toFixed(0), 0)
      expectToBeEqual(currentCollRatio, requiredCollRatio, 3)
    })
  })

  describe(`Increasing Multiple deposit Dai`, async () => {
    const marketPrice = new BigNumber(2380)
    const requiredCollRatio = new BigNumber(6)
    let oraclePrice: BigNumber
    let currentColl: BigNumber
    let currentDebt: BigNumber

    before(async () => {
      oraclePrice = await getOraclePrice(provider)
      await system.exchangeInstance.setPrice(
        MAINNET_ADDRESSES.ETH,
        amountToWei(marketPrice).toFixed(0),
      )

      const info = await getVaultInfo(system.mcdViewInstance, CDP_ID, CDP_ILK)
      currentColl = info.coll
      currentDebt = info.debt
    })

    it(`should increase vault's multiple to required collateralization ratio with additional Dai deposited`, async () => {
      const daiDeposit = new BigNumber(300)

      await DAI.approve(system.userProxyAddress, amountToWei(daiDeposit).toFixed(0))
      const [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
        oraclePrice,
        marketPrice,
        oazoFeePct,
        flashLoanFee,
        currentColl,
        currentDebt,
        requiredCollRatio,
        slippage,
        daiDeposit,
      )

      const desiredCdpState = {
        requiredDebt,
        toBorrowCollateralAmount,
        providedDai: daiDeposit,
        fromTokenAmount: requiredDebt,
        toTokenAmount: toBorrowCollateralAmount,
      }

      const params = prepareMultiplyParameters2(
        MAINNET_ADDRESSES.MCD_DAI,
        MAINNET_ADDRESSES.ETH,
        exchangeDataMock,
        CDP_ID,
        desiredCdpState,
        system.multiplyProxyActionsInstance.address,
        system.exchangeInstance.address,
        address,
        true,
      )
      ;(params[1] as any).skipFL = true // TODO:

      const [status, result] = await dsproxyExecuteAction(
        system.multiplyProxyActionsInstance,
        system.dsProxyInstance,
        address,
        'increaseMultipleDepositDai',
        params,
      )
      expect(status).to.be.true

      const info = await getVaultInfo(system.mcdViewInstance, CDP_ID, CDP_ILK)
      const currentCollRatio = info.coll.times(oraclePrice).div(info.debt)
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADDRESSES.ETH,
        system.multiplyProxyActionsInstance.address,
      )

      const actionEvents = findMPAEvent(result)

      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('increaseMultipleDepositDai')

      expectToBeEqual(daiBalance.toFixed(0), 0)
      expectToBeEqual(collateralBalance.toFixed(0), 0)
      expectToBeEqual(currentCollRatio, requiredCollRatio, 3)
    })
  })

  describe(`Increasing Multiple deposit collateral`, async () => {
    const marketPrice = new BigNumber(2380)
    const requiredCollRatio = new BigNumber(5)
    let oraclePrice: BigNumber
    let currentColl: BigNumber
    let currentDebt: BigNumber

    before(async () => {
      oraclePrice = await getOraclePrice(provider)

      await system.exchangeInstance.setPrice(
        MAINNET_ADDRESSES.ETH,
        amountToWei(marketPrice).toFixed(0),
      )

      const info = await getVaultInfo(system.mcdViewInstance, CDP_ID, CDP_ILK)
      currentColl = info.coll
      currentDebt = info.debt
    })

    it(`should increase vault's multiple to required collateralization ratio with additional collateral deposited`, async () => {
      const collateralDeposit = new BigNumber(5)

      const [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
        oraclePrice,
        marketPrice,
        oazoFeePct,
        flashLoanFee,
        currentColl.plus(collateralDeposit),
        currentDebt,
        requiredCollRatio,
        slippage,
      )

      const desiredCdpState = {
        requiredDebt,
        toBorrowCollateralAmount,
        providedCollateral: collateralDeposit,
        fromTokenAmount: requiredDebt,
        toTokenAmount: toBorrowCollateralAmount,
      }

      const params = prepareMultiplyParameters2(
        MAINNET_ADDRESSES.MCD_DAI,
        MAINNET_ADDRESSES.ETH,
        exchangeDataMock,
        CDP_ID,
        desiredCdpState,
        system.multiplyProxyActionsInstance.address,
        system.exchangeInstance.address,
        address,
        true,
      )
      ;(params[1] as any).skipFL = true // TODO:

      const [status, result] = await dsproxyExecuteAction(
        system.multiplyProxyActionsInstance,
        system.dsProxyInstance,
        address,
        'increaseMultipleDepositCollateral',
        params,
        amountToWei(collateralDeposit),
      )
      expect(status).to.be.true

      const info = await getVaultInfo(system.mcdViewInstance, CDP_ID, CDP_ILK)
      const currentCollRatio = info.coll.times(oraclePrice).div(info.debt)
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADDRESSES.ETH,
        system.multiplyProxyActionsInstance.address,
      )

      const actionEvents = findMPAEvent(result)

      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('increaseMultipleDepositCollateral')

      expectToBeEqual(daiBalance.toFixed(0), 0)
      expectToBeEqual(collateralBalance.toFixed(0), 0)
      expectToBeEqual(currentCollRatio, requiredCollRatio, 3)
    })
  })

  describe(`Decrease Multiple`, async () => {
    const marketPrice = new BigNumber(2380)
    const requiredCollRatio = new BigNumber(5.2)
    let oraclePrice: BigNumber
    let currentColl: BigNumber
    let currentDebt: BigNumber

    before(async () => {
      oraclePrice = await getOraclePrice(provider)

      await system.exchangeInstance.setPrice(
        MAINNET_ADDRESSES.ETH,
        amountToWei(marketPrice).toFixed(0),
      )

      const info = await getVaultInfo(system.mcdViewInstance, CDP_ID, CDP_ILK)
      currentColl = info.coll
      currentDebt = info.debt
    })

    it(`should decrease vault's multiple to required collateralization ratio`, async () => {
      const [requiredDebt, toBorrowCollateralAmount] = calculateParamsDecreaseMP(
        oraclePrice,
        marketPrice,
        oazoFeePct,
        flashLoanFee,
        currentColl,
        currentDebt,
        requiredCollRatio,
        slippage,
      )

      const desiredCdpState = {
        requiredDebt,
        toBorrowCollateralAmount,
        fromTokenAmount: toBorrowCollateralAmount,
        toTokenAmount: requiredDebt,
      }

      const params = prepareMultiplyParameters2(
        MAINNET_ADDRESSES.ETH,
        MAINNET_ADDRESSES.MCD_DAI,
        exchangeDataMock,
        CDP_ID,
        desiredCdpState,
        system.multiplyProxyActionsInstance.address,
        system.exchangeInstance.address,
        address,
        true,
      )

      ;(params[1] as any).skipFL = true // TODO:

      const [status, result] = await dsproxyExecuteAction(
        system.multiplyProxyActionsInstance,
        system.dsProxyInstance,
        address,
        'decreaseMultiple',
        params,
      )
      expect(status).to.be.true

      const info = await getVaultInfo(system.mcdViewInstance, CDP_ID, CDP_ILK)
      const currentCollRatio = info.coll.times(oraclePrice).div(info.debt)
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADDRESSES.ETH,
        system.multiplyProxyActionsInstance.address,
      )

      const actionEvents = findMPAEvent(result)
      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('decreaseMultiple')

      expectToBeEqual(daiBalance.toFixed(0), 0)
      expectToBeEqual(collateralBalance.toFixed(0), 0)
      expectToBeEqual(currentCollRatio, requiredCollRatio, 3)
    })
  })

  describe(`Decrease Multiple withdraw Dai`, async () => {
    const marketPrice = new BigNumber(2380)
    const requiredCollRatio = new BigNumber(6)
    let oraclePrice: BigNumber
    let currentColl: BigNumber
    let currentDebt: BigNumber

    before(async () => {
      oraclePrice = await getOraclePrice(provider)

      await system.exchangeInstance.setPrice(
        MAINNET_ADDRESSES.ETH,
        amountToWei(marketPrice).toFixed(0),
      )

      const info = await getVaultInfo(system.mcdViewInstance, CDP_ID, CDP_ILK)
      currentColl = info.coll
      currentDebt = info.debt
    })

    it(`should decrease vault's multiple to required collateralization ratio with additional Dai withdrawn`, async () => {
      const withdrawDai = new BigNumber(100)

      const [requiredDebt, toBorrowCollateralAmount] = calculateParamsDecreaseMP(
        oraclePrice,
        marketPrice,
        oazoFeePct,
        flashLoanFee,
        currentColl,
        currentDebt.plus(withdrawDai),
        requiredCollRatio,
        slippage,
      )

      const desiredCdpState = {
        withdrawDai,
        requiredDebt,
        toBorrowCollateralAmount,
        fromTokenAmount: toBorrowCollateralAmount,
        toTokenAmount: requiredDebt,
      }

      const params = prepareMultiplyParameters2(
        MAINNET_ADDRESSES.ETH,
        MAINNET_ADDRESSES.MCD_DAI,
        exchangeDataMock,
        CDP_ID,
        desiredCdpState,
        system.multiplyProxyActionsInstance.address,
        system.exchangeInstance.address,
        address,
        true,
      )

      ;(params[1] as any).skipFL = true

      const [status, result] = await dsproxyExecuteAction(
        system.multiplyProxyActionsInstance,
        system.dsProxyInstance,
        address,
        'decreaseMultipleWithdrawDai',
        params,
      )
      expect(status).to.be.true

      const info = await getVaultInfo(system.mcdViewInstance, CDP_ID, CDP_ILK)
      const currentCollRatio = info.coll.times(oraclePrice).div(info.debt)
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADDRESSES.ETH,
        system.multiplyProxyActionsInstance.address,
      )

      const actionEvents = findMPAEvent(result)

      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('decreaseMultipleWithdrawDai')

      expectToBeEqual(daiBalance.toFixed(0), 0)
      expectToBeEqual(collateralBalance.toFixed(0), 0)
      expectToBeEqual(currentCollRatio, requiredCollRatio, 2)
    })
  })

  describe(`Decrease Multiple withdraw collateral`, async () => {
    const marketPrice = new BigNumber(2380)
    const requiredCollRatio = new BigNumber(7)
    let oraclePrice: BigNumber
    let currentColl: BigNumber
    let currentDebt: BigNumber

    before(async () => {
      oraclePrice = await getOraclePrice(provider)

      await system.exchangeInstance.setPrice(
        MAINNET_ADDRESSES.ETH,
        amountToWei(marketPrice).toFixed(0),
      )

      const info = await getVaultInfo(system.mcdViewInstance, CDP_ID, CDP_ILK)
      currentColl = info.coll
      currentDebt = info.debt
    })

    it(`should decrease vault's multiple to required collateralization ratio with additional collateral withdrawn`, async () => {
      const withdrawCollateral = new BigNumber(1)

      const [requiredDebt, toBorrowCollateralAmount] = calculateParamsDecreaseMP(
        oraclePrice,
        marketPrice,
        oazoFeePct,
        flashLoanFee,
        currentColl.minus(withdrawCollateral),
        currentDebt,
        requiredCollRatio,
        slippage,
      )

      const desiredCdpState = {
        withdrawCollateral,
        requiredDebt,
        toBorrowCollateralAmount,
        fromTokenAmount: toBorrowCollateralAmount,
        toTokenAmount: requiredDebt,
      }

      const params = prepareMultiplyParameters2(
        MAINNET_ADDRESSES.ETH,
        MAINNET_ADDRESSES.MCD_DAI,
        exchangeDataMock,
        CDP_ID,
        desiredCdpState,
        system.multiplyProxyActionsInstance.address,
        system.exchangeInstance.address,
        address,
        true,
      )

      ;(params[1] as any).skipFL = true // TODO:

      const [status, result] = await dsproxyExecuteAction(
        system.multiplyProxyActionsInstance,
        system.dsProxyInstance,
        address,
        'decreaseMultipleWithdrawCollateral',
        params,
      )
      expect(status).to.be.true

      const info = await getVaultInfo(system.mcdViewInstance, CDP_ID, CDP_ILK)
      const currentCollRatio = info.coll.times(oraclePrice).div(info.debt)
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADDRESSES.ETH,
        system.multiplyProxyActionsInstance.address,
      )

      const actionEvents = findMPAEvent(result)

      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('decreaseMultipleWithdrawCollateral')

      expectToBeEqual(daiBalance.toFixed(0), 0)
      expectToBeEqual(collateralBalance.toFixed(0), 0)
      expectToBeEqual(currentCollRatio, requiredCollRatio, 2)
    })
  })

  describe(`Close vault and exit all collateral`, async () => {
    const marketPrice = new BigNumber(2380)
    let currentColl: BigNumber
    let currentDebt: BigNumber

    before(async () => {
      await system.exchangeInstance.setPrice(
        MAINNET_ADDRESSES.ETH,
        amountToWei(marketPrice).toFixed(0),
      )

      const info = await getVaultInfo(system.mcdViewInstance, CDP_ID, CDP_ILK)
      currentColl = info.coll
      currentDebt = info.debt
    })

    it(`should close vault and return  collateral`, async () => {
      await system.exchangeInstance.setPrice(
        MAINNET_ADDRESSES.ETH,
        amountToWei(marketPrice).toFixed(0),
      )

      const marketPriceSlippage = marketPrice.times(one.minus(slippage))
      const minToTokenAmount = currentDebt.times(one.plus(oazoFeePct).plus(flashLoanFee))
      const sellCollateralAmount = minToTokenAmount.div(marketPriceSlippage)

      const desiredCdpState = {
        requiredDebt: 0,
        toBorrowCollateralAmount: sellCollateralAmount,
        fromTokenAmount: sellCollateralAmount,
        toTokenAmount: minToTokenAmount,
        withdrawCollateral: currentColl
          .minus(sellCollateralAmount)
          .minus(0.00001) /* some ackward rounding errors */,
      }

      const params = prepareMultiplyParameters2(
        MAINNET_ADDRESSES.ETH,
        MAINNET_ADDRESSES.MCD_DAI,
        exchangeDataMock,
        CDP_ID,
        desiredCdpState,
        system.multiplyProxyActionsInstance.address,
        system.exchangeInstance.address,
        address,
        true,
      )

      ;(params[1] as any).skipFL = true

      const [status, result] = await dsproxyExecuteAction(
        system.multiplyProxyActionsInstance,
        system.dsProxyInstance,
        address,
        'closeVaultExitCollateral',
        params,
      )
      expect(status).to.be.true

      const info = await getVaultInfo(system.mcdViewInstance, CDP_ID, CDP_ILK)
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADDRESSES.ETH,
        system.multiplyProxyActionsInstance.address,
      )

      const actionEvents = findMPAEvent(result)

      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('closeVaultExitCollateral')

      expectToBeEqual(daiBalance.toFixed(0), 0)
      expectToBeEqual(collateralBalance, 0)
      expectToBeEqual(info.debt, 0)
      expectToBe(info.coll, 'lte', 0.00001)
    })
  })
})
