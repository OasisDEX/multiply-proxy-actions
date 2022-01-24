import { expect } from 'chai'
import { ethers } from 'hardhat'
import BigNumber from 'bignumber.js'
import { JsonRpcProvider } from '@ethersproject/providers'
import { Signer } from 'ethers'
import erc20Abi from '../abi/IERC20.json'
import MAINNET_ADDRESSES from '../addresses/mainnet.json'
import {
  init,
  deploySystem,
  getOraclePrice,
  dsproxyExecuteAction,
  getLastCDP,
  swapTokens,
  DeployedSystemInfo,
} from './common/utils/mcd-deployment.utils'
import {
  amountToWei,
  calculateParamsIncreaseMP,
  calculateParamsDecreaseMP,
  prepareMultiplyParameters2,
} from './common/utils/params-calculation.utils'

import { getVaultInfo } from './common/utils/mcd.utils'
import { expectToBeEqual } from './common/utils/test.utils'
import { one } from './common/cosntants'
import { CDPInfo } from './common/common.types'

describe(`Manage vault with a collateral with different than 18 precision`, async () => {
  const oazoFee = 2
  const oazoFeePct = new BigNumber(oazoFee).div(10000) //  divided by base (10000), 1 = 0.01%; oasis fee
  const slippage = new BigNumber(0.0001) // percentage
  const flashLoanFee = new BigNumber(0) // flashloan fee
  const initialCollRatio = new BigNumber(1.8)

  let provider: JsonRpcProvider
  let signer: Signer
  let address: string
  let system: DeployedSystemInfo
  let vault: CDPInfo
  let oraclePrice: BigNumber
  let marketPrice: BigNumber
  let exchangeStub: any // TODO:
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

    system = await deploySystem(provider, signer, true)

    const WBTC = new ethers.Contract(MAINNET_ADDRESSES.WBTC, erc20Abi, provider).connect(signer)
    await WBTC.transfer(system.exchangeInstance.address, received.toFixed(0))

    exchangeStub = {
      to: system.exchangeInstance.address,
      data: 0,
    }

    await system.exchangeInstance.setFee(oazoFee)

    oraclePrice = new BigNumber(
      (await getOraclePrice(provider, MAINNET_ADDRESSES.PIP_WBTC)).toString(),
    )
    marketPrice = oraclePrice

    await system.exchangeInstance.setPrecision(MAINNET_ADDRESSES.WBTC, 8)
    await system.exchangeInstance.setPrice(
      MAINNET_ADDRESSES.WBTC,
      amountToWei(marketPrice).toFixed(0),
    )

    const collAmount = new BigNumber(0.5)
    const debtAmount = new BigNumber(0)
    const [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
      oraclePrice,
      marketPrice,
      oazoFeePct,
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
      system.multiplyProxyActionsInstance.address,
      system.exchangeInstance.address,
      address,
      false,
      MAINNET_ADDRESSES.MCD_JOIN_WBTC_A,
      8,
    )

    await WBTC.approve(system.userProxyAddress, amountToWei(10, 8).toFixed(0))

    const [status] = await dsproxyExecuteAction(
      system.multiplyProxyActionsInstance,
      system.dsProxyInstance,
      address,
      'openMultiplyVault',
      params,
    )
    expect(status).to.be.true

    vault = await getLastCDP(provider, signer, system.userProxyAddress)

    snapshotId = await provider.send('evm_snapshot', [])
  })

  afterEach(async () => {
    await provider.send('evm_revert', [snapshotId])
  })

  it(`should open a vault`, async () => {
    const info = await getVaultInfo(system.mcdViewInstance, vault.id, vault.ilk)

    const currentCollRatio = info.coll.times(oraclePrice).div(info.debt)
    expectToBeEqual(currentCollRatio, initialCollRatio, 3)
  })

  it(`should increase vault's multiple`, async () => {
    const desiredCollRatio = initialCollRatio.minus(0.3)
    const info = await getVaultInfo(system.mcdViewInstance, vault.id, vault.ilk)

    const [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
      oraclePrice,
      marketPrice,
      oazoFeePct,
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
      vault.id.toString(),
      desiredCdpState,
      system.multiplyProxyActionsInstance.address,
      system.exchangeInstance.address,
      address,
      false,
      MAINNET_ADDRESSES.MCD_JOIN_WBTC_A,
      8,
    )

    const [status] = await dsproxyExecuteAction(
      system.multiplyProxyActionsInstance,
      system.dsProxyInstance,
      address,
      'increaseMultiple',
      params,
    )
    expect(status).to.be.true

    const currentVaultState = await getVaultInfo(system.mcdViewInstance, vault.id, vault.ilk)
    const currentCollRatio = currentVaultState.coll.times(oraclePrice).div(currentVaultState.debt)

    expectToBeEqual(currentCollRatio, desiredCollRatio, 3)
  })

  it(`should decrease vault's multiple`, async () => {
    const desiredCollRatio = initialCollRatio.plus(0.2)
    const info = await getVaultInfo(system.mcdViewInstance, vault.id, vault.ilk)

    const [requiredDebt, toBorrowCollateralAmount] = calculateParamsDecreaseMP(
      oraclePrice,
      marketPrice,
      oazoFeePct,
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
      vault.id.toString(),
      desiredCdpState,
      system.multiplyProxyActionsInstance.address,
      system.exchangeInstance.address,
      address,
      false,
      MAINNET_ADDRESSES.MCD_JOIN_WBTC_A,
      8,
      true,
    )

    await dsproxyExecuteAction(
      system.multiplyProxyActionsInstance,
      system.dsProxyInstance,
      address,
      'decreaseMultiple',
      params,
    )

    const currentVaultState = await getVaultInfo(system.mcdViewInstance, vault.id, vault.ilk)
    const currentCollRatio = currentVaultState.coll.times(oraclePrice).div(currentVaultState.debt)

    expectToBeEqual(currentCollRatio, desiredCollRatio, 3)
  })

  it('should close vault correctly to collateral', async () => {
    const info = await getVaultInfo(system.mcdViewInstance, vault.id, vault.ilk)

    const marketPriceSlippage = marketPrice.times(one.minus(slippage))
    const minToTokenAmount = info.debt.times(one.plus(oazoFeePct).plus(flashLoanFee))
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
      vault.id.toString(),
      desiredCdpState,
      system.multiplyProxyActionsInstance.address,
      system.exchangeInstance.address,
      address,
      false,
      MAINNET_ADDRESSES.MCD_JOIN_WBTC_A,
      8,
      true,
    )

    const [status] = await dsproxyExecuteAction(
      system.multiplyProxyActionsInstance,
      system.dsProxyInstance,
      address,
      'closeVaultExitCollateral',
      params,
    )

    expect(status).to.be.true
  })
})
