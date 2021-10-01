const {
  deploySystem,
  ONE,
  TEN,
  getOraclePrice,
  dsproxyExecuteAction,
  getLastCDP,
  getVaultInfo,
  balanceOf,
  MAINNET_ADRESSES,
  FEE_BASE,
} = require('../test/common/mcd-deployment-utils')
const { getMarketPrice, exchangeFromDAI } = require('../test/common/http_apis')
const {
  calculateParamsIncreaseMP,
  amountToWei,
  prepareMultiplyParameters,
  addressRegistryFactory,
  convertToBigNumber,
} = require('../test/common/params-calculation-utils')
const { default: BigNumber } = require('bignumber.js')
const { expect } = require('chai')
const { ethers } = require('hardhat')

function lookupEventByHash(events, eventHash) {
  return events.filter((x) => x.firstTopic === eventHash)
}

describe('Proxy Action', async function () {
  let primaryAddress
  let primaryAddressAdr
  let provider
  let mcdViewInstance
  let exchangeInstance, multiplyProxyActionsInstance, dsProxyInstance, userProxyAddr
  let initialSetupSnapshotId
  let ADDRESS_REGISTRY
  const baseCollateralAmountInETH = new BigNumber(10)
  const AAVE_FEE = 0.0009
  const BASE_SLIPPAGE = new BigNumber(0.08)
  const OUR_FEE = 0.0003 // todo: fetch it from exchange once implemented
  let oraclePrice
  let marketPrice

  let testCases = [
    {
      desiredCollRatio: 3,
      currentDebt: 0,
      slippage: BASE_SLIPPAGE,
      _1inchPayload: undefined,
      desiredCDPState: {
        currentColl: 0,
        providedCollateral: baseCollateralAmountInETH,
      },
    },
    {
      desiredCollRatio: 1.7,
      currentDebt: 0,
      slippage: BASE_SLIPPAGE,
      _1inchPayload: undefined,
      desiredCDPState: {
        currentColl: 0,
        providedCollateral: baseCollateralAmountInETH,
      },
    },
  ]

  this.beforeAll(async function () {
    provider = new ethers.providers.JsonRpcProvider()

    provider.send('hardhat_reset', [
      {
        forking: {
          jsonRpcUrl: process.env.ALCHEMY_NODE,
          blockNumber: 12763570,
        },
      },
    ])

    primaryAddress = await provider.getSigner(0)
    primaryAddressAdr = await primaryAddress.getAddress()

    let deployedContracts = await deploySystem(provider, primaryAddress, true)
    mcdViewInstance = deployedContracts.mcdViewInstance
    exchangeInstance = deployedContracts.exchangeInstance
    multiplyProxyActionsInstance = deployedContracts.multiplyProxyActionsInstance
    dsProxyInstance = deployedContracts.dsProxyInstance
    userProxyAddr = deployedContracts.userProxyAddress
    oraclePrice = await getOraclePrice(provider)
    marketPrice = await getMarketPrice(MAINNET_ADRESSES.WETH_ADDRESS, MAINNET_ADRESSES.MCD_DAI)
    ADDRESS_REGISTRY = addressRegistryFactory(
      multiplyProxyActionsInstance.address,
      exchangeInstance.address,
    )

    ADDRESS_REGISTRY.feeRecepient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
    exchangeInstance.setPrice(MAINNET_ADRESSES.ETH, amountToWei(marketPrice).toFixed(0))
    // the fee is set to 0.0003 and the base is 10000. Doing normal multiplication results in 2.999999999996
    exchangeInstance.setFee(new BigNumber(OUR_FEE).times(new BigNumber(FEE_BASE)).toFixed(0))

    let check_1inch = async function (data) {
      let [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
        oraclePrice,
        marketPrice,
        OUR_FEE,
        AAVE_FEE,
        baseCollateralAmountInETH,
        new BigNumber(data.currentDebt),
        new BigNumber(data.desiredCollRatio),
        data.slippage,
      )

      payload = await exchangeFromDAI(
        MAINNET_ADRESSES.WETH_ADDRESS,
        amountToWei(convertToBigNumber(requiredDebt).times(ONE.minus(OUR_FEE))).toFixed(0),
        data.slippage.multipliedBy(100).toNumber(),
        exchangeInstance.address,
      )
      data._1inchPayload = payload.tx
      data.toBorrowCollateralAmount = toBorrowCollateralAmount
      data.desiredCDPState.requiredDebt = requiredDebt
      data.desiredCDPState.toBorrowCollateralAmount = toBorrowCollateralAmount
    }
    let promises = testCases.map((x) => check_1inch(x))
    await Promise.all(promises)
    initialSetupSnapshotId = await provider.send('evm_snapshot', [])
  })

  describe(`opening Multiply Vault with collateralisation ratio of ${testCases[1].desiredCollRatio}`, async function () {
    let txResult, lastCDP, vaultInfo, startBalance

    this.afterAll(async function () {
      await provider.send('evm_revert', [initialSetupSnapshotId])
      let reVertedBlock = await provider.getBlockNumber()
      console.log('snapshot restored', initialSetupSnapshotId, reVertedBlock)
    })

    this.beforeAll(async function () {
      startBalance = await balanceOf(MAINNET_ADRESSES.MCD_DAI, ADDRESS_REGISTRY.feeRecepient)
      let { params } = prepareMultiplyParameters(
        testCases[1]._1inchPayload,
        testCases[1].desiredCDPState,
        multiplyProxyActionsInstance.address,
        exchangeInstance.address,
        primaryAddressAdr,
        false,
        0,
      )

      ;[status, txResult] = await dsproxyExecuteAction(
        multiplyProxyActionsInstance,
        dsProxyInstance,
        primaryAddressAdr,
        'openMultiplyVault',
        params,
        amountToWei(baseCollateralAmountInETH).toFixed(0),
      )
      lastCDP = await getLastCDP(provider, primaryAddress, userProxyAddr)
      vaultInfo = await getVaultInfo(mcdViewInstance, lastCDP.id, lastCDP.ilk)
    })

    it(`it should open vault with collateralisation Ratio of ${testCases[1].desiredCollRatio}`, async function () {
      let actualRatio = (vaultInfo.coll * oraclePrice) / vaultInfo.debt
      let maxAcceptable = testCases[1].desiredCollRatio * 1.05
      expect(actualRatio).to.be.greaterThanOrEqual(testCases[1].desiredCollRatio) //final collaterallisation value equal to at least desired
      expect(actualRatio).to.be.lessThanOrEqual(maxAcceptable) //final collaterallisation is off not more than 5% from desired value
    })

    it(`it should flash loan correct amount of DAI`, async function () {
      let allEvents = txResult.events.map((x) => {
        return {
          firstTopic: x.topics[0],
          topics: x.topics,
          data: x.data,
          name: x.name,
        }
      })

      let abi = ['event FLData(uint256 borrowed, uint256 due)']
      let iface = new ethers.utils.Interface(abi)

      var flDataEvent = iface.parseLog(
        lookupEventByHash(
          allEvents,
          '0x9c6641b21946115d10f3f55df9bec5752ec06d40dc9250b1cc6560549764600e',
        )[0],
      )
      var expected = amountToWei(vaultInfo.debt)
      var actual = new BigNumber(flDataEvent.args.due.toString())
      actual = amountToWei(actual.dividedBy(TEN.pow(18)))
      expect(actual.gt(expected.multipliedBy(0.98))).to.be.equal(true)
      expect(expected.gt(actual.multipliedBy(0.98))).to.be.equal(true)
    })

    it('it should send fee to beneficiary', async function () {
      let allEvents = txResult.events.map((x) => {
        return {
          firstTopic: x.topics[0],
          topics: x.topics,
          data: x.data,
          name: x.name,
        }
      })
      let feePaidEvents = lookupEventByHash(
        allEvents,
        '0x075a2720282fdf622141dae0b048ef90a21a7e57c134c76912d19d006b3b3f6f',
      )

      expect(feePaidEvents.length).to.be.deep.equal(1)
      let feeAmount = new BigNumber(feePaidEvents[0].data, 16)
      let expected = amountToWei(testCases[1].desiredCDPState.requiredDebt * OUR_FEE)
      endBalance = await balanceOf(MAINNET_ADRESSES.MCD_DAI, ADDRESS_REGISTRY.feeRecepient)
      console.log('DEBUG:endBalance', endBalance.toString())
      let balanceDifference = endBalance.sub(startBalance).toString()
      expect(feeAmount.toNumber()).to.be.greaterThanOrEqual(expected.toNumber())
      expect(feeAmount.toFixed(0)).to.be.equal(balanceDifference)
    })
  })

  describe(`opening Multiply Vault with collateralisation ratio of ${testCases[0].desiredCollRatio}`, async function () {
    let txResult, lastCDP, vaultInfo, startBalance

    this.afterAll(async function () {
      await provider.send('evm_revert', [initialSetupSnapshotId])
      let reVertedBlock = await provider.getBlockNumber()
      console.log('snapshot restored', initialSetupSnapshotId, reVertedBlock)
    })

    this.beforeAll(async function () {
      startBalance = await balanceOf(MAINNET_ADRESSES.MCD_DAI, ADDRESS_REGISTRY.feeRecepient)
      let { params } = prepareMultiplyParameters(
        testCases[0]._1inchPayload,
        testCases[0].desiredCDPState,
        multiplyProxyActionsInstance.address,
        exchangeInstance.address,
        await primaryAddress.getAddress(),
        false,
        0,
      )
      let status
      ;[status, txResult] = await dsproxyExecuteAction(
        multiplyProxyActionsInstance,
        dsProxyInstance,
        await primaryAddress.getAddress(),
        'openMultiplyVault',
        params,
        amountToWei(baseCollateralAmountInETH).toFixed(0),
      )
      lastCDP = await getLastCDP(provider, primaryAddress, userProxyAddr)
      vaultInfo = await getVaultInfo(mcdViewInstance, lastCDP.id, lastCDP.ilk)
    })

    it(`it should open vault with collateralisation Ratio of ${testCases[0].desiredCollRatio}`, async function () {
      let actualRatio = (vaultInfo.coll * oraclePrice) / vaultInfo.debt
      let maxAcceptable = testCases[0].desiredCollRatio * 1.05
      expect(actualRatio).to.be.greaterThanOrEqual(testCases[0].desiredCollRatio) //final collaterallisation value equal to at least desired
      expect(actualRatio).to.be.lessThanOrEqual(maxAcceptable) //final collaterallisation is off not more than 5% from desired value
    })

    it(`it should flash loan correct amount of DAI`, async function () {
      let allEvents = txResult.events.map((x) => {
        return {
          firstTopic: x.topics[0],
          topics: x.topics,
          data: x.data,
          name: x.name,
        }
      })
      let abi = ['event FLData(uint256 borrowed, uint256 due)']
      let iface = new ethers.utils.Interface(abi)

      var flDataEvent = iface.parseLog(
        lookupEventByHash(
          allEvents,
          '0x9c6641b21946115d10f3f55df9bec5752ec06d40dc9250b1cc6560549764600e',
        )[0],
      )
      var expected = amountToWei(vaultInfo.debt)
      var actual = new BigNumber(flDataEvent.args.due.toString())
      actual = amountToWei(actual.dividedBy(TEN.pow(18)))
      expect(actual.gt(expected.multipliedBy(0.98))).to.be.equal(true)
      expect(expected.gt(actual.multipliedBy(0.98))).to.be.equal(true)
    })

    it('it should send fee to beneficiary', async function () {
      let allEvents = txResult.events.map((x) => {
        return {
          firstTopic: x.topics[0],
          topics: x.topics,
          data: x.data,
          name: x.name,
        }
      })
      let feePaidEvents = lookupEventByHash(
        allEvents,
        '0x075a2720282fdf622141dae0b048ef90a21a7e57c134c76912d19d006b3b3f6f',
      )
      expect(feePaidEvents.length).to.be.deep.equal(1)
      let feeAmount = new BigNumber(feePaidEvents[0].data, 16)
      endBalance = await balanceOf(MAINNET_ADRESSES.MCD_DAI, ADDRESS_REGISTRY.feeRecepient)
      let balanceDifference = endBalance.sub(startBalance).toString()
      expect(feeAmount.toFixed(0)).to.be.equal(balanceDifference)
    })
  })
})
