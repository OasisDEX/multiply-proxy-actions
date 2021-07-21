const {
  deploySystem,
  FEE,
  FEE_BASE,
  TEN,
  getOraclePrice,
  dsproxyExecuteAction,
  getLastCDP,
  getVaultInfo,
  MAINNET_ADRESSES,
  addressRegistryFactory,
} = require('./common/mcd-deployment-utils')
const {
  getMarketPrice,
  exchangeFromDAI,
  exchangeToDAI,
  getCurrentBlockNumber,
} = require('./common/http_apis')
const {
  calculateParamsIncreaseMP,
  calculateParamsDecreaseMP,
  amountToWei,
  prepareBasicParams,
  packMPAParams,
  convertToBigNumber,
  ensureWeiFormat,
} = require('./common/params-calculation-utils')
const { default: BigNumber } = require('bignumber.js')
const { expect } = require('chai')
const { ethers, ethernalWorkspace } = require('hardhat')
const { min } = require('ramda')
fs = require('fs')

const AAVE_FEE = 0.0009
const BASE_SLIPPAGE = 0.08
const OUR_FEE = FEE / FEE_BASE

var testVaults = [
  {
    existingCDP: undefined,
    gemAddress: MAINNET_ADRESSES.WETH_ADDRESS,
    _1inchPayload: {
      to: '0x111111111117dc0aa78b770fa6a738034120c302',
      data: '0x111111111117dc0aa78b770fa6a738034120c302',
    }, //irrelevant, for mock exchange just for encoding validation passing
    desiredCDPState: {
      desiredCollRatio: 1.7, //expected collateralisation Ratio after Vault creation
      providedCollateral: 14, // Amount of ETH used initialy
    },
  },
]

testParams = [
  {
    slippage: BASE_SLIPPAGE,
    desiredDAI: 1100,
    desiredETH: 0.7,
    useMockExchange: true,
    debug: false,
    desiredCollRatio: 2.5,
    desiredCollRatioDAI: 3.5,
    desiredCollRatioETH: 3.5,
    oraclePriceDivergence: 0.2, // marketPrice = 80% of oraclePrice, only used if useMockExchange==true
  },
  {
    slippage: BASE_SLIPPAGE,
    desiredDAI: 1100, //amount of dai withdrawn in decreaseMultipleWithdrawDai
    desiredETH: 0.7, //amount of dai  withdrawn in decreaseMultipleWithdrawCollateral
    useMockExchange: false,
    debug: false,
    desiredCollRatio: 2.5, //collateralisation ratio after Multiply decrease
    desiredCollRatioDAI: 3.5, //collateralisation ratio after Multiply decrease with DAI withdraw
    desiredCollRatioETH: 3.5, //collateralisation ratio after Multiply decrease with ETH withdraw
    oraclePriceDivergence: 0, //difference between oracle price and market price, <0,1> marketPrice = (1-x)*oraclePrice
  },
]

async function runner(tasks) {
  for (var i = 0; i < tasks.length; i++) {
    await tasks[i]
  }
}

runner([
  runTestCase(testVaults[0], testParams[1]),
  // runTestCase(testVaults[0],testParams[0]),
  // runTestCase(testVaults[0],OracleMarketDifference)
])

const createSnapshot = async function (provider) {
  var id = await provider.send('evm_snapshot', [])
 // console.log('snapshot created', id)
  return id
}

const restoreSnapshot = async function (provider, id) {
  if (restoreSnapshot.lock) {
    console.log('Skiping restore', restoreSnapshot.lock)
    delete restoreSnapshot.lock
  } else {
    await provider.send('evm_revert', [id])
  //  console.log('snapshot restored', id)
  }
}

const mul = function (a, b) {
  a = convertToBigNumber(a)
  b = convertToBigNumber(b)
  return a.multipliedBy(b)
}

const div = function (a, b) {
  a = convertToBigNumber(a)
  b = convertToBigNumber(b)
  return a.dividedBy(b)
}

const add = function (a, b) {
  a = convertToBigNumber(a)
  b = convertToBigNumber(b)
  return a.plus(b)
}

const sub = function (a, b) {
  a = convertToBigNumber(a)
  b = convertToBigNumber(b)
  return new BigNumber(a).minus(b)
}

const backup = function (el) {
  if (!el.__backup) {
    el.__backup = []
  } else {
  }
  var tmp = JSON.stringify(el)
  tmp = JSON.parse(tmp) //to create a copy
  delete tmp.__backup // to not backup a backup
  el.__backup.push(JSON.stringify(tmp))
}

const restore = function (el) {
  // keeps same reference, eg. in a table
  if (el.__backup) {
    let tmp = el.__backup.pop()
    tmp = JSON.parse(tmp)
    let keys = Object.keys(tmp)

    for (var i = 0; i < keys.length; i++) {
      if (keys[i] != '__backup') {
        el[keys[i]] = tmp[keys[i]]
      }
    }
  } else {
    console.warn('trying to restore, without backup')
  }
}

const validateDelta = function (debtDelta, collateralDelta) {
  if (
    debtDelta == undefined ||
    collateralDelta == undefined ||
    !BigNumber.isBigNumber(debtDelta) ||
    !BigNumber.isBigNumber(collateralDelta)
  ) {
    console.log(debtDelta, collateralDelta)
    throw 'calculateRequiredDebt incorrect'
  }
}

