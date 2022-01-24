import BigNumber from 'bignumber.js'
import * as Mocha from 'mocha'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import {
  deploySystem,
  FEE,
  FEE_BASE,
  getOraclePrice,
  dsproxyExecuteAction,
  getLastCDP,
} from './common/utils/mcd-deployment.utils'
import { getMarketPrice, getCurrentBlockNumber } from './common/http-apis'

import {
  printAllERC20Transfers,
  findExchangeTransferEvent,
  getAddressesLabels,
  fillExchangeData,
  createSnapshot,
  restoreSnapshot,
} from './common/integration/utils'

import {
  calculateParamsIncreaseMP,
  calculateParamsDecreaseMP,
  amountToWei,
  prepareBasicParams,
  packMPAParams,
  ensureWeiFormat,
  addressRegistryFactory,
} from './common/utils/params-calculation.utils'
import { ContractReceipt, Signer } from 'ethers'

import MAINNET_ADDRESSES from '../addresses/mainnet.json'

import { balanceOf, etherBalanceOf, WETH_ADDRESS } from './utils'
import { getVaultInfo } from './common/utils/mcd.utils'
import { one, ten } from './common/cosntants'
import { JsonRpcProvider } from '@ethersproject/providers'
import { expectToBe, expectToBeEqual } from './common/utils/test.utils'
import { VaultInfo } from './common/common.types'

const AAVE_FEE = new BigNumber(0.0009)
const BASE_SLIPPAGE = 0.08
const OAZO_FEE = new BigNumber(FEE).div(FEE_BASE)

const ALLOWED_PROTOCOLS = ['UNISWAP_V3']
let blockNumber = parseInt(process.env.BLOCK_NUMBER!, 10)

const testVaults = [
  {
    existingCDP: undefined,
    gemAddress: WETH_ADDRESS,
    _1inchPayload: {
      to: '0x111111111117dc0aa78b770fa6a738034120c302',
      data: '0x111111111117dc0aa78b770fa6a738034120c302',
    }, // irrelevant, for mock exchange just for encoding validation passing
    desiredCDPState: {
      desiredCollRatio: 2.0, // expected collateralisation Ratio after Vault creation
      providedCollateral: 14, // Amount of ETH used initialy
      providedDAI: 0,
    },
  },
  {
    existingCDP: undefined,
    gemAddress: WETH_ADDRESS,
    _1inchPayload: {
      to: '0x111111111117dc0aa78b770fa6a738034120c302',
      data: '0x111111111117dc0aa78b770fa6a738034120c302',
    }, // irrelevant, for mock exchange just for encoding validation passing
    desiredCDPState: {
      desiredCollRatio: 5.0, // expected collateralisation Ratio after Vault creation
      providedCollateral: 50, // Amount of ETH used initialy
      providedDAI: 0,
    },
  },
]

const testParams = [
  {
    slippage: BASE_SLIPPAGE,
    desiredDAI: 1100,
    desiredETH: 0.7,
    useMockExchange: true,
    debug: false,
    skipFL: false,
    printERC20Transfers: false,
    desiredCollRatio: 2.5,
    desiredCollRatioDAI: 3.5,
    desiredCollRatioETH: 3.5,
    oraclePriceDivergence: 0.2, // marketPrice = 80% of oraclePrice, only used if useMockExchange==true
  },
  {
    slippage: BASE_SLIPPAGE,
    desiredDAI: 1100, // amount of dai withdrawn in decreaseMultipleWithdrawDai
    desiredETH: 0.7, // amount of dai  withdrawn in decreaseMultipleWithdrawCollateral
    useMockExchange: false,
    debug: false,
    skipFL: false,
    printERC20Transfers: false,
    desiredCollRatio: 2.5, // collateralisation ratio after Multiply decrease
    desiredCollRatioDAI: 3.5, // collateralisation ratio after Multiply decrease with DAI withdraw
    desiredCollRatioETH: 3.5, // collateralisation ratio after Multiply decrease with ETH withdraw
    oraclePriceDivergence: 0, // difference between oracle price and market price, <0,1> marketPrice = (1-x)*oraclePrice
  },
  {
    slippage: BASE_SLIPPAGE,
    desiredDAI: 1100,
    desiredETH: 0.7,
    useMockExchange: true,
    debug: false,
    skipFL: false,
    printERC20Transfers: false,
    desiredCollRatio: 1.7,
    desiredCollRatioDAI: 3.0,
    desiredCollRatioETH: 4.5,
    oraclePriceDivergence: 0.2, // marketPrice = 80% of oraclePrice, only used if useMockExchange==true
  },
  {
    slippage: BASE_SLIPPAGE,
    desiredDAI: 1100,
    desiredETH: 0.7,
    useMockExchange: false,
    debug: false,
    skipFL: false,
    printERC20Transfers: false,
    desiredCollRatio: 1.7,
    desiredCollRatioDAI: 3.0,
    desiredCollRatioETH: 4.5,
    oraclePriceDivergence: 0, // marketPrice = 80% of oraclePrice, only used if useMockExchange==true
  },
  {
    slippage: BASE_SLIPPAGE,
    desiredDAI: 100, // amount of dai withdrawn in decreaseMultipleWithdrawDai
    desiredETH: 1, // amount of dai  withdrawn in decreaseMultipleWithdrawCollateral
    useMockExchange: false,
    debug: true,
    skipFL: true,
    printERC20Transfers: false,
    desiredCollRatio: 5.1, // collateralisation ratio after Multiply decrease
    desiredCollRatioDAI: 5.2, // collateralisation ratio after Multiply decrease with DAI withdraw
    desiredCollRatioETH: 5.2, // collateralisation ratio after Multiply decrease with ETH withdraw
    oraclePriceDivergence: 0, // difference between oracle price and market price, <0,1> marketPrice = (1-x)*oraclePrice
  },
]

