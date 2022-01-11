import BigNumber from 'bignumber.js'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { JsonRpcProvider } from '@ethersproject/providers'
import MAINNET_ADDRESSES from '../addresses/mainnet.json'
import {
  deploySystem,
  getOraclePrice,
  dsproxyExecuteAction,
  getLastCDP,
  FEE_BASE,
} from './common/mcd-deployment-utils'
import {
  calculateParamsIncreaseMP,
  amountToWei,
  prepareMultiplyParameters,
  addressRegistryFactory,
} from './common/params-calculation-utils'
import { getMarketPrice, exchangeFromDAI } from './common/http-apis'
import { Contract, ContractReceipt, Signer } from 'ethers'
import { balanceOf, WETH_ADDRESS } from './utils'
import { getVaultInfo } from './utils/utils-mcd'
import { expectToBe, expectToBeEqual } from './_utils'
import { CDPInfo, OneInchSwapResponse, VaultInfo } from './common/common.types'

interface FlattenedEvent {
  firstTopic: string
  topics: string[]
  data: string
  name?: string
}

interface TestCase {
  slippage: BigNumber
  desiredCollRatio: BigNumber.Value
  currentDebt: BigNumber.Value
  desiredCDPState: {
    currentColl: BigNumber.Value
    providedCollateral: BigNumber.Value
    requiredDebt?: BigNumber
    toBorrowCollateralAmount?: BigNumber
  }
  toBorrowCollateralAmount?: BigNumber
  oneInchPayload?: OneInchSwapResponse['tx']
}

function lookupEventByHash(events: FlattenedEvent[], eventHash: string) {
  return events.filter(x => x.firstTopic === eventHash)
}