const getPayload = async function (exchangeData, beneficiary, testParam) {
  let retVal, url
  if (exchangeData.fromTokenAddress == MAINNET_ADRESSES.MCD_DAI) {
    ;[url, retVal] = await exchangeFromDAI(
      exchangeData.toTokenAddress,
      div(convertToBigNumber(exchangeData.fromTokenAmount), TEN.pow(18)),
      mul(testParam.slippage, 100),
      beneficiary,
      OUR_FEE,
    )
  } else {
    ;[url, retVal] = await exchangeToDAI(
      exchangeData.fromTokenAddress,
      div(convertToBigNumber(exchangeData.fromTokenAmount), TEN.pow(18)),
      mul(testParam.slippage, 100),
      beneficiary,
    )
  }
  var tmp = JSON.parse(JSON.stringify(retVal))
  tmp.data = undefined
  return retVal
}

const fillExchangeData = async function (_testParams, exchangeData, exchange) {
  if (_testParams.useMockExchange == false) {
    if (_testParams.debug == true) {
    }
    var _1inchPayload = await getPayload(exchangeData, exchange.address, _testParams)
    exchangeData._exchangeCalldata = _1inchPayload.data
    exchangeData.exchangeAddress = _1inchPayload.to
  }
}

async function runTestCase(testCase, testParam) {
  return new Promise((res, rej) => {
    //to run several in runner, one after another

    describe(`Proxy Action, oracleDivergence = ${
      testParam.useMockExchange ? testParam.oraclePriceDivergence * 100 : 0
    } %`, async function () {
      this.afterAll(async function () {
        res(true) //resolves Promise
      })

      var primarySigner
      var primarySignerAddress
      var provider

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
      var ADDRESS_REGISTRY
      var userProxyAddr
      var initialSetupSnapshotId
      var oraclePrice
      var marketPrice

      const resetNetworkToLatest = async function () {
        provider = new ethers.providers.JsonRpcProvider()
        let blockNumber = await getCurrentBlockNumber();
        console.log("Reseting network to:",blockNumber)
        provider.send('hardhat_reset', [
          {
            forking: {
              jsonRpcUrl: process.env.ALCHEMY_NODE,
              blockNumber: blockNumber-6,
            },
          },
        ])
      }

      const getSignerWithDetails = async function () {
        primarySigner = await provider.getSigner(0)
        primarySignerAddress = await primarySigner.getAddress()
      }

      const calculateRequiredDebt = function (
        operation,
        existingCDP,
        desiredCDPState,
        oraclePrice,
        marketPrice,
        slippage,
        debug = false,
        daiAmount = 0,
        withdrawColl = 0,
      ) {
        let debtDelta
        let exchangeMinAmount
        let currentColl = sub(
          add(existingCDP ? existingCDP.coll : 0, desiredCDPState.providedCollateral),
          withdrawColl,
        )
        let currentDebt = existingCDP ? existingCDP.debt : 0
        let targetColRatio = convertToBigNumber(desiredCDPState.desiredCollRatio)
        if (operation == 'mul') {
          ;[debtDelta, exchangeMinAmount] = calculateParamsIncreaseMP(
            oraclePrice,
            marketPrice,
            convertToBigNumber(OUR_FEE),
            convertToBigNumber(AAVE_FEE),
            currentColl,
            currentDebt,
            targetColRatio,
            slippage,
            daiAmount,
            debug,
          )
        } else {
          ;[debtDelta, exchangeMinAmount] = calculateParamsDecreaseMP(
            oraclePrice,
            marketPrice,
            convertToBigNumber(OUR_FEE),
            convertToBigNumber(AAVE_FEE),
            currentColl,
            currentDebt,
            targetColRatio,
            slippage,
            daiAmount,
            debug,
          )
        }

        if (
          debtDelta == undefined ||
          exchangeMinAmount == undefined ||
          !BigNumber.isBigNumber(debtDelta) ||
          !BigNumber.isBigNumber(exchangeMinAmount)
        ) {
          console.log('Error', arguments)
        }
        return [debtDelta, exchangeMinAmount]
      }

      const updateLastCDPInfo = async function (data, signer, provider, userProxyAddr) {
        var lastCDP = await getLastCDP(provider, signer, userProxyAddr)
        var vaultInfo = await getVaultInfo(
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

      this.beforeEach(async function () {
        backup(testCase)
      })
      this.afterEach(async function () {
        restore(testCase)
      })

      this.beforeAll(async function () {
        await resetNetworkToLatest()
        await getSignerWithDetails()

        deployedContracts = await deploySystem(provider, primarySigner, testParam.useMockExchange)
        userProxyAddr = deployedContracts.dsProxyInstance.address
        ADDRESS_REGISTRY = addressRegistryFactory(
          deployedContracts.multiplyProxyActionsInstance.address,
          deployedContracts.exchangeInstance.address,
        )

        oraclePrice = await getOraclePrice(provider)
        if (testParam.useMockExchange) {
          marketPrice = oraclePrice.multipliedBy(1 - testParam.oraclePriceDivergence)
          await deployedContracts.exchangeInstance.setPrice(
            marketPrice.multipliedBy(TEN.pow(18)).toFixed(0),
          )
        } else {
          marketPrice = await getMarketPrice(
            MAINNET_ADRESSES.WETH_ADDRESS,
            MAINNET_ADRESSES.MCD_DAI,
          )
        }

        initialSetupSnapshotId = await createSnapshot(provider)
        revertBlockNumber = await provider.getBlockNumber()
      })

      describe(`opening Multiply Vault with collateralisation ratio of ${testCase.desiredCDPState.desiredCollRatio}`, async function () {
        var txResult
        var startBalance

        this.beforeEach(async function () {
          backup(testCase)
        })
        this.afterEach(async function () {
          restore(testCase)
        })
        this.afterAll(async function () {
          await restoreSnapshot(provider, initialSetupSnapshotId)
        })

        this.beforeAll(async function () {
          startBalance = await deployedContracts.daiTokenInstance.balanceOf(
            ADDRESS_REGISTRY.feeRecepient,
          )
          const [debtDelta, collateralDelta] = calculateRequiredDebt(
            'mul',
            testCase.existingCDP,
            testCase.desiredCDPState,
            oraclePrice,
            marketPrice,
            testParam.slippage,
            testParam.debug,
          )

          validateDelta(debtDelta, collateralDelta)

          const { exchangeData, cdpData } = prepareBasicParams(
            testCase.gemAddress,
            debtDelta,
            collateralDelta,
            testCase.desiredCDPState.providedCollateral,
            testCase._1inchPayload,
            testCase.existingCDP,
            primarySignerAddress,
            false,
            MAINNET_ADRESSES,
          )

          await fillExchangeData(testParam, exchangeData, deployedContracts.exchangeInstance)

          const params = packMPAParams(cdpData, exchangeData, ADDRESS_REGISTRY)

          let status
          ;[status, txResult] = await dsproxyExecuteAction(
            deployedContracts.multiplyProxyActionsInstance,
            deployedContracts.dsProxyInstance,
            primarySignerAddress,
            'openMultiplyVault',
            params,
            amountToWei(testCase.desiredCDPState.providedCollateral),
          )
          if (!status) {
            restoreSnapshot.lock = true
            throw 'Tx failed'
            //throw txResult;
          }

          await updateLastCDPInfo(testCase, primarySigner, provider, userProxyAddr)
        })

        it(`it should open vault with collateralisation Ratio of ${testCase.desiredCDPState.desiredCollRatio}`, async function () {
          precision = 10
          var actualRatio = div(
            mul(testCase.existingCDP.coll, oraclePrice),
            testCase.existingCDP.debt,
          )
          var maxAcceptable = mul(testCase.desiredCDPState.desiredCollRatio, 1 + precision / 100)
          console.warn(`\x1b[33m ${precision}% margin for collateralisation ratio applied \x1b[0m`)
          console.warn(
            `\x1b[33m Vault params:Collateral ${testCase.existingCDP.coll}, Debt ${testCase.existingCDP.debt} \x1b[0m`,
          )
          expect(actualRatio.toNumber()).to.be.greaterThanOrEqual(
            testCase.desiredCDPState.desiredCollRatio,
          ) //final collaterallisation value equal to at least desired
          expect(actualRatio.toNumber()).to.be.lessThanOrEqual(maxAcceptable.toNumber()) //final collaterallisation is off not more than 5% from desired value
        })

        it(`it should flash loan correct amount of DAI`, async function () {
          precision = 0.1
          console.warn(`\x1b[33m${precision}% margin for collateralisation ratio applied\x1b[0m`)
          var allEvents = txResult.events.map((x) => {
            return {
              firstTopic: x.topics[0],
              topics: x.topics,
              data: x.data,

              name: x.name,
            }
          })

          var flDataEvent = allEvents.filter(
            (x) =>
              x.firstTopic === '0x9c6641b21946115d10f3f55df9bec5752ec06d40dc9250b1cc6560549764600e',
          )[0]
          var expected = amountToWei(testCase.existingCDP.debt).toNumber()
          var actual = new BigNumber(flDataEvent.topics[1], 16)
          actual = amountToWei(actual.dividedBy(TEN.pow(18))).toNumber()
          expect(actual).to.be.greaterThan(expected * (1 - precision))
        })

        it('it should send fee to beneficiary', async function () {
          precision = 1
          console.warn(`\x1b[33m${precision}% margin for collateralisation ratio applied\x1b[0m`)
          var allEvents = txResult.events.map((x) => {
            return {
              firstTopic: x.topics[0],
              topics: x.topics,
              data: x.data,
              name: x.name,
            }
          })
          var feePaidEvents = allEvents.filter(
            (x) =>
              x.firstTopic === '0x69e27f80547602d16208b028c44d20f25956e1fb7d0f51d62aa02f392426f371',
          )
          expect(feePaidEvents.length).to.be.deep.equal(1)
          var feeAmount = new BigNumber(feePaidEvents[0].data, 16)
          var expected = amountToWei(testCase.existingCDP.debt * OUR_FEE)
          endBalance = await deployedContracts.daiTokenInstance.balanceOf(
            ADDRESS_REGISTRY.feeRecepient,
          )
          var balanceDifference = endBalance.sub(startBalance).toString()
          expect(feeAmount.toNumber()).to.be.greaterThanOrEqual(
            expected.toNumber() * (1 - precision / 100),
          ) //due to possible rounding errors
          expect(feeAmount.toFixed(0)).to.be.equal(balanceDifference)
        })

        describe(`Increasing CollateralisationRatio from ${testCase.desiredCDPState.desiredCollRatio} to ${testParam.desiredCollRatio} without withdrawal`, async function () {
          var inTxResult = undefined
          var beforeTxBalance = undefined
          var internalSnapshotId
          this.beforeEach(async function () {
            backup(testCase)
          })
          this.afterEach(async function () {
            restore(testCase)
          })
          this.beforeAll(async function () {
            internalSnapshotId = await createSnapshot(provider)

            testCase.desiredCDPState.desiredCollRatio = testParam.desiredCollRatio
            testCase.desiredCDPState.providedCollateral = 0

            beforeTxBalance = await provider.getBalance(await primarySigner.getAddress())

            const [debtDelta, collateralDelta] = calculateRequiredDebt(
              'demul',
              testCase.existingCDP,
              testCase.desiredCDPState,
              oraclePrice,
              marketPrice,
              testParam.slippage,
              testParam.debug,
            )

            validateDelta(debtDelta, collateralDelta)

            const { exchangeData, cdpData } = prepareBasicParams(
              testCase.gemAddress,
              debtDelta,
              collateralDelta,
              0,
              testCase._1inchPayload,
              testCase.existingCDP,
              primarySignerAddress,
              true,
              MAINNET_ADRESSES,
            )

            await fillExchangeData(testParam, exchangeData, deployedContracts.exchangeInstance)
            const params = packMPAParams(cdpData, exchangeData, ADDRESS_REGISTRY)

            let status
            ;[status, inTxResult] = await dsproxyExecuteAction(
              deployedContracts.multiplyProxyActionsInstance,
              deployedContracts.dsProxyInstance,
              primarySignerAddress,
              'decreaseMultiple',
              params,
            )

            if (!status) {
              restoreSnapshot.lock = true
              throw 'Tx failed'
            }

            await updateLastCDPInfo(testCase, primarySigner, provider, userProxyAddr)
          })
          it(`should increase CollateralisationRatio to ${testParam.desiredCollRatio} `, async function () {
            var negativeMargin = 0.1
            var positiveMargin = 5
            const collRatio = div(
              mul(testCase.existingCDP.coll, oraclePrice),
              testCase.existingCDP.debt,
            ).toNumber()
            expect(collRatio).to.be.greaterThan(
              testParam.desiredCollRatio * (1 - negativeMargin / 100),
            ) //to accout for rounding errors
            expect(collRatio).to.be.lessThanOrEqual(
              testParam.desiredCollRatio * (1 + positiveMargin / 100),
            ) //due to slippage smaller than maximum we might end up with higher coll ratio
            console.warn(
              `\x1b[33m${positiveMargin}% positive and ${negativeMargin}% negative margin for collateralisation ratio applied actual Value ${collRatio}\x1b[0m`,
            )
          })
          it('should not change primaryAddress ETH balance, only by tx Costs', async function () {
            var after = await provider.getBalance(await primarySigner.getAddress())
            var gasUsed = parseFloat(inTxResult.cumulativeGasUsed.toString())

            var gasPrice = 1000000000
            var reminder = beforeTxBalance.sub(after).sub(gasUsed * gasPrice)
            expect(reminder).to.be.equal(0)
          })

          it('ProxyAction should have no DAI', async function () {
            let mpaAddress = deployedContracts.multiplyProxyActionsInstance.address
            var balance = await deployedContracts.daiTokenInstance.balanceOf(mpaAddress)
            expect(balance.toString()).to.be.equal('0')
          })
          it('dsProxy should have no DAI', async function () {
            let dsProxyAddress = deployedContracts.dsProxyInstance.address
            var balance = await deployedContracts.daiTokenInstance.balanceOf(dsProxyAddress)
            expect(balance.toString()).to.be.equal('0')
          })
          it('dsProxy should have no ETH', async function () {
            let dsProxyAddress = deployedContracts.dsProxyInstance.address
            var balance = await provider.getBalance(dsProxyAddress)
            expect(balance.toString()).to.be.equal('0')
          })
          it('ProxyAction should have no ETH', async function () {
            let mpaAddress = deployedContracts.multiplyProxyActionsInstance.address
            var balance = await provider.getBalance(mpaAddress)
            expect(balance.toString()).to.be.equal('0')
          })
          this.afterAll(async function () {
            await restoreSnapshot(provider, internalSnapshotId)
          })
        })

        describe(`Increasing CollateralisationRatio to ${testParam.desiredCollRatioDAI} with DAI withdrawal`, async function () {
          let daiBefore
          this.beforeEach(async function () {
            backup(testCase)
          })
          this.afterEach(async function () {
            restore(testCase)
          })
          this.beforeAll(async function () {
            daiBefore = await deployedContracts.daiTokenInstance.balanceOf(
              await primarySigner.getAddress(),
            )
            internalSnapshotId = await createSnapshot(provider)

            testCase.desiredCDPState.desiredCollRatio = testParam.desiredCollRatioDAI
            testCase.desiredCDPState.providedCollateral = 0

            beforeTxBalance = await provider.getBalance(await primarySigner.getAddress())

            const [debtDelta, collateralDelta] = calculateRequiredDebt(
              'demul',
              testCase.existingCDP,
              testCase.desiredCDPState,
              oraclePrice,
              marketPrice,
              testParam.slippage,
              testParam.debug,
              testParam.desiredDAI,
            )

            validateDelta(debtDelta, collateralDelta)

            const { exchangeData, cdpData } = prepareBasicParams(
              testCase.gemAddress,
              debtDelta,
              collateralDelta,
              0,
              testCase._1inchPayload,
              testCase.existingCDP,
              primarySignerAddress,
              true,
              MAINNET_ADRESSES,
            )

            cdpData.withdrawCollateral = 0
            cdpData.withdrawDai = amountToWei(testParam.desiredDAI).toFixed(0)

            await fillExchangeData(testParam, exchangeData, deployedContracts.exchangeInstance)

            const params = packMPAParams(cdpData, exchangeData, ADDRESS_REGISTRY)

            let status
            ;[status, inTxResult] = await dsproxyExecuteAction(
              deployedContracts.multiplyProxyActionsInstance,
              deployedContracts.dsProxyInstance,
              primarySignerAddress,
              'decreaseMultipleWithdrawDai',
              params,
            )
            if (!status) {
              restoreSnapshot.lock = true
              throw 'Tx failed'
              throw inTxResult
            }
            await updateLastCDPInfo(testCase, primarySigner, provider, userProxyAddr)
          })
          it(`should increase CollateralisationRatio to ${testParam.desiredCollRatioDAI}`, async function () {
            var negativeMargin = 0.1
            var positiveMargin = 5
            const collRatio = div(
              mul(testCase.existingCDP.coll, oraclePrice),
              testCase.existingCDP.debt,
            ).toNumber()
            expect(collRatio).to.be.greaterThan(
              testParam.desiredCollRatioDAI * (1 - negativeMargin / 100),
            ) //to accout for rounding errors
            expect(collRatio).to.be.lessThanOrEqual(
              testParam.desiredCollRatioDAI * (1 + positiveMargin / 100),
            ) //due to slippage smaller than maximum we might end up with higher coll ratio
            console.warn(
              `\x1b[33m${positiveMargin}% positive and ${negativeMargin}% negative margin for collateralisation ratio applied actual Value ${collRatio}\x1b[0m`,
            )
          })
          it(`should change primaryAddress DAI balance by exacly ${testParam.desiredDAI} DAI`, async function () {
            var balanceAfter = await deployedContracts.daiTokenInstance.balanceOf(
              await primarySigner.getAddress(),
            )

            var balanceIncrease = sub(balanceAfter.toString(), daiBefore.toString()).toFixed(0)

            expect(balanceIncrease).to.be.equal(amountToWei(testParam.desiredDAI).toFixed(0))
          })

          it('ProxyAction should have no DAI', async function () {
            let mpaAddress = deployedContracts.multiplyProxyActionsInstance.address
            var balance = await deployedContracts.daiTokenInstance.balanceOf(mpaAddress)
            expect(balance.toString()).to.be.equal('0')
          })
          it('dsProxy should have no DAI', async function () {
            let dsProxyAddress = deployedContracts.dsProxyInstance.address
            var balance = await deployedContracts.daiTokenInstance.balanceOf(dsProxyAddress)
            expect(balance.toString()).to.be.equal('0')
          })
          it('dsProxy should have no ETH', async function () {
            let dsProxyAddress = deployedContracts.dsProxyInstance.address
            var balance = await provider.getBalance(dsProxyAddress)
            expect(balance.toString()).to.be.equal('0')
          })
          it('ProxyAction should have no ETH', async function () {
            let mpaAddress = deployedContracts.multiplyProxyActionsInstance.address
            var balance = await provider.getBalance(mpaAddress)
            expect(balance.toString()).to.be.equal('0')
          })
          this.afterAll(async function () {
            await restoreSnapshot(provider, internalSnapshotId)
          })
        })

        describe(`Increasing CollateralisationRatio to ${testParam.desiredCollRatioETH} with Collateral withdrawal ${testParam.desiredETH} ETH`, async function () {
          var inTxResult = undefined
          var testCaseBackup = undefined
          var beforeTxBalance = undefined
          var daiBefore
          this.beforeEach(async function () {
            backup(testCase)
          })
          this.afterEach(async function () {
            restore(testCase)
          })
          this.beforeAll(async function () {
            daiBefore = await deployedContracts.daiTokenInstance.balanceOf(
              await primarySigner.getAddress(),
            )

            internalSnapshotId = await createSnapshot(provider)

            testCase.desiredCDPState.desiredCollRatio = testParam.desiredCollRatioETH
            testCase.desiredCDPState.providedCollateral = 0

            beforeTxBalance = await provider.getBalance(await primarySigner.getAddress())

            const [debtDelta, collateralDelta] = calculateRequiredDebt(
              'demul',
              testCase.existingCDP,
              testCase.desiredCDPState,
              oraclePrice,
              marketPrice,
              testParam.slippage,
              testParam.debug,
              0,
              testParam.desiredETH,
            )

            validateDelta(debtDelta, collateralDelta)

            const { exchangeData, cdpData } = prepareBasicParams(
              testCase.gemAddress,
              debtDelta,
              collateralDelta,
              0,
              testCase._1inchPayload,
              testCase.existingCDP,
              primarySignerAddress,
              true,
              MAINNET_ADRESSES,
            )

            cdpData.withdrawCollateral = amountToWei(testParam.desiredETH).toFixed(0)
            cdpData.withdrawDai = 0

            const params = packMPAParams(cdpData, exchangeData, ADDRESS_REGISTRY)

            await fillExchangeData(testParam, exchangeData, deployedContracts.exchangeInstance)
            let status
            ;[status, inTxResult] = await dsproxyExecuteAction(
              deployedContracts.multiplyProxyActionsInstance,
              deployedContracts.dsProxyInstance,
              primarySignerAddress,
              'decreaseMultipleWithdrawCollateral',
              params,
            )
            if (!status) {
              restoreSnapshot.lock = true
              throw 'Tx failed'
              throw inTxResult
            }
            await updateLastCDPInfo(testCase, primarySigner, provider, userProxyAddr)
          })
          it(`should increase CollateralisationRatio to ${testParam.desiredCollRatioETH} `, async function () {
            var negativeMargin = 0.1
            var positiveMargin = 5
            const collRatio = div(
              mul(testCase.existingCDP.coll, oraclePrice),
              testCase.existingCDP.debt,
            ).toNumber()
            expect(collRatio).to.be.greaterThan(
              testParam.desiredCollRatioDAI * (1 - negativeMargin / 100),
            ) //to accout for rounding errors
            expect(collRatio).to.be.lessThanOrEqual(
              testParam.desiredCollRatioDAI * (1 + positiveMargin / 100),
            ) //due to slippage smaller than maximum we might end up with higher coll ratio
            console.warn(
              `\x1b[33m${positiveMargin}% positive and ${negativeMargin}% negative margin for collateralisation ratio applied actual Value ${collRatio}\x1b[0m`,
            )
          })
          it(`should change primaryAddress ETH balance by exacly ${testParam.desiredETH} ETH, minus tx fees`, async function () {
            var after = await provider.getBalance(await primarySigner.getAddress())
            var gasUsed = parseFloat(inTxResult.cumulativeGasUsed.toString())

            var gasPrice = 1000000000
            var reminder = beforeTxBalance.sub(after).sub(gasUsed * gasPrice)
            expect(reminder.mul(-1)).to.be.equal(amountToWei(testParam.desiredETH).toFixed(0))
          })
          it(`should not change primaryAddress DAI balance`, async function () {
            var positiveMargin = 0.1

            var daiAfter = await deployedContracts.daiTokenInstance.balanceOf(
              await primarySigner.getAddress(),
            )

            var balanceIncrease = sub(daiAfter.toString(), daiBefore.toString()).toNumber()

            console.warn(
              `\x1b[33m${positiveMargin}% margin applied, ${
                balanceIncrease / Math.pow(10, 18)
              } returned, compared to Vault debt ${testCase.existingCDP.debt}\x1b[0m`,
            )

            expect(balanceIncrease).to.be.lessThan(
              amountToWei(testCase.existingCDP.debt * (positiveMargin / 100)).toNumber(),
            )
          })

          it('ProxyAction should have no DAI', async function () {
            let mpaAddress = deployedContracts.multiplyProxyActionsInstance.address
            var balance = await deployedContracts.daiTokenInstance.balanceOf(mpaAddress)
            expect(balance.toString()).to.be.equal('0')
          })
          it('dsProxy should have no DAI', async function () {
            let dsProxyAddress = deployedContracts.dsProxyInstance.address
            var balance = await deployedContracts.daiTokenInstance.balanceOf(dsProxyAddress)
            expect(balance.toString()).to.be.equal('0')
          })
          it('dsProxy should have no ETH', async function () {
            let dsProxyAddress = deployedContracts.dsProxyInstance.address
            var balance = await provider.getBalance(dsProxyAddress)
            expect(balance.toString()).to.be.equal('0')
          })
          it('ProxyAction should have no ETH', async function () {
            let mpaAddress = deployedContracts.multiplyProxyActionsInstance.address
            var balance = await provider.getBalance(mpaAddress)
            expect(balance.toString()).to.be.equal('0')
          })
          this.afterAll(async function () {
            await restoreSnapshot(provider, internalSnapshotId)
          })
        })

        describe('Close Vault, withdraw collateral', async function () {
          let closingVaultInfo
          let closedVaultInfo
          let beforeTxBalance
          let afterTxBalance
          let beneficiaryBefore
          let daiBefore
          let daiAfter
          this.beforeAll(async function () {
            await updateLastCDPInfo(testCase, primarySigner, provider, userProxyAddr);
            closingVaultInfo = testCase.existingCDP;
            console.log("closing CDP state 1",closingVaultInfo);
            beforeTxBalance = await provider.getBalance(await primarySigner.getAddress())

            daiBefore = await deployedContracts.daiTokenInstance.balanceOf(
              await primarySigner.getAddress(),
            )

            internalSnapshotId = await createSnapshot(provider)

            testCase.desiredCDPState.desiredCollRatio = 0
            testCase.desiredCDPState.providedCollateral = 0

            beforeTxBalance = await provider.getBalance(await primarySigner.getAddress())

            const [debtDelta, collateralDelta] = calculateRequiredDebt(
              'demul',
              testCase.existingCDP,
              testCase.desiredCDPState,
              oraclePrice,
              marketPrice,
              testParam.slippage,
              testParam.debug,
              0,
              0,
            )

            validateDelta(debtDelta, collateralDelta) //throws if not numbers

            const { exchangeData, cdpData } = prepareBasicParams(
              testCase.gemAddress,
              debtDelta,
              collateralDelta,
              0,
              testCase._1inchPayload,
              testCase.existingCDP,
              primarySignerAddress,
              true,
              MAINNET_ADRESSES,
            )

            cdpData.withdrawCollateral = 0
            cdpData.withdrawDai = 0

            exchangeData.toTokenAmount = ensureWeiFormat(
              mul(testCase.existingCDP.debt, add(add(1, AAVE_FEE), OUR_FEE)),
            )
            exchangeData.minToTokenAmount = ensureWeiFormat(
              mul(testCase.existingCDP.debt, add(add(1, AAVE_FEE), OUR_FEE)),
            )
            exchangeData.fromTokenAmount = ensureWeiFormat(
              div(exchangeData.toTokenAmount, mul(marketPrice, sub(1, testParam.slippage))),
            )

            cdpData.borrowCollateral = 0
            cdpData.requiredDebt = exchangeData.minToTokenAmount

            await fillExchangeData(testParam, exchangeData, deployedContracts.exchangeInstance)
            const params = packMPAParams(cdpData, exchangeData, ADDRESS_REGISTRY)
            beneficiaryBefore = await deployedContracts.daiTokenInstance.balanceOf(
              '0x79d7176aE8F93A04bC73b9BC710d4b44f9e362Ce',
            )

            let status
            ;[status, inTxResult] = await dsproxyExecuteAction(
              deployedContracts.multiplyProxyActionsInstance,
              deployedContracts.dsProxyInstance,
              primarySignerAddress,
              'closeVaultExitCollateral',
              params,
            )

            if (!status) {
              restoreSnapshot.lock = true
              throw 'Tx failed'
              throw inTxResult
            }

            await updateLastCDPInfo(testCase, primarySigner, provider, userProxyAddr)

            daiAfter = await deployedContracts.daiTokenInstance.balanceOf(
              await primarySigner.getAddress(),
            )

            afterTxBalance = await provider.getBalance(await primarySigner.getAddress())
            closedVaultInfo = testCase.existingCDP
          })
          it('should send to user all collateral in a vault minus debt', async function () {
            var gasUsed = parseFloat(inTxResult.cumulativeGasUsed.toString())

            var gasPrice = 1000000000
            var reminder = afterTxBalance.sub(beforeTxBalance).add(gasUsed * gasPrice)
            console.log(
              'balances',
              closingVaultInfo.coll.toFixed(4),
              closedVaultInfo.coll.toFixed(4),
              closingVaultInfo.debt.toFixed(4),
              closedVaultInfo.debt.toFixed(4),
            )
            var expectedReturnedAmount = sub(
              closingVaultInfo.coll,
              div(
                mul(closingVaultInfo.debt, add(add(add(1, testParam.slippage), AAVE_FEE), OUR_FEE)),
                marketPrice,
              ),
            )
            expectedReturnedAmount = amountToWei(expectedReturnedAmount)
            var ratio = div(reminder, expectedReturnedAmount)
            console.log(
              'Expected to actual Ratio:',
              ratio.toString(),
              ', Expected amount',
              expectedReturnedAmount.toFixed(0),
            )
            expect(ratio.toNumber()).to.be.lessThanOrEqual(1.02)
            expect(ratio.toNumber()).to.be.greaterThanOrEqual(0.98)
          })
          it('should send to user no DAI', async function () {
            expect(convertToBigNumber(daiBefore).toFixed(0)).to.be.equal(
              convertToBigNumber(daiAfter).toFixed(0),
            )
          })
          it('ProxyAction should have no DAI', async function () {
            let mpaAddress = deployedContracts.multiplyProxyActionsInstance.address
            var balance = await deployedContracts.daiTokenInstance.balanceOf(mpaAddress)
            expect(balance.toString()).to.be.equal('0')
          })
          it('dsProxy should have no DAI', async function () {
            let dsProxyAddress = deployedContracts.dsProxyInstance.address
            var balance = await deployedContracts.daiTokenInstance.balanceOf(dsProxyAddress)
            expect(balance.toString()).to.be.equal('0')
          })
          it('dsProxy should have no ETH', async function () {
            let dsProxyAddress = deployedContracts.dsProxyInstance.address
            var balance = await provider.getBalance(dsProxyAddress)
            expect(balance.toString()).to.be.equal('0')
          })
          it('ProxyAction should have no ETH', async function () {
            let mpaAddress = deployedContracts.multiplyProxyActionsInstance.address
            var balance = await provider.getBalance(mpaAddress)
            expect(balance.toString()).to.be.equal('0')
          })
          it('should collect fee', async function () {
            var beneficiaryAfter = await deployedContracts.daiTokenInstance.balanceOf(
              '0x79d7176aE8F93A04bC73b9BC710d4b44f9e362Ce',
            )
            console.log(OUR_FEE, closingVaultInfo.debt)
            var expectedFee = amountToWei(
              mul(
                OUR_FEE,
                mul(mul(closingVaultInfo.debt, add(1, AAVE_FEE)), add(1, testParam.slippage)),
              ),
            )
            var allEvents = inTxResult.events.map((x) => {
              return {
                firstTopic: x.topics[0],
                topics: x.topics,
                data: x.data,
                name: x.name,
              }
            })
            var feePaidEvents = allEvents.filter(
              (x) =>
                x.firstTopic ===
                '0x69e27f80547602d16208b028c44d20f25956e1fb7d0f51d62aa02f392426f371',
            )
            expect(feePaidEvents.length).to.be.deep.equal(1)
            var feeAmount = new BigNumber(feePaidEvents[0].data, 16)
            console.log('beneficiary diff', beneficiaryAfter.sub(beneficiaryBefore).toString()) //
            var diff = beneficiaryAfter.sub(beneficiaryBefore).toString()
            expect(diff).to.be.equal(feeAmount.toString())
            expect(expectedFee.toNumber()).to.be.equal(feeAmount.toNumber())
          })
          this.afterAll(async function () {
            await restoreSnapshot(provider, internalSnapshotId)
          })
        })
        describe("Close Vault, withdraw DAI", async function(){
          let closingVaultInfo
          let closedVaultInfo
          let beforeTxBalance
          let afterTxBalance
          let beneficiaryBefore
          let daiBefore
          let daiAfter
            this.beforeAll(async function(){
              
              await updateLastCDPInfo(testCase, primarySigner, provider, userProxyAddr);
              closingVaultInfo = testCase.existingCDP;
              beforeTxBalance = await provider.getBalance(await primarySigner.getAddress());
              
              daiBefore = await  deployedContracts.daiTokenInstance.balanceOf(await primarySigner.getAddress());
              console.log("Before DAI Balance")
              
              internalSnapshotId = await createSnapshot(provider);

              testCase.desiredCDPState.desiredCollRatio = 0;
              testCase.desiredCDPState.providedCollateral = 0;
            
              const [debtDelta, collateralDelta ]= calculateRequiredDebt('demul',
              testCase.existingCDP,
              testCase.desiredCDPState, 
              oraclePrice,
              marketPrice,
              testParams.slippage,
              testParams.debug,
              0,
              0,
              )

              validateDelta(debtDelta, collateralDelta) //throws if not numbers

              const { exchangeData, cdpData } = prepareBasicParams(
                testCase.gemAddress,
                debtDelta,
                collateralDelta,
                0,
                testCase._1inchPayload,
                testCase.existingCDP,
                primarySignerAddress,
                true,
                MAINNET_ADRESSES,
              )
  
              cdpData.withdrawCollateral = 0
              cdpData.withdrawDai = 0
  
              exchangeData.toTokenAmount = ensureWeiFormat(
                mul(testCase.existingCDP.debt, add(add(1, AAVE_FEE), OUR_FEE)),
              )
              exchangeData.minToTokenAmount = ensureWeiFormat(
                mul(testCase.existingCDP.debt, add(add(1, AAVE_FEE), OUR_FEE)),
              )
              exchangeData.fromTokenAmount = ensureWeiFormat(
                div(exchangeData.toTokenAmount, mul(marketPrice, sub(1, testParam.slippage))),
              )
  
              cdpData.borrowCollateral = 0
              cdpData.requiredDebt = exchangeData.minToTokenAmount
  
              await fillExchangeData(testParam, exchangeData, deployedContracts.exchangeInstance)
              const params = packMPAParams(cdpData, exchangeData, ADDRESS_REGISTRY)
              beneficiaryBefore = await deployedContracts.daiTokenInstance.balanceOf(
                '0x79d7176aE8F93A04bC73b9BC710d4b44f9e362Ce',
              )
  
              let status
              ;[status, inTxResult] = await dsproxyExecuteAction(
                deployedContracts.multiplyProxyActionsInstance,
                deployedContracts.dsProxyInstance,
                primarySignerAddress,
                'closeVaultExitDai',
                params,
              )
  
              if (!status) {
                restoreSnapshot.lock = true
                throw 'Tx failed'
              }
  
              await updateLastCDPInfo(testCase, primarySigner, provider, userProxyAddr)
  
              daiAfter = await deployedContracts.daiTokenInstance.balanceOf(
                await primarySigner.getAddress(),
              )
  
              afterTxBalance = await provider.getBalance(await primarySigner.getAddress());
              closedVaultInfo = testCase.existingCDP;

            })
            it("should send to user no ETH",async function(){
              var after = await provider.getBalance(await primarySigner.getAddress());
              var gasUsed = parseFloat(inTxResult.cumulativeGasUsed.toString());

              var gasPrice = 1000000000;
              var reminder = beforeTxBalance.sub(after).sub(gasUsed*gasPrice);
              expect(reminder).to.be.equal(0);
            })
            it("should send to user all DAI",async function(){
              let daiAfter = await  deployedContracts.daiTokenInstance.balanceOf(await primarySigner.getAddress());
              var actual =  sub(daiAfter,daiBefore);

              expected = amountToWei(sub(mul(closingVaultInfo.coll,marketPrice),closingVaultInfo.debt));
              console.log("closing CDP state",closedVaultInfo);
              console.log("Users DAI change:",actual.toFixed(0),"Vault amount:",expected.toFixed(0), "Market Price:",marketPrice.toFixed());
              expect(actual.toNumber()).to.be.equal(expected.toNumber());
            })
            it('ProxyAction should have no DAI', async function () {
              let mpaAddress = deployedContracts.multiplyProxyActionsInstance.address
              var balance = await deployedContracts.daiTokenInstance.balanceOf(mpaAddress)
              expect(balance.toString()).to.be.equal('0')
            })
            it('dsProxy should have no DAI', async function () {
              let dsProxyAddress = deployedContracts.dsProxyInstance.address
              var balance = await deployedContracts.daiTokenInstance.balanceOf(dsProxyAddress)
              expect(balance.toString()).to.be.equal('0')
            })
            it('dsProxy should have no ETH', async function () {
              let dsProxyAddress = deployedContracts.dsProxyInstance.address
              var balance = await provider.getBalance(dsProxyAddress)
              expect(balance.toString()).to.be.equal('0')
            })
            it('ProxyAction should have no ETH', async function () {
              let mpaAddress = deployedContracts.multiplyProxyActionsInstance.address
              var balance = await provider.getBalance(mpaAddress)
              expect(balance.toString()).to.be.equal('0')
            })
            this.afterAll(async function(){

              await restoreSnapshot(provider,internalSnapshotId);
            
            })
          })
      })
    })
  })
}
