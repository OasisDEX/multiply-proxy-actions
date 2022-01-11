import { expect } from 'chai'
import BigNumber from 'bignumber.js'
import { ethers } from 'hardhat'
import { JsonRpcProvider } from '@ethersproject/providers'
import { Contract, Signer } from 'ethers'
import MAINNET_ADDRESSES from '../addresses/mainnet.json'
import {
  deploySystem,
  getOraclePrice,
  dsproxyExecuteAction,
  getLastCDP,
  findMPAEvent,
} from './common/mcd-deployment-utils'
import {
  amountToWei,
  calculateParamsIncreaseMP,
  calculateParamsDecreaseMP,
  prepareMultiplyParameters,
} from './common/params-calculation-utils'
import { balanceOf, one } from './utils'

import ERC20ABI from '../abi/IERC20.json'
import { getVaultInfo } from './utils/utils-mcd'
import { expectToBe, expectToBeEqual } from './_utils'

const LENDER_FEE = new BigNumber(0.0)

async function checkMPAPostState(tokenAddress: string, mpaAddress: string) {
  return {
    daiBalance: await balanceOf(MAINNET_ADDRESSES.MCD_DAI, mpaAddress),
    collateralBalance: await balanceOf(tokenAddress, mpaAddress),
  }
}

describe('Multiply Proxy Action with Mocked Exchange', async () => {
  const oasisFee = 2 // divided by base (10000), 1 = 0.01%;
  const oasisFeePct = new BigNumber(oasisFee).div(10000)
  const flashLoanFee = LENDER_FEE
  const slippage = new BigNumber(0.0001) // percentage

  let provider: JsonRpcProvider
  let signer: Signer
  let address: string
  let mcdView: Contract
  let exchange: Contract
  let multiplyProxyActions: Contract
  let dsProxy: Contract
  let userProxyAddress: string
  let exchangeDataMock: any // TODO:
  let DAI: Contract

  let CDP_ID: any // TODO: // this test suite operates on one Vault that is created in first test case (opening Multiply Vault)
  let CDP_ILK: string

  // beforeEach(async () => {}) // TODO:

  before(async () => {
    provider = new ethers.providers.JsonRpcProvider()
    signer = provider.getSigner(0)
    DAI = new ethers.Contract(MAINNET_ADDRESSES.MCD_DAI, ERC20ABI, provider).connect(signer)
    address = await signer.getAddress()

    provider.send('hardhat_reset', [
      {
        forking: {
          jsonRpcUrl: process.env.ALCHEMY_NODE,
          blockNumber: 13274574,
        },
      },
    ])

    const deployment = await deploySystem(provider, signer, true)

    dsProxy = deployment.dsProxyInstance
    multiplyProxyActions = deployment.multiplyProxyActionsInstance
    mcdView = deployment.mcdViewInstance
    userProxyAddress = deployment.userProxyAddress
    exchange = deployment.exchangeInstance

    exchangeDataMock = {
      to: exchange.address,
      data: 0,
    }

    // await exchange.setSlippage(0);
    // await exchange.setMode(0);

    await exchange.setFee(oasisFee)
  })

  describe(`opening Multiply Vault`, async () => {
    const marketPrice = new BigNumber(2380)
    const currentColl = new BigNumber(100) // STARTING COLLATERAL AMOUNT
    const currentDebt = new BigNumber(0) // STARTING VAULT DEBT
    let oraclePrice: BigNumber

    before(async () => {
      oraclePrice = await getOraclePrice(provider)

      await exchange.setPrice(MAINNET_ADDRESSES.ETH, amountToWei(marketPrice).toFixed(0))
    })

    it(`should open vault with required collateralisation ratio`, async () => {
      const requiredCollRatio = new BigNumber(3)

      const [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
        oraclePrice,
        marketPrice,
        oasisFeePct,
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

      const { params } = prepareMultiplyParameters(
        exchangeDataMock,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        false,
      )
      const [status, result] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'openMultiplyVault',
        params,
        amountToWei(currentColl),
      )

      expect(status).to.be.true

      const actionEvents = findMPAEvent(result)

      const lastCDP = await getLastCDP(provider, signer, userProxyAddress)
      const info = await getVaultInfo(mcdView, lastCDP.id, lastCDP.ilk)
      CDP_ID = lastCDP.id
      CDP_ILK = lastCDP.ilk
      const currentCollRatio = info.coll.times(oraclePrice).div(info.debt)
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADDRESSES.ETH,
        multiplyProxyActions.address,
      )

      const requiredTotalCollateral = currentColl.plus(toBorrowCollateralAmount)
      const resultTotalCollateral = info.coll

      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('openMultiplyVault')

      expectToBeEqual(daiBalance.toFixed(0), 0)
      expectToBeEqual(collateralBalance.toFixed(0), 0)
      expectToBeEqual(currentCollRatio, requiredCollRatio, 3)
      expectToBe(resultTotalCollateral, 'gte', requiredTotalCollateral)
    })

    it(`should fail opening new vault with collateralization below min. collRatio limit`, async () => {
      const requiredCollRatio = new BigNumber(1.4)

      const [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
        oraclePrice,
        marketPrice,
        oasisFeePct,
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
      const { params } = prepareMultiplyParameters(
        exchangeDataMock,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        false,
        0,
      )
      const [status] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'openMultiplyVault',
        params,
        amountToWei(currentColl),
      )

      expect(status).to.be.false
    })
  })

  describe(`Increasing Multiple`, async () => {
    const marketPrice = new BigNumber(2380)
    const requiredCollRatio = new BigNumber(2.6)
    let oraclePrice: BigNumber
    let currentColl: BigNumber
    let currentDebt: BigNumber

    beforeEach(async () => {
      oraclePrice = await getOraclePrice(provider)

      await exchange.setPrice(MAINNET_ADDRESSES.ETH, amountToWei(marketPrice).toFixed(0))

      const info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentColl = info.coll
      currentDebt = info.debt
    })

    it(`should increase vault's multiple to required collateralization ratio`, async () => {
      const [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
        oraclePrice,
        marketPrice,
        oasisFeePct,
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
        providedCollateral: 0,
      }

      const { params } = prepareMultiplyParameters(
        exchangeDataMock,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        false,
        CDP_ID,
      )

      const [status, result] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'increaseMultiple',
        params,
      )
      expect(status).to.be.true

      const info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      const currentCollRatio = info.coll.times(oraclePrice).div(info.debt)
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADDRESSES.ETH,
        multiplyProxyActions.address,
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
    const requiredCollRatio = new BigNumber(2.2)
    let oraclePrice: BigNumber
    let currentColl: BigNumber
    let currentDebt: BigNumber

    before(async () => {
      oraclePrice = await getOraclePrice(provider)

      await exchange.setPrice(MAINNET_ADDRESSES.ETH, amountToWei(marketPrice).toFixed(0))

      const info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentColl = info.coll
      currentDebt = info.debt
    })

    it(`should increase vault's multiple to required collateralization ratio with additional Dai deposited`, async () => {
      const daiDeposit = new BigNumber(300)
      await DAI.approve(userProxyAddress, amountToWei(daiDeposit).toFixed(0))

      const [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
        oraclePrice,
        marketPrice,
        oasisFeePct,
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
        providedCollateral: 0,
      }

      const { params } = prepareMultiplyParameters(
        exchangeDataMock,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        false,
        CDP_ID,
      )

      const [status, result] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'increaseMultipleDepositDai',
        params,
      )
      expect(status).to.be.true

      const info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      const currentCollRatio = info.coll.times(oraclePrice).div(info.debt)
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADDRESSES.ETH,
        multiplyProxyActions.address,
      )

      const actionEvents = findMPAEvent(result)

      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('increaseMultipleDepositDai')

      expectToBeEqual(daiBalance.toFixed(0), 0)
      expectToBeEqual(collateralBalance.toFixed(0), 0)
      expectToBe(currentCollRatio, 'gte', requiredCollRatio.times(0.999))
      expectToBe(currentCollRatio, 'lte', requiredCollRatio.times(1.001))
    })
  })

  describe(`Increasing Multiple deposit collateral`, async () => {
    const marketPrice = new BigNumber(2380)
    const requiredCollRatio = new BigNumber(1.9)
    let oraclePrice: BigNumber
    let currentColl: BigNumber
    let currentDebt: BigNumber

    before(async () => {
      oraclePrice = await getOraclePrice(provider)

      await exchange.setPrice(MAINNET_ADDRESSES.ETH, amountToWei(marketPrice).toFixed(0))

      const info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentColl = info.coll
      currentDebt = info.debt
    })

    it(`should increase vault's multiple to required collateralization ratio with additional collateral deposited`, async () => {
      const collateralDeposit = new BigNumber(5)
      const [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
        oraclePrice,
        marketPrice,
        oasisFeePct,
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

      const { params } = prepareMultiplyParameters(
        exchangeDataMock,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        false,
        CDP_ID,
      )

      const [status, result] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'increaseMultipleDepositCollateral',
        params,
        amountToWei(collateralDeposit),
      )
      expect(status).to.be.true

      const info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      const currentCollRatio = info.coll.times(oraclePrice).div(info.debt)
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADDRESSES.ETH,
        multiplyProxyActions.address,
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
    const requiredCollRatio = new BigNumber(2.8)
    let oraclePrice: BigNumber
    let currentColl: BigNumber
    let currentDebt: BigNumber

    beforeEach(async () => {
      oraclePrice = await getOraclePrice(provider)

      await exchange.setPrice(MAINNET_ADDRESSES.ETH, amountToWei(marketPrice).toFixed(0))

      const info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentColl = info.coll
      currentDebt = info.debt
    })

    it(`should decrease vault's multiple to required collateralization ratio`, async () => {
      const [requiredDebt, toBorrowCollateralAmount] = calculateParamsDecreaseMP(
        oraclePrice,
        marketPrice,
        oasisFeePct,
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
        providedCollateral: 0,
        toTokenAmount: requiredDebt,
      }

      const { params } = prepareMultiplyParameters(
        exchangeDataMock,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        true,
        CDP_ID,
      )

      const [status, result] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'decreaseMultiple',
        params,
      )
      expect(status).to.be.true

      const info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      const currentCollRatio = info.coll.times(oraclePrice).div(info.debt)
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADDRESSES.ETH,
        multiplyProxyActions.address,
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
    const requiredCollRatio = new BigNumber(3.2)
    let oraclePrice: BigNumber
    let currentColl: BigNumber
    let currentDebt: BigNumber

    before(async () => {
      oraclePrice = await getOraclePrice(provider)

      await exchange.setPrice(MAINNET_ADDRESSES.ETH, amountToWei(marketPrice).toFixed(0))

      const info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentColl = info.coll
      currentDebt = info.debt
    })

    it(`should decrease vault's multiple to required collateralization ratio with additional Dai withdrawn`, async () => {
      const withdrawDai = new BigNumber(200)

      const [requiredDebt, toBorrowCollateralAmount] = calculateParamsDecreaseMP(
        oraclePrice,
        marketPrice,
        oasisFeePct,
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
        providedCollateral: 0,
        toTokenAmount: requiredDebt,
      }

      const { params } = prepareMultiplyParameters(
        exchangeDataMock,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        true,
        CDP_ID,
      )

      const [status, result] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'decreaseMultipleWithdrawDai',
        params,
      )
      expect(status).to.be.true

      const info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      const currentCollRatio = info.coll.times(oraclePrice).div(info.debt)
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADDRESSES.ETH,
        multiplyProxyActions.address,
      )

      const actionEvents = findMPAEvent(result)
      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('decreaseMultipleWithdrawDai')
      expectToBeEqual(daiBalance.toFixed(0), 0)
      expectToBeEqual(collateralBalance.toFixed(0), 0)
      expect(currentCollRatio.toNumber()).to.be.greaterThanOrEqual(
        requiredCollRatio.times(0.998).toNumber(),
      )
      expect(currentCollRatio.toNumber()).to.be.lessThanOrEqual(
        requiredCollRatio.times(1.002).toNumber(),
      )
    })
  })

  describe(`Decrease Multiple withdraw collateral`, async () => {
    const marketPrice = new BigNumber(2380)
    const requiredCollRatio = new BigNumber(3.8)
    let oraclePrice: BigNumber
    let currentColl: BigNumber
    let currentDebt: BigNumber

    before(async () => {
      oraclePrice = await getOraclePrice(provider)

      await exchange.setPrice(MAINNET_ADDRESSES.ETH, amountToWei(marketPrice).toFixed(0))

      const info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentColl = info.coll
      currentDebt = info.debt
    })

    it(`should decrease vault's multiple to required collateralization ratio with additional collateral withdrawn`, async () => {
      const withdrawCollateral = new BigNumber(8)

      // const info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK) // TODO:
      const [requiredDebt, toBorrowCollateralAmount] = calculateParamsDecreaseMP(
        oraclePrice,
        marketPrice,
        oasisFeePct,
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
        providedCollateral: 0,
        toTokenAmount: requiredDebt,
      }

      const { params } = prepareMultiplyParameters(
        exchangeDataMock,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        true,
        CDP_ID,
      )

      const [status, result] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'decreaseMultipleWithdrawCollateral',
        params,
      )
      expect(status).to.be.true

      const info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)

      const currentCollRatio = info.coll.times(oraclePrice).div(info.debt)
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADDRESSES.ETH,
        multiplyProxyActions.address,
      )

      const actionEvents = findMPAEvent(result)

      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('decreaseMultipleWithdrawCollateral')

      expectToBeEqual(daiBalance.toFixed(0), 0)
      expectToBeEqual(collateralBalance.toFixed(0), 0)
      expectToBeEqual(currentCollRatio, requiredCollRatio, 3)
    })
  })

  // To use this test comment out 'Close vault and exit all collateral' as there cannot be two closing actions together

  // describe(`Close vault and exit all Dai`, async function () {
  //   const marketPrice = new BigNumber(2380)
  //   // let oraclePrice: BigNumber
  //   let currentColl: BigNumber
  //   let currentDebt: BigNumber

  //   before(async () => {
  //     // oraclePrice = await getOraclePrice(provider)

  //     await exchange.setPrice(MAINNET_ADDRESSES.ETH, amountToWei(marketPrice).toFixed(0))

  //     const info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
  //     currentColl = info.coll
  //     currentDebt = info.debt
  //   })

  //   it(`should close vault and return Dai`, async function () {
  //     const minToTokenAmount = currentDebt.times(one.plus(oasisFee).plus(flashLoanFee))

  //     const desiredCdpState = {
  //       requiredDebt: 0,
  //       toBorrowCollateralAmount: 0,
  //       fromTokenAmount: amountToWei(currentColl).toFixed(0),
  //       toTokenAmount: minToTokenAmount,
  //     }

  //     const params = prepareMultiplyParameters(
  //       MAINNET_ADDRESSES.ETH,
  //       MAINNET_ADDRESSES.MCD_DAI,
  //       exchangeDataMock,
  //       CDP_ID,
  //       desiredCdpState,
  //       multiplyProxyActions.address,
  //       exchange.address,
  //       address,
  //     )

  //     await dsproxyExecuteAction(
  //       multiplyProxyActions,
  //       dsProxy,
  //       address,
  //       'closeVaultExitDai',
  //       params,
  //     )

  //     const info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
  //     const { daiBalance, collateralBalance } = await checkMPAPostState(
  //       MAINNET_ADDRESSES.ETH,
  //       multiplyProxyActions.address,
  //     )

  //     expectToBeEqual(daiBalance.toFixed(0), 0)
  //     expectToBeEqual(collateralBalance.toFixed(0), 0)
  //     expectToBeEqual(info.debt, 0)
  //     expectToBeEqual(info.coll, 0)
  //   })
  // })

  describe(`Close vault and exit all collateral`, async () => {
    const marketPrice = new BigNumber(2380)
    let currentDebt: BigNumber

    before(async () => {
      await exchange.setPrice(MAINNET_ADDRESSES.ETH, amountToWei(marketPrice).toFixed(0))

      const info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentDebt = info.debt
    })

    it(`should close vault and leave the remaining collateral`, async () => {
      await exchange.setPrice(MAINNET_ADDRESSES.ETH, amountToWei(marketPrice).toFixed(0))

      const marketPriceSlippage = marketPrice.times(one.minus(slippage))
      const minToTokenAmount = currentDebt.times(one.plus(oasisFeePct).plus(flashLoanFee))
      const sellCollateralAmount = minToTokenAmount.div(marketPriceSlippage)

      const desiredCdpState = {
        requiredDebt: 0,
        toBorrowCollateralAmount: sellCollateralAmount,
        providedCollateral: 0,
        minToTokenAmount: minToTokenAmount,
      }

      const { params } = prepareMultiplyParameters(
        exchangeDataMock,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        true,
        CDP_ID,
      )

      const info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      const expectedVaultCollateral = info.coll.minus(sellCollateralAmount)

      await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'closeVaultExitCollateral',
        params,
      )

      const infoAfter = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADDRESSES.ETH,
        multiplyProxyActions.address,
      )

      expectToBeEqual(daiBalance.toFixed(0), 0) // dai left in MPA
      expectToBeEqual(collateralBalance.toFixed(0), 0) // collateral left in MPA
      expectToBeEqual(infoAfter.debt, 0) // debt left in Vault
      expectToBeEqual(infoAfter.coll, expectedVaultCollateral, 10) // collateral left in Vault
    })
  })
})
