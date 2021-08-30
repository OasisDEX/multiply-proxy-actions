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
  balanceOf,
  ONE,
} = require('./common/mcd-deployment-utils')
const { getMarketPrice, getCurrentBlockNumber } = require('./common/http_apis')

const {
  printAllERC20Transfers,
  findExchangeTransferEvent,
  getAddressesLabels,
  fillExchangeData,
  createSnapshot,
  restoreSnapshot,
  resetNetworkToBlock,
} = require('./common/integration/utils')

const {
  calculateParamsIncreaseMP,
  calculateParamsDecreaseMP,
  amountToWei,
  prepareBasicParams,
  packMPAParams,
  convertToBigNumber,
  add,
  sub,
  mul,
  div,
  ensureWeiFormat,
} = require('./common/params-calculation-utils')

const { default: BigNumber } = require('bignumber.js')
const { expect } = require('chai')
const { ethers } = require('hardhat')
const { zero } = require('./utils')

const AAVE_FEE = 0.0009
const BASE_SLIPPAGE = 0.08
const OUR_FEE = FEE / FEE_BASE

const ALLOWED_PROTOCOLS = ['UNISWAP_V3']
let blockNumber = process.env.BLOCK_NUMBER

var testVaults = [
  {
    existingCDP: undefined,
    gemAddress: MAINNET_ADRESSES.WETH_ADDRESS,
    _1inchPayload: {
      to: '0x111111111117dc0aa78b770fa6a738034120c302',
      data: '0x111111111117dc0aa78b770fa6a738034120c302',
    }, //irrelevant, for mock exchange just for encoding validation passing
    desiredCDPState: {
      desiredCollRatio: 2.0, //expected collateralisation Ratio after Vault creation
      providedCollateral: 14, // Amount of ETH used initialy
      providedDAI: 0,
    },
  },
  {
    existingCDP: undefined,
    gemAddress: MAINNET_ADRESSES.WETH_ADDRESS,
    _1inchPayload: {
      to: '0x111111111117dc0aa78b770fa6a738034120c302',
      data: '0x111111111117dc0aa78b770fa6a738034120c302',
    }, //irrelevant, for mock exchange just for encoding validation passing
    desiredCDPState: {
      desiredCollRatio: 5.0, //expected collateralisation Ratio after Vault creation
      providedCollateral: 50, // Amount of ETH used initialy
      providedDAI: 0,
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
    skipFL: false,
    printERC20Transfers: false,
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
    skipFL: false,
    printERC20Transfers: false,
    desiredCollRatio: 2.5, //collateralisation ratio after Multiply decrease
    desiredCollRatioDAI: 3.5, //collateralisation ratio after Multiply decrease with DAI withdraw
    desiredCollRatioETH: 3.5, //collateralisation ratio after Multiply decrease with ETH withdraw
    oraclePriceDivergence: 0, //difference between oracle price and market price, <0,1> marketPrice = (1-x)*oraclePrice
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
    desiredDAI: 100, //amount of dai withdrawn in decreaseMultipleWithdrawDai
    desiredETH: 1, //amount of dai  withdrawn in decreaseMultipleWithdrawCollateral
    useMockExchange: false,
    debug: true,
    skipFL: true,
    printERC20Transfers: false,
    desiredCollRatio: 5.1, //collateralisation ratio after Multiply decrease
    desiredCollRatioDAI: 5.2, //collateralisation ratio after Multiply decrease with DAI withdraw
    desiredCollRatioETH: 5.2, //collateralisation ratio after Multiply decrease with ETH withdraw
    oraclePriceDivergence: 0, //difference between oracle price and market price, <0,1> marketPrice = (1-x)*oraclePrice
  },
]

async function runner(tasks) {
  for (var i = 0; i < tasks.length; i++) {
    await tasks[i]
  }
}

runner([
  // testCaseDefinition(testVaults[0], testParams[0]),
  testCaseDefinition(testVaults[0], testParams[1]),
  testCaseDefinition(testVaults[0], testParams[2]),
  //  testCaseDefinition(testVaults[0], testParams[3]),
  //testCaseDefinition(testVaults[0],testParams[0])
  // runTestCase(testVaults[0],OracleMarketDifference)
  testCaseDefinition(testVaults[1], testParams[4]),//skipFL == true on small operations 
])

async function testCaseDefinition(testCase, testParam) {
  var provider
  provider = new ethers.providers.JsonRpcProvider()

  testCase = JSON.parse(JSON.stringify(testCase)) //break reference
  testParam = JSON.parse(JSON.stringify(testParam))

  return new Promise((res, rej) => {
    //to run several in runner, one after another

    describe(`Proxy Action, oracleDivergence = ${
      testParam.useMockExchange ? testParam.oraclePriceDivergence * 100 : 0
    } % slippage ${testParam.slippage} skipFL=${testParam.skipFL}`, async function () {
      this.afterAll(async function () {
        res(true) //resolves Promise
      })

      var primarySigner
      var primarySignerAddress

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

      function addBalanceCheckingAssertions(_it, useMockExchange) {
        _it('ProxyAction should have no DAI', async function () {
          let mpaAddress = await deployedContracts.multiplyProxyActionsInstance.address
          var balance = await balanceOf(MAINNET_ADRESSES.MCD_DAI, mpaAddress)
          expect(convertToBigNumber(balance).toFixed(0)).to.be.equal('0')
        })
        _it('ProxyAction should have no ETH', async function () {
          let mpaAddress = await deployedContracts.multiplyProxyActionsInstance.address
          var balance = await provider.getBalance(mpaAddress)
          expect(convertToBigNumber(balance).toFixed(0)).to.be.equal('0')
        })
        _it('ProxyAction should have no WETH', async function () {
          let mpaAddress = await deployedContracts.multiplyProxyActionsInstance.address
          var balance = await balanceOf(
            MAINNET_ADRESSES.ETH,
            mpaAddress,
          )
          expect(convertToBigNumber(balance).toFixed(0)).to.be.equal('0')
        })
        _it('dsProxy should have no DAI', async function () {
          let dsProxyAddress = await deployedContracts.dsProxyInstance.address
          var balance = await balanceOf(MAINNET_ADRESSES.MCD_DAI, dsProxyAddress)
          expect(convertToBigNumber(balance).toFixed(0)).to.be.equal('0')
        })
        _it('dsProxy should have no ETH', async function () {
          let dsProxyAddress = await deployedContracts.dsProxyInstance.address
          var balance = await provider.getBalance(dsProxyAddress)
          expect(convertToBigNumber(balance).toFixed(0)).to.be.equal('0')
        })
        _it('dsProxy should have no WETH', async function () {
          let dsProxyAddress = await deployedContracts.dsProxyInstance.address
          var balance = await balanceOf(
            MAINNET_ADRESSES.ETH,
            dsProxyAddress,
          )
          expect(convertToBigNumber(balance).toFixed(0)).to.be.equal('0')
        })
        if (useMockExchange == false) {
          _it('exchange should have no DAI', async function () {
            let addressToCheck = await deployedContracts.exchangeInstance.address
            var balance = await balanceOf(
              MAINNET_ADRESSES.MCD_DAI,
              addressToCheck,
            )
            expect(convertToBigNumber(balance).toFixed(0)).to.be.equal('0')
          })
          _it('exchange should have no ETH', async function () {
            let addressToCheck = deployedContracts.exchangeInstance.address
            var balance = await provider.getBalance(addressToCheck)
            expect(convertToBigNumber(balance).toFixed(0)).to.be.equal('0')
          })
          _it('exchange should have no WETH', async function () {
            let addressToCheck = deployedContracts.exchangeInstance.address
            var balance = await balanceOf(
              MAINNET_ADRESSES.ETH,
              addressToCheck,
            )
            expect(convertToBigNumber(balance).toFixed(0)).to.be.equal('0')
          })
        }
      }

      const getSignerWithDetails = async function (provider) {
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
        withdrawDai = 0,
        withdrawColl = 0,
      ) {
        let debtDelta
        let exchangeMinAmount
        let currentColl = sub(
          add(existingCDP ? existingCDP.coll : 0, desiredCDPState.providedCollateral),
          withdrawColl,
        )
        let currentDebt = add(existingCDP && existingCDP.debt ? existingCDP.debt : 0, withdrawDai)

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
            desiredCDPState.providedDAI,
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
            zero,
            debug,
          )
        }

        if (
          debtDelta == undefined ||
          exchangeMinAmount == undefined ||
          !BigNumber.isBigNumber(debtDelta) ||
          !BigNumber.isBigNumber(exchangeMinAmount)
        ) {
          console.log(debtDelta, exchangeMinAmount)
          throw 'calculateRequiredDebt incorrect'
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

      this.beforeAll(async function () {
        if (blockNumber == 0 || testParam.useMockExchange == false) {
          blockNumber = await getCurrentBlockNumber()
        }
       // await resetNetworkToBlock(provider, blockNumber - 6)
        await getSignerWithDetails(provider)

        deployedContracts = await deploySystem(
          provider,
          primarySigner,
          testParam.useMockExchange,
          testParam.debug,
        )
        userProxyAddr = deployedContracts.dsProxyInstance.address
        ADDRESS_REGISTRY = addressRegistryFactory(
          deployedContracts.multiplyProxyActionsInstance.address,
          deployedContracts.exchangeInstance.address,
        )

        ADDRESS_REGISTRY.feeRecepient =
          await deployedContracts.exchangeInstance.feeBeneficiaryAddress()
        
        if(testParam.skipFL == true){
          ADDRESS_REGISTRY.aaveLendingPoolProvider = ADDRESS_REGISTRY.feeRecepient;//some correct address that do not have FL functionality
        }

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
            18,
            18,
          )
        }

        initialSetupSnapshotId = await createSnapshot(provider)
        revertBlockNumber = await provider.getBlockNumber()
      })

      describe(`opening Multiply Vault with collateralisation ratio of ${testCase.desiredCDPState.desiredCollRatio}`, async function () {
        var txResult
        var startBalance

        this.afterAll(async function () {
          await restoreSnapshot(provider, initialSetupSnapshotId)
        })

        this.beforeAll(async function () {
          startBalance = await balanceOf(
            MAINNET_ADRESSES.MCD_DAI,
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
            OUR_FEE,
            ALLOWED_PROTOCOLS,
          )

          const params = packMPAParams(cdpData, exchangeData, ADDRESS_REGISTRY)

          let status
          cdpData.skipFL = testParam.skipFL;
          ;[status, txResult] = await dsproxyExecuteAction(
            deployedContracts.multiplyProxyActionsInstance,
            deployedContracts.dsProxyInstance,
            primarySignerAddress,
            'openMultiplyVault',
            params,
            amountToWei(testCase.desiredCDPState.providedCollateral),
          )
          if (testParam.printERC20Transfers) {
            var labels = getAddressesLabels(
              deployedContracts,
              ADDRESS_REGISTRY,
              MAINNET_ADRESSES,
              primarySignerAddress,
            )
            printAllERC20Transfers(txResult, labels)
          }
          if (!status) {
            restoreSnapshot.lock = true //If tx fails throws immediatelly and prevent snalshot revert in AfterAll hook
            throw 'Tx failed'
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
          /*    console.warn(
            `\x1b[33m Vault params:Collateral ${testCase.existingCDP.coll}, Debt ${testCase.existingCDP.debt} \x1b[0m`,
          )*/
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
          let abi = [ "event FLData(uint256 borrowed, uint256 due)" ];
          let iface = new ethers.utils.Interface(abi);

          var flDataEvent = iface.parseLog(allEvents.filter(
            (x) =>
              x.firstTopic === '0x9c6641b21946115d10f3f55df9bec5752ec06d40dc9250b1cc6560549764600e',
          )[0]);
          var expected = amountToWei(testCase.existingCDP.debt);
          var actual = new BigNumber(flDataEvent.args.due.toString());
          actual = amountToWei(actual.dividedBy(TEN.pow(18)));
          expect(actual.gt(expected.multipliedBy(0.98))).to.be.equal(true);
          expect(expected.gt(actual.multipliedBy(0.98))).to.be.equal(true);
          
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
              x.firstTopic === '0x075a2720282fdf622141dae0b048ef90a21a7e57c134c76912d19d006b3b3f6f',
          )
          console.log("Events count",allEvents.length);
          expect(feePaidEvents.length).to.be.deep.equal(1)
          var feeAmount = new BigNumber(feePaidEvents[0].data, 16)
          var expected = amountToWei(testCase.existingCDP.debt * OUR_FEE)
          endBalance = await balanceOf(
            MAINNET_ADRESSES.MCD_DAI,
            ADDRESS_REGISTRY.feeRecepient,
          )
          var balanceDifference = endBalance.sub(startBalance).toString()
          expect(feeAmount.toNumber()).to.be.greaterThanOrEqual(
            expected.toNumber() * (1 - precision / 100),
          ) //due to possible rounding errors
          expect(feeAmount.toFixed(0)).to.be.equal(balanceDifference)
        })

        describe(`Decrease Multiple to coll ratio of ${testCase.desiredCDPState.desiredCollRatio} to ${testParam.desiredCollRatio} without withdrawal`, async function () {
          var inTxResult = undefined
          var beforeTxBalance = undefined
          var internalSnapshotId
          var testCaseCopy
          this.beforeAll(async function () {
            internalSnapshotId = await createSnapshot(provider)

            testCaseCopy = JSON.parse(JSON.stringify(testCase))

            testCaseCopy.desiredCDPState.desiredCollRatio = testParam.desiredCollRatio
            testCaseCopy.desiredCDPState.providedCollateral = 0

            beforeTxBalance = await provider.getBalance(await primarySigner.getAddress())

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

            let status
            cdpData.skipFL = testParam.skipFL;
            ;[status, inTxResult] = await dsproxyExecuteAction(
              deployedContracts.multiplyProxyActionsInstance,
              deployedContracts.dsProxyInstance,
              primarySignerAddress,
              'decreaseMultiple',
              params,
            )
            if (testParam.printERC20Transfers) {
              var labels = getAddressesLabels(
                deployedContracts,
                ADDRESS_REGISTRY,
                MAINNET_ADRESSES,
                primarySignerAddress,
              )
              printAllERC20Transfers(inTxResult, labels)
            }
            if (!status) {
              restoreSnapshot.lock = true
              throw 'Tx failed'
            }

            await updateLastCDPInfo(testCaseCopy, primarySigner, provider, userProxyAddr)
          })
          it(`should increase CollateralisationRatio to ${testParam.desiredCollRatio} `, async function () {
            var negativeMargin = 0.1
            var positiveMargin = 5
            const collRatio = div(
              mul(testCaseCopy.existingCDP.coll, oraclePrice),
              testCaseCopy.existingCDP.debt,
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

          addBalanceCheckingAssertions(it, testParam.useMockExchange, deployedContracts)
          this.afterAll(async function () {
            await restoreSnapshot(provider, internalSnapshotId)
          })
        })

        describe(`Decrease Multiple to coll ratio of ${testParam.desiredCollRatioDAI} with DAI withdrawal (${testParam.desiredDAI} DAI)`, async function () {
          let daiBefore
          let testCaseCopy
          this.beforeAll(async function () {
            daiBefore = await balanceOf(
              MAINNET_ADRESSES.MCD_DAI,
              await primarySigner.getAddress(),
            )
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

            beforeTxBalance = await provider.getBalance(await primarySigner.getAddress())

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
            cdpData.withdrawDai = amountToWei(testParam.desiredDAI).toFixed(0)

            await fillExchangeData(
              testParam,
              exchangeData,
              deployedContracts.exchangeInstance,
              ALLOWED_PROTOCOLS,
            )

            const params = packMPAParams(cdpData, exchangeData, ADDRESS_REGISTRY)

            let status
            cdpData.skipFL = testParam.skipFL;
            ;[status, inTxResult] = await dsproxyExecuteAction(
              deployedContracts.multiplyProxyActionsInstance,
              deployedContracts.dsProxyInstance,
              primarySignerAddress,
              'decreaseMultipleWithdrawDai',
              params,
            )
            if (testParam.printERC20Transfers) {
              var labels = getAddressesLabels(
                deployedContracts,
                ADDRESS_REGISTRY,
                MAINNET_ADRESSES,
                primarySignerAddress,
              )
              printAllERC20Transfers(inTxResult, labels)
            }
            if (!status) {
              restoreSnapshot.lock = true
              throw 'Tx failed'
            }
            if (testParam.debug) {
              console.log(
                'Ratio check before',
                testCaseCopy.existingCDP,
                convertToBigNumber(oraclePrice).toFixed(3),
              )
            }
            await updateLastCDPInfo(testCaseCopy, primarySigner, provider, userProxyAddr)
          })
          it(`should increase CollateralisationRatio to ${testParam.desiredCollRatioDAI}`, async function () {
            var negativeMargin = 0.1
            var positiveMargin = 5

            if (testParam.debug) {
              console.log(
                'Ratio check after',
                testCaseCopy.existingCDP,
                convertToBigNumber(oraclePrice).toFixed(3),
              )
            }
            const collRatio = div(
              mul(testCaseCopy.existingCDP.coll, oraclePrice),
              testCaseCopy.existingCDP.debt,
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
            var balanceAfter = await balanceOf(
              MAINNET_ADRESSES.MCD_DAI,
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

            var balanceIncrease = sub(balanceAfter.toString(), daiBefore.toString()).toFixed(0)

            expect(balanceIncrease).to.be.equal(amountToWei(testParam.desiredDAI).toFixed(0))
          })
          addBalanceCheckingAssertions(it, testParam.useMockExchange, deployedContracts)
          this.afterAll(async function () {
            await restoreSnapshot(provider, internalSnapshotId)
          })
        })

        describe(`Decrease Multiple to coll ratio of ${testParam.desiredCollRatioETH} with Collateral withdrawal ${testParam.desiredETH} ETH`, async function () {
          var inTxResult = undefined
          var beforeTxBalance = undefined
          var daiBefore
          let actualSwappedAmount
          let minAcceptableAmount
          let testCaseCopy

          this.beforeAll(async function () {
            daiBefore = await balanceOf(
              MAINNET_ADRESSES.MCD_DAI,
              await primarySigner.getAddress(),
            )

            internalSnapshotId = await createSnapshot(provider)

            testCaseCopy = JSON.parse(JSON.stringify(testCase))

            testCaseCopy.desiredCDPState.desiredCollRatio = testParam.desiredCollRatioETH
            testCaseCopy.desiredCDPState.providedCollateral = 0

            beforeTxBalance = await provider.getBalance(await primarySigner.getAddress())

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

            cdpData.withdrawCollateral = amountToWei(testParam.desiredETH).toFixed(0)
            cdpData.withdrawDai = 0

            const params = packMPAParams(cdpData, exchangeData, ADDRESS_REGISTRY)

            await fillExchangeData(
              testParam,
              exchangeData,
              deployedContracts.exchangeInstance,
              ALLOWED_PROTOCOLS,
            )
            let status
            minAcceptableAmount = exchangeData.minToTokenAmount
            cdpData.skipFL = testParam.skipFL;
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
            }

            if(testParam.skipFL == false){
              actualSwappedAmount = findExchangeTransferEvent(
                deployedContracts.exchangeInstance.address,
                deployedContracts.multiplyProxyActionsInstance.address,
                inTxResult,
              )
            }else{
              actualSwappedAmount = findExchangeTransferEvent(
                deployedContracts.exchangeInstance.address,
                deployedContracts.userProxyAddress,
                inTxResult,
              )
            }

            if (testParam.printERC20Transfers) {
              var labels = getAddressesLabels(
                deployedContracts,
                ADDRESS_REGISTRY,
                MAINNET_ADRESSES,
                primarySignerAddress,
              )
              printAllERC20Transfers(inTxResult, labels)
            }
            await updateLastCDPInfo(testCaseCopy, primarySigner, provider, userProxyAddr)
          })
          it(`should increase CollateralisationRatio to ${testParam.desiredCollRatioETH} `, async function () {
            var negativeMargin = 0.1
            var positiveMargin = 5
            const collRatio = div(
              mul(testCaseCopy.existingCDP.coll, oraclePrice),
              testCaseCopy.existingCDP.debt,
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
          it(`should change primaryAddress DAI balance only due to not maximum slippage`, async function () {
            let precision = 2
            var daiAfter = await balanceOf(
              MAINNET_ADRESSES.MCD_DAI,
              await primarySigner.getAddress(),
            )

            var balanceIncrease = sub(daiAfter.toString(), daiBefore.toString()).toNumber()
            var swapDifference = sub(actualSwappedAmount, minAcceptableAmount).toNumber()

            console.warn(
              `\x1b[33m ${precision}% margin for surplus DAI amounts, actual ratio ${
                balanceIncrease / swapDifference
              } \x1b[0m`,
            )
            expect(balanceIncrease / swapDifference).to.be.lessThan(1.0 + precision / 100)
            expect(balanceIncrease / swapDifference).to.be.greaterThan(1.0 - precision / 100)
          })
          addBalanceCheckingAssertions(it, testParam.useMockExchange, deployedContracts)
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
          let minTokenAmount
          let actualSwappedAmount
          let testCaseCopy
          this.beforeAll(async function () {
            await updateLastCDPInfo(testCase, primarySigner, provider, userProxyAddr)
            closingVaultInfo = testCase.existingCDP
            console.log("CDP state before",closingVaultInfo);
            beforeTxBalance = await provider.getBalance(await primarySigner.getAddress())

            daiBefore = await balanceOf(
              MAINNET_ADRESSES.MCD_DAI,
              await primarySigner.getAddress(),
            )

            internalSnapshotId = await createSnapshot(provider)

            testCaseCopy = JSON.parse(JSON.stringify(testCase))

            testCaseCopy.desiredCDPState.desiredCollRatio = 0
            testCaseCopy.desiredCDPState.providedCollateral = 0

            beforeTxBalance = await provider.getBalance(await primarySigner.getAddress())

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
              mul(mul(testCaseCopy.existingCDP.debt, add(add(1, AAVE_FEE), OUR_FEE)),add(1, testParam.slippage)),
            )
            exchangeData.minToTokenAmount = ensureWeiFormat(
              mul(testCaseCopy.existingCDP.debt, add(add(1, AAVE_FEE), OUR_FEE)),
            )
            exchangeData.fromTokenAmount = ensureWeiFormat(
              div(exchangeData.toTokenAmount, mul(marketPrice, sub(1, testParam.slippage))),
            )


            minTokenAmount = exchangeData.minToTokenAmount;

            cdpData.borrowCollateral = ensureWeiFormat(testCaseCopy.existingCDP.coll );
            cdpData.requiredDebt = exchangeData.minToTokenAmount

            await fillExchangeData(
              testParam,
              exchangeData,
              deployedContracts.exchangeInstance,
              ALLOWED_PROTOCOLS,
            )
            const params = packMPAParams(cdpData, exchangeData, ADDRESS_REGISTRY)
            beneficiaryBefore = await balanceOf(
              MAINNET_ADRESSES.MCD_DAI,
              '0x79d7176aE8F93A04bC73b9BC710d4b44f9e362Ce',
            )

            let status
            cdpData.skipFL = testParam.skipFL;
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
            }
            if(testParam.skipFL == false){
              actualSwappedAmount = findExchangeTransferEvent(
                deployedContracts.exchangeInstance.address,
                deployedContracts.multiplyProxyActionsInstance.address,
                inTxResult,
              )
            }else{
              actualSwappedAmount = findExchangeTransferEvent(
                deployedContracts.exchangeInstance.address,
                deployedContracts.userProxyAddress,
                inTxResult,
              )
            }

            if (testParam.printERC20Transfers) {
              var labels = getAddressesLabels(
                deployedContracts,
                ADDRESS_REGISTRY,
                MAINNET_ADRESSES,
                primarySignerAddress,
              )
              printAllERC20Transfers(inTxResult, labels)
            }

            await updateLastCDPInfo(testCaseCopy, primarySigner, provider, userProxyAddr)

            daiAfter = await balanceOf(
              MAINNET_ADRESSES.MCD_DAI,
              await primarySigner.getAddress(),
            )

            afterTxBalance = await provider.getBalance(await primarySigner.getAddress())
            closedVaultInfo = testCaseCopy.existingCDP
          })
          it('should send to user all collateral in a vault minus debt', async function () {
            var gasUsed = parseFloat(inTxResult.cumulativeGasUsed.toString())

            var gasPrice = 1000000000
            var reminder = afterTxBalance.sub(beforeTxBalance).add(gasUsed * gasPrice)

            var expectedReturnedAmount = sub(
              closingVaultInfo.coll,
              div(
                mul(closingVaultInfo.debt, add(add(add(1, testParam.slippage), AAVE_FEE), OUR_FEE)),
                marketPrice,
              ),
            )
            expectedReturnedAmount = amountToWei(expectedReturnedAmount)
            var ratio = div(reminder, expectedReturnedAmount)
            expect(ratio.toNumber()).to.be.lessThanOrEqual(1.02)
            expect(ratio.toNumber()).to.be.greaterThanOrEqual(0.98)
          })
          it('should send to user no more DAI than positive slippage', async function () {
            var expected = sub(add(daiBefore, actualSwappedAmount), minTokenAmount).toFixed(0)
            console.log(expected,daiAfter, daiBefore);
            var ratio = div(sub(daiAfter, daiBefore), sub(expected, daiBefore))
            expect(ratio.toNumber()).to.be.lessThan(1.01)
            expect(ratio.toNumber()).to.be.greaterThan(0.99)
          })
          addBalanceCheckingAssertions(it, testParam.useMockExchange, deployedContracts)
          it('should collect fee', async function () {
            var beneficiaryAfter = await balanceOf(
              MAINNET_ADRESSES.MCD_DAI,
              ADDRESS_REGISTRY.feeRecepient,
            )
            //       console.log(OUR_FEE, closingVaultInfo.debt)
            var expectedFee =
              //TODO: review that calculation
              div(mul(OUR_FEE, actualSwappedAmount), sub(ONE, OUR_FEE))
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
            //    console.log('beneficiary diff', beneficiaryAfter.sub(beneficiaryBefore).toString()) //
            var diff = beneficiaryAfter.sub(beneficiaryBefore).toString()
            expect(diff).to.be.equal(feeAmount.toString())
            expect(expectedFee.toNumber()).to.be.lessThan(1.01 * feeAmount.toNumber())
            expect(expectedFee.toNumber()).to.be.greaterThan(0.99 * feeAmount.toNumber())
          })
          this.afterAll(async function () {
            await restoreSnapshot(provider, internalSnapshotId)
          })
        })
        describe('Close Vault, withdraw DAI', async function () {
          if(testParam.skipFL){
            return;
          }
          let closingVaultInfo
          let closedVaultInfo
          let beforeTxBalance
          let afterTxBalance
          let beneficiaryBefore
          let daiBefore
          let daiAfter
          let testCaseCopy
          this.beforeAll(async function () {
            await updateLastCDPInfo(testCase, primarySigner, provider, userProxyAddr)
            closingVaultInfo = testCase.existingCDP
            beforeTxBalance = await provider.getBalance(await primarySigner.getAddress())

            daiBefore = await balanceOf(
              MAINNET_ADRESSES.MCD_DAI,
              await primarySigner.getAddress(),
            )
            //console.log('Before DAI Balance', daiBefore.toString())

            internalSnapshotId = await createSnapshot(provider)
            testCaseCopy = JSON.parse(JSON.stringify(testCase))

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

            exchangeData.fromTokenAmount = ensureWeiFormat(testCaseCopy.existingCDP.coll );

            let worstPossibleDaiValueOfExistingCollateral = mul(testCaseCopy.existingCDP.coll,mul(marketPrice,sub(1,testParam.slippage)));
            
            daiOutAfterOF = mul(worstPossibleDaiValueOfExistingCollateral,sub(1,OUR_FEE))

            exchangeData.minToTokenAmount =  ensureWeiFormat(daiOutAfterOF);

            exchangeData.toTokenAmount = ensureWeiFormat(div(exchangeData.minToTokenAmount,sub(1,testParam.slippage)));


            cdpData.borrowCollateral = ensureWeiFormat(testCaseCopy.existingCDP.coll );
            cdpData.requiredDebt =  ensureWeiFormat(mul(testCaseCopy.existingCDP.debt,1.0001));

            await fillExchangeData(
              testParam,
              exchangeData,
              deployedContracts.exchangeInstance,
              ALLOWED_PROTOCOLS,
            )
            const params = packMPAParams(cdpData, exchangeData, ADDRESS_REGISTRY)
            
            beneficiaryBefore = await balanceOf(
              MAINNET_ADRESSES.MCD_DAI,
              ADDRESS_REGISTRY.feeRecepient,
            )

            let status
            cdpData.skipFL = testParam.skipFL;
            ;[status, inTxResult] = await dsproxyExecuteAction(
              deployedContracts.multiplyProxyActionsInstance,
              deployedContracts.dsProxyInstance,
              primarySignerAddress,
              'closeVaultExitDai',
              params,
            )
            if (testParam.printERC20Transfers) {
              var labels = getAddressesLabels(
                deployedContracts,
                ADDRESS_REGISTRY,
                MAINNET_ADRESSES,
                primarySignerAddress,
              )
              printAllERC20Transfers(inTxResult, labels)
            }
            if (!status) {
              restoreSnapshot.lock = true
              console.log(inTxResult);
              throw 'Tx failed'
            }

            await updateLastCDPInfo(testCaseCopy, primarySigner, provider, userProxyAddr)

            daiAfter = await balanceOf(
              MAINNET_ADRESSES.MCD_DAI,
              await primarySigner.getAddress(),
            )

            afterTxBalance = await provider.getBalance(await primarySigner.getAddress())
            closedVaultInfo = testCaseCopy.existingCDP
          })
          it('should send to user no ETH', async function () {
            var after = await provider.getBalance(await primarySigner.getAddress())
            var gasUsed = parseFloat(inTxResult.cumulativeGasUsed.toString())

            var gasPrice = 1000000000
            var reminder = beforeTxBalance.sub(after).sub(gasUsed * gasPrice)
            expect(reminder).to.be.equal(0)
          })
          it('should send to user all DAI', async function () {
            let daiAfter = await balanceOf(
              MAINNET_ADRESSES.MCD_DAI,
              await primarySigner.getAddress(),
            )
            var actual = sub(daiAfter, daiBefore)

            expected = amountToWei(
              sub(mul(closingVaultInfo.coll, marketPrice), closingVaultInfo.debt),
            ) //do not take fees into account, but assert gives 10% tollerance which is way more than all fees and slippage
            if (testParam.debug) {
              console.log(
                'Users DAI change:',
                actual.toFixed(0),
                'Vault amount:',
                expected.toFixed(0),
                'Market Price:',
                marketPrice.toFixed(),
                'Collateral before',
                closingVaultInfo.coll,
                'Debt before',
                closingVaultInfo.debt,
                'marketPrice',
                marketPrice.toString(),
              )
            }

            expect(actual.toNumber()).to.be.greaterThan(0.9 * expected.toNumber())
          })
          addBalanceCheckingAssertions(it, testParam.useMockExchange, deployedContracts)
          this.afterAll(async function () {
            await restoreSnapshot(provider, internalSnapshotId)
          })
        })
      })
    })
  })
}
