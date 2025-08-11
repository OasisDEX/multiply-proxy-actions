import { BigNumber } from 'bignumber.js'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { JsonRpcProvider } from '@ethersproject/providers'
import { Signer } from 'ethers'
import ERC20ABI from '../abi/IERC20.json'
import MAINNET_ADDRESSES from '../addresses/mainnet.json'
import {
  deploySystem,
  getOraclePrice,
  dsproxyExecuteAction,
  getLastCDP,
  findMPAEvent,
  swapTokens,
  DeployedSystemInfo,
} from './common/utils/mcd-deployment.utils'
import {
  amountToWei,
  calculateParamsIncreaseMP,
  prepareMultiplyParameters,
} from './common/utils/params-calculation.utils'
import { balanceOf } from './utils'
import { getVaultInfo } from './common/utils/mcd.utils'
import { one } from './common/cosntants'
import { expectToBeEqual } from './common/utils/test.utils'

async function checkMPAPostState(tokenAddress: string, mpaAddress: string) {
  return {
    daiBalance: await balanceOf(MAINNET_ADDRESSES.MCD_DAI, mpaAddress),
    collateralBalance: await balanceOf(tokenAddress, mpaAddress),
  }
}

// TODO:
const guniDaiUsdc = '0xAbDDAfB225e10B90D798bB8A886238Fb835e2053'
const gUniResolver = '0x0317650Af6f184344D7368AC8bB0bEbA5EDB214a'