describe('Proxy Action', async () => {
  const baseCollateralAmountInETH = new BigNumber(10)
  const LENDER_FEE = new BigNumber(0)
  const BASE_SLIPPAGE = new BigNumber(0.08)
  const OASIS_FEE = new BigNumber(0.0003) // TODO: fetch it from exchange once implemented

  let provider: JsonRpcProvider
  let primarySigner: Signer
  let primarySignerAddress: string
  let mcdViewInstance: Contract
  let exchangeInstance: Contract
  let multiplyProxyActionsInstance: Contract
  let dsProxyInstance: Contract
  let userProxyAddress: string
  let ADDRESS_REGISTRY: Record<string, string> // TODO:
  let initialSetupSnapshotId: string

  let oraclePrice: BigNumber
  let marketPrice: BigNumber

  const testCases: TestCase[] = [
    {
      desiredCollRatio: 3,
      currentDebt: 0,
      slippage: BASE_SLIPPAGE,
      oneInchPayload: undefined,
      desiredCDPState: {
        currentColl: 0,
        providedCollateral: baseCollateralAmountInETH,
      },
    },
    {
      desiredCollRatio: 1.7,
      currentDebt: 0,
      slippage: BASE_SLIPPAGE,
      oneInchPayload: undefined,
      desiredCDPState: {
        currentColl: 0,
        providedCollateral: baseCollateralAmountInETH,
      },
    },
  ]

  before(async () => {
    provider = new ethers.providers.JsonRpcProvider()

    provider.send('hardhat_reset', [
      {
        forking: {
          jsonRpcUrl: process.env.ALCHEMY_NODE,
          blockNumber: 13274574,
        },
      },
    ])

    primarySigner = provider.getSigner(0)
    primarySignerAddress = await primarySigner.getAddress()

    const deployedContracts = await deploySystem(provider, primarySigner, true)
    mcdViewInstance = deployedContracts.mcdViewInstance
    exchangeInstance = deployedContracts.exchangeInstance
    multiplyProxyActionsInstance = deployedContracts.multiplyProxyActionsInstance
    dsProxyInstance = deployedContracts.dsProxyInstance
    userProxyAddress = deployedContracts.userProxyAddress
    oraclePrice = await getOraclePrice(provider)
    marketPrice = await getMarketPrice(WETH_ADDRESS, MAINNET_ADDRESSES.MCD_DAI)
    ADDRESS_REGISTRY = addressRegistryFactory(
      multiplyProxyActionsInstance.address,
      exchangeInstance.address,
    )

    ADDRESS_REGISTRY.feeRecepient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
    exchangeInstance.setPrice(MAINNET_ADDRESSES.ETH, amountToWei(marketPrice).toFixed(0))
    // the fee is set to 0.0003 and the base is 10000. Doing normal multiplication results in 2.999999999996
    exchangeInstance.setFee(OASIS_FEE.times(FEE_BASE).toFixed(0))

    // TODO:
    async function checkOneInch(data: TestCase) {
      const [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
        oraclePrice,
        marketPrice,
        OASIS_FEE,
        LENDER_FEE,
        baseCollateralAmountInETH,
        new BigNumber(data.currentDebt),
        new BigNumber(data.desiredCollRatio),
        data.slippage,
      )

      const payload = await exchangeFromDAI(
        WETH_ADDRESS,
        amountToWei(requiredDebt.times(new BigNumber(1).minus(OASIS_FEE))).toFixed(0),
        data.slippage.times(100).toFixed(),
        exchangeInstance.address,
      )
      data.oneInchPayload = payload.tx
      data.toBorrowCollateralAmount = toBorrowCollateralAmount
      data.desiredCDPState.requiredDebt = requiredDebt
      data.desiredCDPState.toBorrowCollateralAmount = toBorrowCollateralAmount
    }

    await Promise.all(testCases.map(x => checkOneInch(x)))
    initialSetupSnapshotId = await provider.send('evm_snapshot', [])
  })

  describe(`opening Multiply Vault with collateralisation ratio of ${testCases[1].desiredCollRatio}`, async () => {
    let result: ContractReceipt
    let vaultInfo: VaultInfo
    let startBalance: BigNumber
    let lastCDP: CDPInfo

    after(async () => {
      await provider.send('evm_revert', [initialSetupSnapshotId])
      const reVertedBlock = await provider.getBlockNumber()
      console.log('snapshot restored', initialSetupSnapshotId, reVertedBlock)
    })

    before(async () => {
      startBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, ADDRESS_REGISTRY.feeRecepient)
      const { params } = prepareMultiplyParameters(
        testCases[1].oneInchPayload,
        testCases[1].desiredCDPState,
        multiplyProxyActionsInstance.address,
        exchangeInstance.address,
        primarySignerAddress,
        false,
        0,
      )

      const [status, txResult] = await dsproxyExecuteAction(
        multiplyProxyActionsInstance,
        dsProxyInstance,
        primarySignerAddress,
        'openMultiplyVault',
        params,
        amountToWei(baseCollateralAmountInETH),
      )
      expect(status).to.be.true

      result = txResult

      lastCDP = await getLastCDP(provider, primarySigner, userProxyAddress)
      vaultInfo = await getVaultInfo(mcdViewInstance, lastCDP.id, lastCDP.ilk)
    })

    it(`it should open vault with collateralisation Ratio of ${testCases[1].desiredCollRatio}`, async () => {
      const actualRatio = vaultInfo.coll.times(oraclePrice).div(vaultInfo.debt)
      const maxAcceptable = new BigNumber(testCases[1].desiredCollRatio).times(1.05)

      expectToBe(actualRatio, 'gte', testCases[1].desiredCollRatio) // final collaterallisation value equal to at least desired
      expectToBe(actualRatio, 'lte', maxAcceptable) // final collaterallisation is off not more than 5% from desired value
    })

    it(`it should flash loan correct amount of DAI`, async () => {
      const allEvents = result.events!.map(x => ({
        firstTopic: x.topics[0],
        topics: x.topics,
        data: x.data,
        name: x.event,
      }))

      const abi = ['event FLData(uint256 borrowed, uint256 due)']
      const iface = new ethers.utils.Interface(abi)

      const flDataEvent = iface.parseLog(
        lookupEventByHash(
          allEvents,
          '0x9c6641b21946115d10f3f55df9bec5752ec06d40dc9250b1cc6560549764600e',
        )[0],
      )
      const expected = amountToWei(vaultInfo.debt)
      const actual = amountToWei(
        new BigNumber(flDataEvent.args.due.toString()).dividedBy(new BigNumber(10).pow(18)),
      )

      expectToBe(actual, 'gt', expected.times(0.98))
      expectToBe(expected, 'gt', actual.times(0.98))
    })

    it('it should send fee to beneficiary', async () => {
      const allEvents = result.events!.map(x => {
        return {
          firstTopic: x.topics[0],
          topics: x.topics,
          data: x.data,
          name: x.event,
        }
      })
      const feePaidEvents = lookupEventByHash(
        allEvents,
        '0x075a2720282fdf622141dae0b048ef90a21a7e57c134c76912d19d006b3b3f6f',
      )

      expect(feePaidEvents.length).to.be.deep.equal(1)
      const feeAmount = new BigNumber(feePaidEvents[0].data, 16)
      const expected = amountToWei(
        OASIS_FEE.times((testCases[1].desiredCDPState as any).requiredDebt), // TODO:
      )

      const endBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, ADDRESS_REGISTRY.feeRecepient)
      const balanceDifference = endBalance.minus(startBalance)

      expectToBe(feeAmount, 'gte', expected)
      expectToBeEqual(feeAmount.toFixed(0), balanceDifference)
    })
  })

  describe(`opening Multiply Vault with collateralisation ratio of ${testCases[0].desiredCollRatio}`, async () => {
    let result: ContractReceipt
    let lastCDP: CDPInfo
    let vaultInfo: VaultInfo
    let startBalance: BigNumber

    after(async () => {
      await provider.send('evm_revert', [initialSetupSnapshotId])
      const reVertedBlock = await provider.getBlockNumber()
      console.log('snapshot restored', initialSetupSnapshotId, reVertedBlock)
    })

    before(async () => {
      startBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, ADDRESS_REGISTRY.feeRecepient)
      const { params } = prepareMultiplyParameters(
        testCases[0].oneInchPayload,
        testCases[0].desiredCDPState,
        multiplyProxyActionsInstance.address,
        exchangeInstance.address,
        await primarySigner.getAddress(),
        false,
        0,
      )
      const [status, txResult] = await dsproxyExecuteAction(
        multiplyProxyActionsInstance,
        dsProxyInstance,
        await primarySigner.getAddress(),
        'openMultiplyVault',
        params,
        amountToWei(baseCollateralAmountInETH),
      )
      expect(status).to.be.true
      result = txResult

      lastCDP = await getLastCDP(provider, primarySigner, userProxyAddress)
      vaultInfo = await getVaultInfo(mcdViewInstance, lastCDP.id, lastCDP.ilk)
    })

    it(`it should open vault with collateralisation Ratio of ${testCases[0].desiredCollRatio}`, async () => {
      const actualRatio = vaultInfo.coll.times(oraclePrice).div(vaultInfo.debt)
      const maxAcceptable = new BigNumber(testCases[0].desiredCollRatio).times(1.05)

      expectToBe(actualRatio, 'gte', testCases[0].desiredCollRatio) // final collaterallisation value equal to at least desired
      expectToBe(actualRatio, 'lte', maxAcceptable) // final collaterallisation is off not more than 5% from desired value
    })

    it(`it should flash loan correct amount of DAI`, async () => {
      const allEvents = result.events!.map(x => ({
        firstTopic: x.topics[0],
        topics: x.topics,
        data: x.data,
        name: x.event,
      }))
      const abi = ['event FLData(uint256 borrowed, uint256 due)']
      const iface = new ethers.utils.Interface(abi)

      const flDataEvent = iface.parseLog(
        lookupEventByHash(
          allEvents,
          '0x9c6641b21946115d10f3f55df9bec5752ec06d40dc9250b1cc6560549764600e',
        )[0],
      )
      const expected = amountToWei(vaultInfo.debt)
      const actual = amountToWei(
        new BigNumber(flDataEvent.args.due.toString()).dividedBy(new BigNumber(10).pow(18)),
      )

      expectToBe(actual, 'gt', expected.times(0.98))
      expectToBe(expected, 'gt', actual.times(0.98))
    })

    it('it should send fee to beneficiary', async () => {
      const allEvents = result.events!.map(x => ({
        firstTopic: x.topics[0],
        topics: x.topics,
        data: x.data,
        name: x.event,
      }))

      const feePaidEvents = lookupEventByHash(
        allEvents,
        '0x075a2720282fdf622141dae0b048ef90a21a7e57c134c76912d19d006b3b3f6f',
      )

      expect(feePaidEvents.length).to.be.equal(1)
      const feeAmount = new BigNumber(feePaidEvents[0].data, 16)
      const endBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, ADDRESS_REGISTRY.feeRecepient)
      const balanceDifference = endBalance.minus(startBalance)
      expectToBeEqual(feeAmount.toFixed(0), balanceDifference)
    })
  })
})
