import { expect } from 'chai'
import { ethers } from 'hardhat'
import BigNumber from 'bignumber.js'
import { JsonRpcProvider } from '@ethersproject/providers'
import { Contract, Signer } from 'ethers'
import erc20Abi from '../abi/IERC20.json'
import MAINNET_ADDRESSES from '../addresses/mainnet.json'
import {
  init,
  deploySystem,
  getOraclePrice,
  dsproxyExecuteAction,
  getLastCDP,
  swapTokens,
} from './common/mcd-deployment-utils'
import {
  amountToWei,
  calculateParamsIncreaseMP,
  calculateParamsDecreaseMP,
  prepareMultiplyParameters2,
} from './common/params-calculation-utils'

import { getVaultInfo } from './utils/utils-mcd'
import { expectToBeEqual } from './_utils'

describe(`Manage vault with a collateral with different than 18 precision`, async () => {
  const oasisFee = 2
  const oasisFeePct = new BigNumber(oasisFee).div(10000) //  divided by base (10000), 1 = 0.01%; oasis fee
  const slippage = new BigNumber(0.0001) // percentage
  const flashLoanFee = new BigNumber(0) // flashloan fee
  const initialCollRatio = new BigNumber(1.8)

  let provider: JsonRpcProvider
  let signer: Signer
  let address: string
  let vault: any // TODO:
  let oraclePrice: BigNumber
  let marketPrice: BigNumber
  let exchange: Contract
  let exchangeStub: any // TODO:
  let mcdView: Contract
  let multiplyProxyActions: Contract
  let dsProxy: Contract
  let userProxyAddress: string
  let snapshotId: string

  before(async () => {
    ;[provider, signer] = await init({ blockNumber: process.env.BLOCK_NUMBER })
    address = await signer.getAddress()

    const received = amountToWei(2, 8)

    await swapTokens(
      MAINNET_ADDRESSES.ETH,
      MAINNET_ADDRESSES.WBTC,
      amountToWei(400).toFixed(0),
      received.toFixed(0),
      address,
      provider,
      signer,
    )

    const deployment = await deploySystem(provider, signer, true)

    dsProxy = deployment.dsProxyInstance
    multiplyProxyActions = deployment.multiplyProxyActionsInstance
    mcdView = deployment.mcdViewInstance
    userProxyAddress = deployment.userProxyAddress
    exchange = deployment.exchangeInstance

    const WBTC = new ethers.Contract(MAINNET_ADDRESSES.WBTC, erc20Abi, provider).connect(signer)
    await WBTC.transfer(exchange.address, received.toFixed(0))

    exchangeStub = {
      to: exchange.address,
      data: 0,
    }

    await exchange.setFee(oasisFee)

    oraclePrice = new BigNumber(
      (await getOraclePrice(provider, MAINNET_ADDRESSES.PIP_WBTC)).toString(),
    )
    marketPrice = oraclePrice

    await exchange.setPrecision(MAINNET_ADDRESSES.WBTC, 8)
    await exchange.setPrice(MAINNET_ADDRESSES.WBTC, amountToWei(marketPrice).toFixed(0))

    const collAmount = new BigNumber(0.5)
    const debtAmount = new BigNumber(0)
    const [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
      oraclePrice,
      marketPrice,
      oasisFeePct,
      flashLoanFee,
      collAmount,
      debtAmount,
      initialCollRatio,
      slippage,
    )

    const desiredCdpState = {
      requiredDebt,
      toBorrowCollateralAmount,
      providedCollateral: collAmount,
      fromTokenAmount: requiredDebt,
      toTokenAmount: toBorrowCollateralAmount,
    }

    const params = prepareMultiplyParameters2(
      MAINNET_ADDRESSES.MCD_DAI,
      MAINNET_ADDRESSES.WBTC,
      exchangeStub,
      '0',
      desiredCdpState,
      multiplyProxyActions.address,
      exchange.address,
      address,
      false,
      MAINNET_ADDRESSES.MCD_JOIN_WBTC_A,
      8,
    )

    await WBTC.approve(userProxyAddress, amountToWei(10, 8).toFixed(0))

    const [status] = await dsproxyExecuteAction(
      multiplyProxyActions,
      dsProxy,
      address,
      'openMultiplyVault',
      params,
    )

    expect(status).to.be.true

    vault = await getLastCDP(provider, signer, userProxyAddress)

    snapshotId = await provider.send('evm_snapshot', [])
  })

  afterEach(async () => {
    await provider.send('evm_revert', [snapshotId])
  })

  it(`should open a vault`, async () => {
    const info = await getVaultInfo(mcdView, vault.id, vault.ilk)

    const currentCollRatio = info.coll.times(oraclePrice).div(info.debt)
    expectToBeEqual(currentCollRatio, initialCollRatio, 3)
  })

  it(`should increase vault's multiple`, async () => {
    const desiredCollRatio = initialCollRatio.minus(0.3)
    const info = await getVaultInfo(mcdView, vault.id, vault.ilk)

    const [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
      oraclePrice,
      marketPrice,
      oasisFeePct,
      flashLoanFee,
      info.coll,
      info.debt,
      desiredCollRatio,
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
      MAINNET_ADDRESSES.WBTC,
      exchangeStub,
      vault.id,
      desiredCdpState,
      multiplyProxyActions.address,
      exchange.address,
      address,
      false,
      MAINNET_ADDRESSES.MCD_JOIN_WBTC_A,
      8,
    )

    const [status] = await dsproxyExecuteAction(
      multiplyProxyActions,
      dsProxy,
      address,
      'increaseMultiple',
      params,
    )
    expect(status).to.be.true

    const currentVaultState = await getVaultInfo(mcdView, vault.id, vault.ilk)
    const currentCollRatio = currentVaultState.coll.times(oraclePrice).div(currentVaultState.debt)

    expectToBeEqual(currentCollRatio, desiredCollRatio, 3)
  })

  it(`should decrease vault's multiple`, async () => {
    const desiredCollRatio = initialCollRatio.plus(0.2)
    const info = await getVaultInfo(mcdView, vault.id, vault.ilk)

    const [requiredDebt, toBorrowCollateralAmount] = calculateParamsDecreaseMP(
      oraclePrice,
      marketPrice,
      oasisFeePct,
      flashLoanFee,
      info.coll,
      info.debt,
      desiredCollRatio,
      slippage,
    )

    const desiredCdpState = {
      requiredDebt,
      toBorrowCollateralAmount,
      fromTokenAmount: toBorrowCollateralAmount,
      toTokenAmount: requiredDebt,
    }

    const params = prepareMultiplyParameters2(
      MAINNET_ADDRESSES.WBTC,
      MAINNET_ADDRESSES.MCD_DAI,
      exchangeStub,
      vault.id,
      desiredCdpState,
      multiplyProxyActions.address,
      exchange.address,
      address,
      false,
      MAINNET_ADDRESSES.MCD_JOIN_WBTC_A,
      8,
      true,
    )

    await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'decreaseMultiple', params)

    const currentVaultState = await getVaultInfo(mcdView, vault.id, vault.ilk)
    const currentCollRatio = currentVaultState.coll.times(oraclePrice).div(currentVaultState.debt)

    expectToBeEqual(currentCollRatio, desiredCollRatio, 3)
  })

  it('should close vault correctly to collateral', async () => {
    const info = await getVaultInfo(mcdView, vault.id, vault.ilk)

    const marketPriceSlippage = marketPrice.times(new BigNumber(1).minus(slippage))
    const minToTokenAmount = info.debt.times(new BigNumber(1).plus(oasisFeePct).plus(flashLoanFee))
    const sellCollateralAmount = minToTokenAmount.div(marketPriceSlippage)

    const desiredCdpState = {
      requiredDebt: 0,
      toBorrowCollateralAmount: sellCollateralAmount,
      fromTokenAmount: sellCollateralAmount,
      toTokenAmount: minToTokenAmount,
      providedCollateral: 0,
      minToTokenAmount: minToTokenAmount,
    }

    const params = prepareMultiplyParameters2(
      MAINNET_ADDRESSES.WBTC,
      MAINNET_ADDRESSES.MCD_DAI,
      exchangeStub,
      vault.id,
      desiredCdpState,
      multiplyProxyActions.address,
      exchange.address,
      address,
      false,
      MAINNET_ADDRESSES.MCD_JOIN_WBTC_A,
      8,
      true,
    )

    const [status] = await dsproxyExecuteAction(
      multiplyProxyActions,
      dsProxy,
      address,
      'closeVaultExitCollateral',
      params,
    )

    expect(status).to.be.true
  })
})