describe('GUNI Multiply Proxy Action Wrapper with Mocked Exchange', async () => {
  let provider: JsonRpcProvider
  let signer: Signer
  let address: string
  let system: DeployedSystemInfo
  let oazoFee: BigNumber
  let flashLoanFee: BigNumber
  let slippage: BigNumber
  let exchangeDataMock: any // TODO:

  let CDP_ID: number // this test suite operates on one Vault that is created in first test case

  const requiredCollRatio = new BigNumber(3)
  const currentColl = new BigNumber(100) // STARTING COLLATERAL AMOUNT
  const currentDebt = new BigNumber(0) // STARTING VAULT DEBT
  const marketPrice = new BigNumber(2380)
  let mpParams: any // TODO:
  let oraclePrice: BigNumber
  let guniAddressRegistry: Record<string, string> // TODO:

  before(async () => {
    provider = new ethers.providers.JsonRpcProvider()
    signer = provider.getSigner(0)
    const USDC = new ethers.Contract(MAINNET_ADDRESSES.USDC, ERC20ABI, provider).connect(signer)
    const DAI = new ethers.Contract(MAINNET_ADDRESSES.MCD_DAI, ERC20ABI, provider).connect(signer)
    address = await signer.getAddress()

    provider.send('hardhat_reset', [
      {
        forking: {
          jsonRpcUrl: process.env.ALCHEMY_NODE,
          blockNumber: parseInt(process.env.BLOCK_NUMBER!),
        },
      },
    ])

    system = await deploySystem(provider, signer, true)

    exchangeDataMock = {
      to: system.exchangeInstance.address,
      data: 0,
    }

    // TODO:
    oazoFee = new BigNumber(2).div(10000) // OAZO FEE;  divided by base (10000), 1 = 0.01%;
    flashLoanFee = new BigNumber(0.0009) // FLASHLOAN FEE
    slippage = new BigNumber(0.0001) // Percent

    await system.exchangeInstance.setFee(0)

    const receivedUSDC = amountToWei(200, 6)
    const receivedDAI = amountToWei(200)

    await swapTokens(
      MAINNET_ADDRESSES.ETH,
      MAINNET_ADDRESSES.USDC,
      amountToWei(100).toFixed(0),
      receivedUSDC.toFixed(0),
      address,
      provider,
      signer,
    )

    await swapTokens(
      MAINNET_ADDRESSES.ETH,
      MAINNET_ADDRESSES.MCD_DAI,
      amountToWei(100).toFixed(0),
      receivedDAI.toFixed(0),
      address,
      provider,
      signer,
    )

    const balanceDAI = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, address)
    const balanceUSDC = await balanceOf(MAINNET_ADDRESSES.USDC, address)

    await DAI.approve(system.userProxyAddress, balanceDAI.toFixed(0))

    await USDC.approve(system.userProxyAddress, balanceUSDC.toFixed(0))
    await USDC.transfer(system.exchangeInstance.address, balanceUSDC.toFixed(0))

    oraclePrice = new BigNumber(
      (await getOraclePrice(provider, MAINNET_ADDRESSES.PIP_GUNIV3DAIUSDC1)).toFixed(),
    )

    await system.exchangeInstance.setPrice(
      MAINNET_ADDRESSES.ETH,
      amountToWei(marketPrice).toFixed(0),
    )
    await system.exchangeInstance.setPrice(MAINNET_ADDRESSES.USDC, amountToWei(one).toFixed(0))

    guniAddressRegistry = {
      guni: '0xAbDDAfB225e10B90D798bB8A886238Fb835e2053',
      resolver: '0x0317650Af6f184344D7368AC8bB0bEbA5EDB214a',
      router: '0x14E6D67F824C3a7b4329d3228807f8654294e4bd',
      jug: '0x19c0976f590D67707E62397C87829d896Dc0f1F1',
      manager: '0x5ef30b9986345249bc32d8928B7ee64DE9435E39',
      lender: '0x60744434d6339a6B27d73d9Eda62b6F66a0a04FA',
      guniProxyActions: system.guni.address,
      otherToken: MAINNET_ADDRESSES.USDC,
      exchange: system.exchangeInstance.address,
    }
  })

  it('should open Guni multiplied vault with required collateralisation ratio', async () => {
    const [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
      oraclePrice,
      marketPrice,
      oazoFee,
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

    mpParams = prepareMultiplyParameters(
      exchangeDataMock,
      desiredCdpState,
      system.multiplyProxyActionsInstance.address,
      system.exchangeInstance.address,
      address,
      false,
    )
    const { exchangeData, cdpData } = mpParams
    // const divider = amountFromWei(mat[1].toString(), 27).minus(1)
    const daiBalance = new BigNumber(10000)
    const expectedCR = new BigNumber(1.05)
    const leveragedAmount = daiBalance.div(expectedCR.minus(one))
    const flashLoanAmount = leveragedAmount.minus(daiBalance)

    const usdcAmount = await system.guni.getOtherTokenAmount(
      guniDaiUsdc,
      gUniResolver,
      amountToWei(leveragedAmount).toFixed(0),
      6,
    )

    cdpData.gemJoin = '0xbFD445A97e7459b0eBb34cfbd3245750Dba4d7a4'
    cdpData.requiredDebt = amountToWei(flashLoanAmount).toFixed(0)
    cdpData.token0Amount = amountToWei(daiBalance).toFixed(0)

    exchangeData.fromTokenAmount = usdcAmount.toString() // amountToWei(daiBal).toFixed(0); // assuming 1 dai = 1 usdc . TO DO: change to DAI USDC swap with slippage
    exchangeData.fromTokenAddress = MAINNET_ADDRESSES.MCD_DAI
    exchangeData.minToTokenAmount = usdcAmount.toString()
    exchangeData.toTokenAddress = MAINNET_ADDRESSES.USDC

    const [status, result] = await dsproxyExecuteAction(
      system.guni,
      system.dsProxyInstance,
      address,
      'openMultiplyGuniVault',
      [exchangeData, cdpData, guniAddressRegistry],
    )

    expect(status).to.be.true

    const lastCDP = await getLastCDP(provider, signer, system.userProxyAddress)
    const info = await getVaultInfo(system.mcdViewInstance, lastCDP.id, lastCDP.ilk)

    CDP_ID = lastCDP.id

    const actionEvents = findMPAEvent(result)

    const currentCollRatio = new BigNumber(info.coll).times(oraclePrice).div(info.debt)
    await checkMPAPostState(MAINNET_ADDRESSES.ETH, system.multiplyProxyActionsInstance.address)

    // const requiredTotalCollateral = currentColl.plus(toBorrowCollateralAmount)
    // const resultTotalCollateral = new BigNumber(info.coll)

    expect(actionEvents[0].methodName).to.be.equal('openMultiplyGuniVault')
    expectToBeEqual(currentCollRatio.toFixed(2), 1.05)
  })

  it('should close exiting Guni vault and return Dai to user', async () => {
    const { exchangeData, cdpData } = mpParams
    cdpData.cdpId = CDP_ID
    cdpData.token0Amount = 0

    const params4 = [exchangeData, cdpData, guniAddressRegistry]

    const [status, result] = await dsproxyExecuteAction(
      system.guni,
      system.dsProxyInstance,
      address,
      'closeGuniVaultExitDai',
      params4,
      0,
    )
    expect(status).to.be.true

    const actionEvents = findMPAEvent(result)

    const lastCDP = await getLastCDP(provider, signer, system.userProxyAddress)
    const info = await getVaultInfo(system.mcdViewInstance, lastCDP.id, lastCDP.ilk as string) // TODO:

    const { daiBalance } = await checkMPAPostState(
      MAINNET_ADDRESSES.ETH,
      system.multiplyProxyActionsInstance.address,
    )
    const resultTotalCollateral = new BigNumber(info.coll)

    expect(actionEvents[0].methodName).to.be.equal('closeGuniVaultExitDai')
    expectToBeEqual(resultTotalCollateral.toFixed(0), 0)
    expectToBeEqual(daiBalance.toFixed(0), 0)
  })
})