// TODO:
async function runner(tasks: any) {
  // for (let i = 0; i < tasks.length; i++) { // TODO:
  for (const task in tasks) {
    await task
  }
}

runner([
  // testCaseDefinition(testVaults[0], testParams[0]),
  testCaseDefinition(testVaults[0], testParams[1]),
  testCaseDefinition(testVaults[0], testParams[2]),
  //  testCaseDefinition(testVaults[0], testParams[3]),
  // testCaseDefinition(testVaults[0],testParams[0])
  // runTestCase(testVaults[0],OracleMarketDifference)
  testCaseDefinition(testVaults[1], testParams[4]), // skipFL == true on small operations
])

// TODO:
async function testCaseDefinition(testCase: any, testParam: any) {
  const provider = new ethers.providers.JsonRpcProvider()

  testCase = JSON.parse(JSON.stringify(testCase)) // break reference
  testParam = JSON.parse(JSON.stringify(testParam))

  return new Promise(resolve => {
    // to run several in runner, one after another

    describe(`Proxy Action: oracleDivergence=${
      testParam.useMockExchange ? testParam.oraclePriceDivergence * 100 : 0
    }%; slippage=${testParam.slippage}; skipFL=${testParam.skipFL}`, async () => {
      after(
        () => resolve(true), // resolves Promise
      )

      let primarySigner: Signer
      let primarySignerAddress: string

      // TODO:
      let deployedContracts: any
      let ADDRESS_REGISTRY: any // TODO:
      let feeRecipient: string
      let userProxyAddr: string
      let oraclePrice: BigNumber
      let marketPrice: BigNumber
      let initialSetupSnapshotId: string

      function addBalanceCheckingAssertions(_it: Mocha.TestFunction, useMockExchange: boolean) {
        _it('ProxyAction should have no DAI', async () => {
          const mpaAddress = await deployedContracts.multiplyProxyActionsInstance.address
          const balance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, mpaAddress)
          expectToBeEqual(balance.toFixed(0), 0) // TODO: check all toFixed(0) calls
        })

        _it('ProxyAction should have no ETH', async () => {
          const mpaAddress = await deployedContracts.multiplyProxyActionsInstance.address
          const balance = await etherBalanceOf(mpaAddress)
          expectToBeEqual(balance.toFixed(0), 0)
        })

        _it('ProxyAction should have no WETH', async () => {
          const mpaAddress = await deployedContracts.multiplyProxyActionsInstance.address
          const balance = await balanceOf(MAINNET_ADDRESSES.ETH, mpaAddress)
          expectToBeEqual(balance.toFixed(0), 0)
        })

        _it('dsProxy should have no DAI', async () => {
          const dsProxyAddress = await deployedContracts.dsProxyInstance.address
          const balance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, dsProxyAddress)
          expectToBeEqual(balance.toFixed(0), 0)
        })

        _it('dsProxy should have no ETH', async () => {
          const dsProxyAddress = await deployedContracts.dsProxyInstance.address
          const balance = await etherBalanceOf(dsProxyAddress)
          expectToBeEqual(balance.toFixed(0), 0)
        })

        _it('dsProxy should have no WETH', async () => {
          const dsProxyAddress = await deployedContracts.dsProxyInstance.address
          const balance = await balanceOf(MAINNET_ADDRESSES.ETH, dsProxyAddress)
          expectToBeEqual(balance.toFixed(0), 0)
        })

        if (!useMockExchange) {
          _it('exchange should have no DAI', async () => {
            const addressToCheck = await deployedContracts.exchangeInstance.address
            const balance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, addressToCheck)
            expectToBeEqual(balance.toFixed(0), 0)
          })

          _it('exchange should have no ETH', async () => {
            const addressToCheck = deployedContracts.exchangeInstance.address
            const balance = await etherBalanceOf(addressToCheck)
            expectToBeEqual(balance.toFixed(0), 0)
          })

          _it('exchange should have no WETH', async () => {
            const addressToCheck = deployedContracts.exchangeInstance.address
            const balance = await balanceOf(MAINNET_ADDRESSES.ETH, addressToCheck)
            expectToBeEqual(balance.toFixed(0), 0)
          })
        }
      }

      const calculateRequiredDebt = function (
        operation,
        existingCDP,
        desiredCDPState,
        oraclePrice,
        marketPrice,
        slippage,
        debug = false,
        withdrawDai = 0,
        withdrawColl = 0,
      ) {
        let debtDelta
        let exchangeMinAmount
        const currentColl = new BigNumber(existingCDP?.coll || 0)
          .plus(desiredCDPState.providedCollateral)
          .minus(withdrawColl)
        const currentDebt = new BigNumber(existingCDP?.debt ? existingCDP.debt : 0).plus(
          withdrawDai,
        )

        const targetColRatio = new BigNumber(desiredCDPState.desiredCollRatio.toString()) // TODO:
        if (operation === 'mul') {
          ;[debtDelta, exchangeMinAmount] = calculateParamsIncreaseMP(
            oraclePrice,
            marketPrice,
            OAZO_FEE,
            AAVE_FEE,
            currentColl,
            currentDebt,
            targetColRatio,
            slippage,
            desiredCDPState.providedDAI,
            debug,
          )
        } else {
          ;[debtDelta, exchangeMinAmount] = calculateParamsDecreaseMP(
            oraclePrice,
            marketPrice,
            OAZO_FEE,
            AAVE_FEE,
            currentColl,
            currentDebt,
            targetColRatio,
            slippage,
            debug,
          )
        }

        if (
          !debtDelta ||
          !exchangeMinAmount ||
          !BigNumber.isBigNumber(debtDelta) ||
          !BigNumber.isBigNumber(exchangeMinAmount)
        ) {
          console.log(debtDelta, exchangeMinAmount)
          throw new Error('calculateRequiredDebt incorrect')
        }
        return [debtDelta, exchangeMinAmount]
      }

      const updateLastCDPInfo = async function (
        data,
        signer: Signer,
        provider: JsonRpcProvider,
        userProxyAddr,
      ) {
        const lastCDP = await getLastCDP(provider, signer, userProxyAddr)
        const vaultInfo = await getVaultInfo(
          deployedContracts.mcdViewInstance,
          lastCDP.id,
          lastCDP.ilk,
        )
        data.existingCDP = {
          coll: vaultInfo.coll,
          debt: vaultInfo.debt,
          id: lastCDP.id,
          ilk: lastCDP.ilk,
        }
      }

      before(async () => {
        // TODO: validate parseInt
        if (!blockNumber || !testParam.useMockExchange) {
          blockNumber = await getCurrentBlockNumber()
        }
        // await resetNetworkToBlock(provider, blockNumber - 6)
        primarySigner = provider.getSigner(0)
        primarySignerAddress = await primarySigner.getAddress()

        deployedContracts = await deploySystem(
          provider,
          primarySigner,
          testParam.useMockExchange,
          testParam.debug,
        )
        console.log('system deployed!')

        userProxyAddr = deployedContracts.dsProxyInstance.address
        ADDRESS_REGISTRY = addressRegistryFactory(
          deployedContracts.multiplyProxyActionsInstance.address,
          deployedContracts.exchangeInstance.address,
        )
        console.log('addressRegistry >>>>>> ', ADDRESS_REGISTRY)

        feeRecipient = await deployedContracts.exchangeInstance.feeBeneficiaryAddress()
        ADDRESS_REGISTRY.feeRecepient = feeRecipient // TODO:

        if (!testParam.skipFL) {
          // TODO:
          ADDRESS_REGISTRY.lender = feeRecipient // some correct address that do not have FL functionality
        }

        oraclePrice = await getOraclePrice(provider)
        console.log('USING MOCK EXCH: ', testParam.useMockExchange) // TODO:
        if (testParam.useMockExchange) {
          marketPrice = oraclePrice.multipliedBy(one.minus(testParam.oraclePriceDivergence))
          await deployedContracts.exchangeInstance.setPrice(
            marketPrice.multipliedBy(ten.pow(18)).toFixed(0),
          )
        } else {
          marketPrice = await getMarketPrice(WETH_ADDRESS, MAINNET_ADDRESSES.MCD_DAI, 18, 18)
        }

        initialSetupSnapshotId = await createSnapshot(provider)
        // revertBlockNumber = await provider.getBlockNumber() // TODO:
      })

      describe(`opening Multiply Vault with collateralisation ratio of ${testCase.desiredCDPState.desiredCollRatio}`, async () => {
        let txResult: ContractReceipt
        let startBalance: BigNumber

        before(async () => {
          startBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, feeRecipient)
          const [debtDelta, collateralDelta] = calculateRequiredDebt(
            'mul',
            testCase.existingCDP,
            testCase.desiredCDPState,
            oraclePrice,
            marketPrice,
            testParam.slippage,
            testParam.debug,
          )

          const { exchangeData, cdpData } = prepareBasicParams(
            testCase.gemAddress,
            debtDelta,
            collateralDelta,
            testCase.desiredCDPState.providedCollateral,
            testCase._1inchPayload,
            testCase.existingCDP,
            primarySignerAddress,
            false,
            false,
          )

          await fillExchangeData(
            testParam,
            exchangeData,
            deployedContracts.exchangeInstance,
            OAZO_FEE,
            ALLOWED_PROTOCOLS,
          )

          const params = packMPAParams(cdpData, exchangeData, ADDRESS_REGISTRY)

          cdpData.skipFL = testParam.skipFL
          const [status, result] = await dsproxyExecuteAction(
            deployedContracts.multiplyProxyActionsInstance,
            deployedContracts.dsProxyInstance,
            primarySignerAddress,
            'openMultiplyVault',
            params,
            amountToWei(testCase.desiredCDPState.providedCollateral),
          )
          expect(status).to.be.true
          txResult = result

          if (testParam.printERC20Transfers) {
            const labels = getAddressesLabels(
              deployedContracts,
              ADDRESS_REGISTRY,
              MAINNET_ADDRESSES,
              primarySignerAddress,
            )
            printAllERC20Transfers(txResult, labels)
          }
          // TODO:
          // if (!status) {
          //   restoreSnapshot.lock = true // If tx fails throws immediatelly and prevent snalshot revert in AfterAll hook
          //   throw new Error('Tx failed')
          // }

          await updateLastCDPInfo(testCase, primarySigner, provider, userProxyAddr)
        })

        after(async () => {
          await restoreSnapshot(provider, initialSetupSnapshotId)
        })

        it(`it should open vault with collateralisation Ratio of ${testCase.desiredCDPState.desiredCollRatio}`, async () => {
          const precision = 10
          const actualRatio = new BigNumber(testCase.existingCDP.coll)
            .times(oraclePrice)
            .div(testCase.existingCDP.debt)

          const maxAcceptable = new BigNumber(testCase.desiredCDPState.desiredCollRatio).times(
            one.plus(precision).div(100),
          )

          console.warn(`\x1b[33m ${precision}% margin for collateralisation ratio applied \x1b[0m`)

          expectToBe(actualRatio, 'gte', testCase.desiredCDPState.desiredCollRatio) // final collaterallisation value equal to at least desired
          expectToBe(actualRatio, 'lte', maxAcceptable) // final collaterallisation is off not more than 5% from desired value
        })

        it(`it should flash loan correct amount of DAI`, async () => {
          const precision = 0.1
          console.warn(`\x1b[33m${precision}% margin for collateralisation ratio applied\x1b[0m`)
          const allEvents = txResult.events!.map(x => {
            return {
              firstTopic: x.topics[0],
              topics: x.topics,
              data: x.data,
              name: x.event,
            }
          })
          const abi = ['event FLData(uint256 borrowed, uint256 due)']
          const iface = new ethers.utils.Interface(abi)

          const flDataEvent = iface.parseLog(
            allEvents.filter(
              x =>
                x.firstTopic ===
                '0x9c6641b21946115d10f3f55df9bec5752ec06d40dc9250b1cc6560549764600e',
            )[0],
          )
          const expected = amountToWei(testCase.existingCDP.debt)
          let actual = new BigNumber(flDataEvent.args.due.toString())
          actual = amountToWei(actual.dividedBy(ten.pow(18)))
          expect(actual.gt(expected.multipliedBy(0.98))).to.be.equal(true)
          expect(expected.gt(actual.multipliedBy(0.98))).to.be.equal(true)
        })

        it('it should send fee to beneficiary', async () => {
          const precision = 1
          console.warn(`\x1b[33m${precision}% margin for collateralisation ratio applied\x1b[0m`)
          const allEvents = txResult.events!.map(x => {
            return {
              firstTopic: x.topics[0],
              topics: x.topics,
              data: x.data,
              name: x.event,
            }
          })
          const feePaidEvents = allEvents.filter(
            x =>
              x.firstTopic === '0x075a2720282fdf622141dae0b048ef90a21a7e57c134c76912d19d006b3b3f6f',
          )
          console.log('Events count', allEvents.length)
          expect(feePaidEvents.length).to.be.deep.equal(1)
          const feeAmount = new BigNumber(feePaidEvents[0].data, 16)
          const expected = amountToWei(OAZO_FEE.times(testCase.existingCDP.debt))
          const endBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, feeRecipient)
          const balanceDifference = endBalance.minus(startBalance).toString()
          expect(feeAmount.toNumber()).to.be.greaterThanOrEqual(
            expected.toNumber() * (1 - precision / 100),
          ) // due to possible rounding errors
          expect(feeAmount.toFixed(0)).to.be.equal(balanceDifference)
        })

        describe(`Decrease Multiple to coll ratio of ${testCase.desiredCDPState.desiredCollRatio} to ${testParam.desiredCollRatio} without withdrawal`, async () => {
          let inTxResult: ContractReceipt
          let beforeTxBalance: BigNumber
          let testCaseCopy
          let internalSnapshotId: string

          before(async () => {
            internalSnapshotId = await createSnapshot(provider)

            testCaseCopy = JSON.parse(JSON.stringify(testCase)) // TODO:

            testCaseCopy.desiredCDPState.desiredCollRatio = testParam.desiredCollRatio
            testCaseCopy.desiredCDPState.providedCollateral = 0

            beforeTxBalance = await etherBalanceOf(await primarySigner.getAddress())

            const [debtDelta, collateralDelta] = calculateRequiredDebt(
              'demul',
              testCaseCopy.existingCDP,
              testCaseCopy.desiredCDPState,
              oraclePrice,
              marketPrice,
              testParam.slippage,
              testParam.debug,
            )

            const { exchangeData, cdpData } = prepareBasicParams(
              testCaseCopy.gemAddress,
              debtDelta,
              collateralDelta,
              0,
              testCaseCopy._1inchPayload,
              testCaseCopy.existingCDP,
              primarySignerAddress,
              true,
              false,
            )

            await fillExchangeData(
              testParam,
              exchangeData,
              deployedContracts.exchangeInstance,
              ALLOWED_PROTOCOLS,
            )
            const params = packMPAParams(cdpData, exchangeData, ADDRESS_REGISTRY)

            cdpData.skipFL = testParam.skipFL
            const [status, result] = await dsproxyExecuteAction(
              deployedContracts.multiplyProxyActionsInstance,
              deployedContracts.dsProxyInstance,
              primarySignerAddress,
              'decreaseMultiple',
              params,
            )
            expect(status).to.be.true
            inTxResult = result

            if (testParam.printERC20Transfers) {
              const labels = getAddressesLabels(
                deployedContracts,
                ADDRESS_REGISTRY,
                MAINNET_ADDRESSES,
                primarySignerAddress,
              )
              printAllERC20Transfers(inTxResult, labels)
            }

            // TODO:
            // if (!status) {
            //   restoreSnapshot.lock = true
            //   throw new Error('Tx failed')
            // }

            await updateLastCDPInfo(testCaseCopy, primarySigner, provider, userProxyAddr)
          })

          after(async () => {
            await restoreSnapshot(provider, internalSnapshotId)
          })

          it(`should increase CollateralisationRatio to ${testParam.desiredCollRatio} `, async () => {
            const negativeMargin = new BigNumber(0.1)
            const positiveMargin = new BigNumber(5)
            const collRatio = new BigNumber(testCaseCopy.existingCDP.coll)
              .times(oraclePrice)
              .div(testCaseCopy.existingCDP.debt)
              .toNumber()

            expectToBe(
              collRatio,
              'gt',
              new BigNumber(testParam.desiredCollRatio).times(one.minus(negativeMargin.div(100))),
            ) // to accout for rounding errors
            expectToBe(
              collRatio,
              'lte',
              new BigNumber(testParam.desiredCollRatio).times(one.plus(positiveMargin.times(100))),
            ) // due to slippage smaller than maximum we might end up with higher coll ratio

            console.warn(
              `\x1b[33m${positiveMargin}% positive and ${negativeMargin}% negative margin for collateralisation ratio applied actual Value ${collRatio}\x1b[0m`,
            )
          })

          it('should not change primaryAddress ETH balance, only by tx Costs', async () => {
            const after = await etherBalanceOf(await primarySigner.getAddress())

            const gasUsed = new BigNumber(inTxResult.cumulativeGasUsed.toString())
            const gasPrice = 1000000000

            const reminder = beforeTxBalance.minus(after).minus(gasUsed.times(gasPrice))
            expect(reminder).to.be.equal(0)
          })

          addBalanceCheckingAssertions(it, testParam.useMockExchange) // TODO: deployedContracts)
        })

        describe(`Decrease Multiple to coll ratio of ${testParam.desiredCollRatioDAI} with DAI withdrawal (${testParam.desiredDAI} DAI)`, async () => {
          let daiBefore: BigNumber
          // let beforeTxBalance: BigNumber // TODO:
          let testCaseCopy
          let internalSnapshotId: string

          before(async () => {
            daiBefore = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, await primarySigner.getAddress())
            if (testParam.debug) {
              console.log(
                'DAI Balance of',
                await primarySigner.getAddress(),
                ' equals ',
                daiBefore.toString(),
              )
            }
            internalSnapshotId = await createSnapshot(provider)
            testCaseCopy = JSON.parse(JSON.stringify(testCase))

            testCaseCopy.desiredCDPState.desiredCollRatio = testParam.desiredCollRatioDAI
            testCaseCopy.desiredCDPState.providedCollateral = 0

            // beforeTxBalance = await etherBalanceOf(await primarySigner.getAddress()) // TODO:

            const [debtDelta, collateralDelta] = calculateRequiredDebt(
              'demul',
              testCaseCopy.existingCDP,
              testCaseCopy.desiredCDPState,
              oraclePrice,
              marketPrice,
              testParam.slippage,
              testParam.debug,
              testParam.desiredDAI,
              0,
            )

            const { exchangeData, cdpData } = prepareBasicParams(
              testCaseCopy.gemAddress,
              debtDelta,
              collateralDelta,
              0,
              testCaseCopy._1inchPayload,
              testCaseCopy.existingCDP,
              primarySignerAddress,
              true,
            )

            cdpData.withdrawCollateral = 0
            cdpData.withdrawDai = amountToWei(testParam.desiredDAI).toFixed(0) as any // TODO:

            await fillExchangeData(
              testParam,
              exchangeData,
              deployedContracts.exchangeInstance,
              ALLOWED_PROTOCOLS,
            )

            const params = packMPAParams(cdpData, exchangeData, ADDRESS_REGISTRY)

            cdpData.skipFL = testParam.skipFL
            const [status, inTxResult] = await dsproxyExecuteAction(
              deployedContracts.multiplyProxyActionsInstance,
              deployedContracts.dsProxyInstance,
              primarySignerAddress,
              'decreaseMultipleWithdrawDai',
              params,
            )
            expect(status).to.be.true

            if (testParam.printERC20Transfers) {
              const labels = getAddressesLabels(
                deployedContracts,
                ADDRESS_REGISTRY,
                MAINNET_ADDRESSES,
                primarySignerAddress,
              )
              printAllERC20Transfers(inTxResult, labels)
            }

            // if (!status) {
            //   restoreSnapshot.lock = true
            //   throw new Error('Tx failed')
            // }

            if (testParam.debug) {
              console.log('Ratio check before', testCaseCopy.existingCDP, oraclePrice.toFixed(3))
            }
            await updateLastCDPInfo(testCaseCopy, primarySigner, provider, userProxyAddr)
          })

          after(async () => {
            await restoreSnapshot(provider, internalSnapshotId)
          })

          it(`should increase CollateralisationRatio to ${testParam.desiredCollRatioDAI}`, async () => {
            const negativeMargin = new BigNumber(0.1)
            const positiveMargin = new BigNumber(5)

            if (testParam.debug) {
              console.log('Ratio check after', testCaseCopy.existingCDP, oraclePrice.toFixed(3))
            }
            const collRatio = new BigNumber(testCaseCopy.existingCDP.coll)
              .times(oraclePrice)
              .div(testCaseCopy.existingCDP.debt)
              .toNumber()

            expectToBe(
              collRatio,
              'gt',
              new BigNumber(testParam.desiredCollRatioDAI).times(
                one.minus(negativeMargin.div(100)),
              ),
            ) // to accout for rounding errors
            expectToBe(
              collRatio,
              'lte',
              new BigNumber(testParam.desiredCollRatioDAI).times(one.plus(positiveMargin.div(100))),
            ) // due to slippage smaller than maximum we might end up with higher coll ratio

            // TODO: fix strings like these
            console.warn(
              `\x1b[33m${positiveMargin}% positive and ${negativeMargin}% negative margin for collateralisation ratio applied actual Value ${collRatio}\x1b[0m`,
            )
          })

          it(`should change primaryAddress DAI balance by exacly ${testParam.desiredDAI} DAI`, async () => {
            const balanceAfter = await balanceOf(
              MAINNET_ADDRESSES.MCD_DAI,
              await primarySigner.getAddress(),
            )

            if (testParam.debug) {
              console.log(
                'DAI Balance of',
                await primarySigner.getAddress(),
                ' equals ',
                balanceAfter.toString(),
              )
            }

            const balanceIncrease = new BigNumber(balanceAfter).minus(daiBefore).toFixed(0)

            expectToBeEqual(balanceIncrease, amountToWei(testParam.desiredDAI).toFixed(0))
          })

          addBalanceCheckingAssertions(it, testParam.useMockExchange) // TODO:, deployedContracts)
        })

        describe(`Decrease Multiple to coll ratio of ${testParam.desiredCollRatioETH} with Collateral withdrawal ${testParam.desiredETH} ETH`, async () => {
          let inTxResult: ContractReceipt
          let beforeTxBalance: BigNumber
          let daiBefore: BigNumber
          let actualSwappedAmount: BigNumber
          let minAcceptableAmount: BigNumber
          let testCaseCopy
          let internalSnapshotId: string

          before(async () => {
            internalSnapshotId = await createSnapshot(provider)

            daiBefore = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, await primarySigner.getAddress())

            testCaseCopy = JSON.parse(JSON.stringify(testCase)) // TODO:

            testCaseCopy.desiredCDPState.desiredCollRatio = testParam.desiredCollRatioETH
            testCaseCopy.desiredCDPState.providedCollateral = 0

            beforeTxBalance = await etherBalanceOf(await primarySigner.getAddress())

            const [debtDelta, collateralDelta] = calculateRequiredDebt(
              'demul',
              testCaseCopy.existingCDP,
              testCaseCopy.desiredCDPState,
              oraclePrice,
              marketPrice,
              testParam.slippage,
              testParam.debug,
              0,
              testParam.desiredETH,
            )

            const { exchangeData, cdpData } = prepareBasicParams(
              testCaseCopy.gemAddress,
              debtDelta,
              collateralDelta,
              0,
              testCaseCopy._1inchPayload,
              testCaseCopy.existingCDP,
              primarySignerAddress,
              true,
              false,
            )

            cdpData.withdrawCollateral = amountToWei(testParam.desiredETH).toFixed(0) as any // TODO:
            cdpData.withdrawDai = 0

            const params = packMPAParams(cdpData, exchangeData, ADDRESS_REGISTRY)

            await fillExchangeData(
              testParam,
              exchangeData,
              deployedContracts.exchangeInstance,
              ALLOWED_PROTOCOLS,
            )
            minAcceptableAmount = exchangeData.minToTokenAmount
            cdpData.skipFL = testParam.skipFL
            const [status, result] = await dsproxyExecuteAction(
              deployedContracts.multiplyProxyActionsInstance,
              deployedContracts.dsProxyInstance,
              primarySignerAddress,
              'decreaseMultipleWithdrawCollateral',
              params,
            )
            expect(status).to.be.true
            inTxResult = result

            // TODO:
            // if (!status) {
            //   restoreSnapshot.lock = true
            //   throw new Error('Tx failed')
            // }

            if (!testParam.skipFL) {
              actualSwappedAmount = findExchangeTransferEvent(
                deployedContracts.exchangeInstance.address,
                deployedContracts.multiplyProxyActionsInstance.address,
                inTxResult,
              )
            } else {
              actualSwappedAmount = findExchangeTransferEvent(
                deployedContracts.exchangeInstance.address,
                deployedContracts.userProxyAddress,
                inTxResult,
              )
            }

            if (testParam.printERC20Transfers) {
              const labels = getAddressesLabels(
                deployedContracts,
                ADDRESS_REGISTRY,
                MAINNET_ADDRESSES,
                primarySignerAddress,
              )
              printAllERC20Transfers(inTxResult, labels)
            }
            await updateLastCDPInfo(testCaseCopy, primarySigner, provider, userProxyAddr)
          })

          after(async () => {
            await restoreSnapshot(provider, internalSnapshotId)
          })

          it(`should increase CollateralisationRatio to ${testParam.desiredCollRatioETH} `, async () => {
            const negativeMargin = new BigNumber(0.1)
            const positiveMargin = new BigNumber(5)
            const collRatio = new BigNumber(testCaseCopy.existingCDP.coll)
              .times(oraclePrice)
              .div(testCaseCopy.existingCDP.debt)
              .toNumber()

            expectToBe(
              collRatio,
              'gt',
              new BigNumber(testParam.desiredCollRatioDAI).times(
                one.minus(negativeMargin.div(100)),
              ),
            ) // to accout for rounding errors
            expectToBe(
              collRatio,
              'lte',
              new BigNumber(testParam.desiredCollRatioDAI).times(one.plus(positiveMargin.div(100))),
            ) // due to slippage smaller than maximum we might end up with higher coll ratio
            console.warn(
              `\x1b[33m${positiveMargin}% positive and ${negativeMargin}% negative margin for collateralisation ratio applied actual Value ${collRatio}\x1b[0m`,
            )
          })

          it(`should change primaryAddress ETH balance by exacly ${testParam.desiredETH} ETH, minus tx fees`, async () => {
            const after = await etherBalanceOf(await primarySigner.getAddress())

            const gasUsed = new BigNumber(inTxResult.cumulativeGasUsed.toString())
            const gasPrice = 1000000000
            const reminder = beforeTxBalance.minus(after).minus(gasUsed.times(gasPrice))

            expect(reminder.times(-1)).to.be.equal(amountToWei(testParam.desiredETH).toFixed(0))
          })

          it(`should change primaryAddress DAI balance only due to not maximum slippage`, async () => {
            const precision = new BigNumber(2)
            const daiAfter = await balanceOf(
              MAINNET_ADDRESSES.MCD_DAI,
              await primarySigner.getAddress(),
            )

            const balanceIncrease = daiAfter.minus(daiBefore)
            const swapDifference = actualSwappedAmount.minus(minAcceptableAmount)

            const ratio = balanceIncrease.div(swapDifference)
            console.warn(
              `\x1b[33m ${precision}% margin for surplus DAI amounts, actual ratio ${ratio.toFixed()} \x1b[0m`,
            )

            expectToBe(ratio, 'lt', one.plus(precision.div(100)))
            expectToBe(ratio, 'gt', one.minus(precision.div(100)))
          })

          addBalanceCheckingAssertions(it, testParam.useMockExchange) // TODO:, deployedContracts)
        })

        describe('Close Vault, withdraw collateral', async () => {
          let closingVaultInfo
          // let closedVaultInfo // TODO:
          let beforeTxBalance: BigNumber
          let afterTxBalance: BigNumber
          let beneficiaryBefore
          let daiBefore: BigNumber
          let daiAfter: BigNumber
          let minTokenAmount
          let actualSwappedAmount
          let testCaseCopy
          let internalSnapshotId: string
          let inTxResult: ContractReceipt

          before(async () => {
            internalSnapshotId = await createSnapshot(provider)

            await updateLastCDPInfo(testCase, primarySigner, provider, userProxyAddr)
            closingVaultInfo = testCase.existingCDP
            console.log('CDP state before', closingVaultInfo) // TODO:
            beforeTxBalance = await etherBalanceOf(await primarySigner.getAddress())
            daiBefore = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, await primarySigner.getAddress())

            testCaseCopy = JSON.parse(JSON.stringify(testCase)) // TODO:

            testCaseCopy.desiredCDPState.desiredCollRatio = 0
            testCaseCopy.desiredCDPState.providedCollateral = 0

            const { exchangeData, cdpData } = prepareBasicParams(
              testCaseCopy.gemAddress,
              testCase.existingCDP.debt,
              testCase.existingCDP.coll,
              0,
              testCaseCopy._1inchPayload,
              testCaseCopy.existingCDP,
              primarySignerAddress,
              true,
              false,
            )

            cdpData.withdrawCollateral = 0
            cdpData.withdrawDai = 0

            exchangeData.toTokenAmount = ensureWeiFormat(
              one
                .plus(AAVE_FEE)
                .plus(OAZO_FEE)
                .times(testCaseCopy.existingCDP.debt)
                .times(one.plus(testParam.slippage)),
            )
            exchangeData.minToTokenAmount = ensureWeiFormat(
              one.plus(AAVE_FEE).plus(OAZO_FEE).times(testCaseCopy.existingCDP.debt),
            )
            exchangeData.fromTokenAmount = ensureWeiFormat(
              one.minus(testParam.slippage).times(marketPrice).div(exchangeData.toTokenAmount),
            )

            minTokenAmount = exchangeData.minToTokenAmount

            cdpData.borrowCollateral = ensureWeiFormat(testCaseCopy.existingCDP.coll)
            cdpData.requiredDebt = exchangeData.minToTokenAmount

            await fillExchangeData(
              testParam,
              exchangeData,
              deployedContracts.exchangeInstance,
              ALLOWED_PROTOCOLS,
            )
            const params = packMPAParams(cdpData, exchangeData, ADDRESS_REGISTRY)
            beneficiaryBefore = await balanceOf(
              MAINNET_ADDRESSES.MCD_DAI,
              '0x79d7176aE8F93A04bC73b9BC710d4b44f9e362Ce',
            )

            cdpData.skipFL = testParam.skipFL

            const [status, result] = await dsproxyExecuteAction(
              deployedContracts.multiplyProxyActionsInstance,
              deployedContracts.dsProxyInstance,
              primarySignerAddress,
              'closeVaultExitCollateral',
              params,
            )
            expect(status).to.be.true
            inTxResult = result

            // if (!status) {
            //   restoreSnapshot.lock = true
            //   throw new Error('Tx failed')
            // }

            if (!testParam.skipFL) {
              actualSwappedAmount = findExchangeTransferEvent(
                deployedContracts.exchangeInstance.address,
                deployedContracts.multiplyProxyActionsInstance.address,
                inTxResult,
              )
            } else {
              actualSwappedAmount = findExchangeTransferEvent(
                deployedContracts.exchangeInstance.address,
                deployedContracts.userProxyAddress,
                inTxResult,
              )
            }

            if (testParam.printERC20Transfers) {
              const labels = getAddressesLabels(
                deployedContracts,
                ADDRESS_REGISTRY,
                MAINNET_ADDRESSES,
                primarySignerAddress,
              )
              printAllERC20Transfers(inTxResult, labels)
            }

            await updateLastCDPInfo(testCaseCopy, primarySigner, provider, userProxyAddr)

            daiAfter = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, await primarySigner.getAddress())

            afterTxBalance = await etherBalanceOf(await primarySigner.getAddress())
            // closedVaultInfo = testCaseCopy.existingCDP // TODO:
          })

          after(async () => {
            await restoreSnapshot(provider, internalSnapshotId)
          })

          it('should send to user all collateral in a vault minus debt', async () => {
            const gasUsed = new BigNumber(inTxResult.cumulativeGasUsed.toString())
            const gasPrice = 1000000000
            const reminder = afterTxBalance.minus(beforeTxBalance).plus(gasUsed.times(gasPrice))

            let expectedReturnedAmount = one
              .plus(testParam.slippage)
              .plus(AAVE_FEE)
              .plus(OAZO_FEE)
              .times(closingVaultInfo.debt)
              .div(marketPrice)
              .minus(closingVaultInfo.coll)

            expectedReturnedAmount = amountToWei(expectedReturnedAmount)
            const ratio = reminder.div(expectedReturnedAmount)

            expectToBe(ratio, 'lte', 1.02)
            expectToBe(ratio, 'gte', 0.98)
          })

          it('should send to user no more DAI than positive slippage', async () => {
            const expected = daiBefore.plus(actualSwappedAmount).minus(minTokenAmount)
            // console.log(expected, daiAfter, daiBefore) // TODO:
            const ratio = daiAfter.minus(daiBefore).div(expected.minus(daiBefore))

            expectToBe(ratio, 'lt', 1.01)
            expectToBe(ratio, 'gt', 0.99)
          })

          addBalanceCheckingAssertions(it, testParam.useMockExchange) // TODO: , deployedContracts)

          it('should collect fee', async () => {
            const beneficiaryAfter = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, feeRecipient)
            //       console.log(OUR_FEE, closingVaultInfo.debt)
            const expectedFee =
              // TODO: review that calculation
              OAZO_FEE.times(actualSwappedAmount).div(one.minus(OAZO_FEE))
            const allEvents = inTxResult.events!.map(x => {
              return {
                firstTopic: x.topics[0],
                topics: x.topics,
                data: x.data,
                name: x.event,
              }
            })
            const feePaidEvents = allEvents.filter(
              x =>
                x.firstTopic ===
                '0x69e27f80547602d16208b028c44d20f25956e1fb7d0f51d62aa02f392426f371',
            )
            expect(feePaidEvents.length).to.be.deep.equal(1)
            const feeAmount = new BigNumber(feePaidEvents[0].data, 16)
            //    console.log('beneficiary diff', beneficiaryAfter.sub(beneficiaryBefore).toString()) //
            const diff = beneficiaryAfter.minus(beneficiaryBefore)

            expectToBeEqual(diff, feeAmount)
            expectToBe(expectedFee, 'lt', feeAmount.times(1.01))
            expectToBe(expectedFee, 'gt', feeAmount.times(0.99))
          })
        })

        describe('Close Vault, withdraw DAI', async () => {
          if (testParam.skipFL) {
            return
          }

          let inTxResult: ContractReceipt
          let closingVaultInfo: VaultInfo
          // let closedVaultInfo // TODO:
          let beforeTxBalance: BigNumber
          // let afterTxBalance: BigNumber
          // let beneficiaryBefore
          let daiBefore: BigNumber
          // let daiAfter
          let testCaseCopy
          let internalSnapshotId: string

          before(async () => {
            internalSnapshotId = await createSnapshot(provider)

            await updateLastCDPInfo(testCase, primarySigner, provider, userProxyAddr)
            closingVaultInfo = testCase.existingCDP
            beforeTxBalance = await etherBalanceOf(await primarySigner.getAddress())

            daiBefore = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, await primarySigner.getAddress())

            testCaseCopy = JSON.parse(JSON.stringify(testCase)) // TODO:

            testCaseCopy.desiredCDPState.desiredCollRatio = 0
            testCaseCopy.desiredCDPState.providedCollateral = 0

            const { exchangeData, cdpData } = prepareBasicParams(
              testCaseCopy.gemAddress,
              testCase.existingCDP.debt,
              testCase.existingCDP.coll,
              0,
              testCaseCopy._1inchPayload,
              testCaseCopy.existingCDP,
              primarySignerAddress,
              true,
              false,
            )

            cdpData.withdrawCollateral = 0
            cdpData.withdrawDai = 0

            exchangeData.fromTokenAmount = ensureWeiFormat(testCaseCopy.existingCDP.coll)

            const worstPossibleDaiValueOfExistingCollateral = marketPrice
              .times(one.minus(testParam.slippage))
              .times(testCaseCopy.existingCDP.coll)

            const daiOutAfterOazoFee = worstPossibleDaiValueOfExistingCollateral.times(
              one.minus(OAZO_FEE),
            )

            exchangeData.minToTokenAmount = ensureWeiFormat(daiOutAfterOazoFee)

            exchangeData.toTokenAmount = ensureWeiFormat(
              new BigNumber(exchangeData.minToTokenAmount).div(one.minus(testParam.slippage)),
            )

            cdpData.borrowCollateral = ensureWeiFormat(testCaseCopy.existingCDP.coll)
            cdpData.requiredDebt = ensureWeiFormat(
              new BigNumber(testCaseCopy.existingCDP.debt).times(1.0001),
            )

            await fillExchangeData(
              testParam,
              exchangeData,
              deployedContracts.exchangeInstance,
              ALLOWED_PROTOCOLS,
            )
            const params = packMPAParams(cdpData, exchangeData, ADDRESS_REGISTRY)

            // TODO:
            // beneficiaryBefore = await balanceOf(
            //   MAINNET_ADDRESSES.MCD_DAI,
            //   feeRecipient,
            // )

            cdpData.skipFL = testParam.skipFL
            const [status, result] = await dsproxyExecuteAction(
              deployedContracts.multiplyProxyActionsInstance,
              deployedContracts.dsProxyInstance,
              primarySignerAddress,
              'closeVaultExitDai',
              params,
            )
            expect(status).to.be.true
            inTxResult = result

            if (testParam.printERC20Transfers) {
              const labels = getAddressesLabels(
                deployedContracts,
                ADDRESS_REGISTRY,
                MAINNET_ADDRESSES,
                primarySignerAddress,
              )
              printAllERC20Transfers(inTxResult, labels)
            }

            // TODO:
            // if (!status) {
            //   restoreSnapshot.lock = true
            //   console.log(inTxResult)
            //   throw new Error('Tx failed')
            // }

            await updateLastCDPInfo(testCaseCopy, primarySigner, provider, userProxyAddr)

            // TODO:
            // daiAfter = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, await primarySigner.getAddress())

            // afterTxBalance = await etherBalanceOf(await primarySigner.getAddress())
            // closedVaultInfo = testCaseCopy.existingCDP
          })

          after(async () => {
            await restoreSnapshot(provider, internalSnapshotId)
          })

          it('should send to user no ETH', async () => {
            const after = await etherBalanceOf(await primarySigner.getAddress())
            const gasUsed = new BigNumber(inTxResult.cumulativeGasUsed.toString())

            const gasPrice = 1000000000
            const reminder = beforeTxBalance.minus(after).minus(gasUsed.times(gasPrice))
            expect(reminder).to.be.equal(0)
          })

          it('should send to user all DAI', async () => {
            const daiAfter = await balanceOf(
              MAINNET_ADDRESSES.MCD_DAI,
              await primarySigner.getAddress(),
            )
            const actual = daiAfter.minus(daiBefore)

            // do not take fees into account, but assert gives 10% tollerance which is way more than all fees and slippage
            const expected = amountToWei(
              marketPrice.times(closingVaultInfo.coll).minus(closingVaultInfo.debt),
            )

            if (testParam.debug) {
              console.log(
                `Users DAI Change: ${actual.toFixed(0)}; Vault Amount: ${expected.toFixed(
                  0,
                )}; Market Price: ${marketPrice.toFixed()}; Collateral Before: ${closingVaultInfo.coll.toFixed()}; Debt Before: ${closingVaultInfo.debt.toFixed()}; `,
              )
            }

            expectToBe(actual, 'gt', expected.times(0.9))
          })

          addBalanceCheckingAssertions(it, testParam.useMockExchange) // TODO:, deployedContracts)
        })
      })
    })
  })
}
