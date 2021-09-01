const {
  deploySystem,
  getOraclePrice,
  dsproxyExecuteAction,
  getLastCDP,
  getVaultInfo,
  balanceOf,
  findMPAEvent,
  MAINNET_ADRESSES,
} = require('./common/mcd-deployment-utils')
const { default: BigNumber } = require('bignumber.js')
const {
  amountToWei,
  calculateParamsIncreaseMP,
  calculateParamsDecreaseMP,
  prepareMultiplyParameters2,
} = require('./common/params-calculation-utils')
const { expect } = require('chai')
const { one, TEN } = require('./utils')

const UniswapRouterV3Abi = require('../abi/external/IUniswapRouter.json')
const erc20Abi = require('../abi/IERC20.json')
const { getVaultInfoRaw } = require('./utils-mcd')

const ethers = hre.ethers

async function checkMPAPostState(tokenAddress, mpaAddress) {
  const daiBalance = await balanceOf(MAINNET_ADRESSES.MCD_DAI, mpaAddress)
  const collateralBalance = await balanceOf(tokenAddress, mpaAddress)

  return {
    daiBalance: new BigNumber(daiBalance.toString()),
    collateralBalance: new BigNumber(collateralBalance.toString()),
  }
}

describe('Multiply Proxy Action with Mocked Exchange', async function () {
  let provider,
    signer,
    address,
    mcdView,
    exchange,
    multiplyProxyActions,
    dsProxy,
    userProxyAddress,
    OF,
    FF,
    slippage,
    exchangeDataMock,
    DAI

  let precision = 8

  let CDP_ID // this test suite operates on one Vault that is created in first test case (opening Multiply Vault)
  let CDP_ILK

  this.beforeAll(async function () {
    provider = new hre.ethers.providers.JsonRpcProvider()
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

    DAI = new ethers.Contract(MAINNET_ADRESSES.MCD_DAI, erc20Abi, provider).connect(signer)
    WBTC = new ethers.Contract(MAINNET_ADRESSES.WBTC, erc20Abi, provider).connect(signer)

    const deployment = await deploySystem(provider, signer, true, true)
    await WBTC.approve(deployment.userProxyAddress, amountToWei(new BigNumber(10), 8).toFixed(0))

    // ({ dsProxy, exchange, multiplyProxyActions, mcdView }) = deployment;
    dsProxy = deployment.dsProxyInstance
    multiplyProxyActions = deployment.multiplyProxyActionsInstance
    mcdView = deployment.mcdViewInstance
    userProxyAddress = deployment.userProxyAddress

    // Replace real Exchange contract with DummyExchange contract for testing purposes
    exchange = deployment.exchangeInstance

    exchangeDataMock = {
      to: exchange.address,
      data: 0,
    }

    const OazoFee = 20 // divided by base (10000), 1 = 0.02%;
    OF = new BigNumber(OazoFee / 10000) // OAZO FEE
    FF = new BigNumber(0) // FLASHLOAN FEE
    slippage = new BigNumber(0.001) // Percent

    await exchange.setFee(OazoFee)
  })

  describe(`opening Multiply Vault`, async function () {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio

    this.beforeAll(async function () {
      oraclePrice = await getOraclePrice(provider, MAINNET_ADRESSES.PIP_WBTC)
      marketPrice = oraclePrice

      await exchange.setPrice(MAINNET_ADRESSES.WBTC, amountToWei(marketPrice).toFixed(0))

      currentColl = new BigNumber(5) // STARTING COLLATERAL AMOUNT
      currentDebt = new BigNumber(0) // STARTING VAULT DEBT
    })

    it(`should open vault with required collateralisation ratio`, async function () {
      requiredCollRatio = new BigNumber(8)
      let [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
        oraclePrice,
        marketPrice,
        OF,
        FF,
        currentColl,
        currentDebt,
        requiredCollRatio,
        slippage,
      )

      let desiredCdpState = {
        requiredDebt,
        toBorrowCollateralAmount,
        providedCollateral: currentColl,
        fromTokenAmount: requiredDebt,
        toTokenAmount: toBorrowCollateralAmount,
      }
      let params = prepareMultiplyParameters2(
        MAINNET_ADRESSES.MCD_DAI,
        MAINNET_ADRESSES.WBTC,
        exchangeDataMock,
        0,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        true,
        MAINNET_ADRESSES.MCD_JOIN_WBTC_A,
        8,
      )

      let [status, result] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'openMultiplyVault',
        params,
        amountToWei(currentColl).toFixed(0),
      )

      if (status == false) {
        throw result
      }
      const lastCDP = await getLastCDP(provider, signer, userProxyAddress)
      let info = await getVaultInfo(mcdView, lastCDP.id, lastCDP.ilk)
      CDP_ID = lastCDP.id
      CDP_ILK = lastCDP.ilk
      const currentCollRatio = new BigNumber(info.coll)
        .times(oraclePrice)
        .div(new BigNumber(info.debt))
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADRESSES.WBTC,
        multiplyProxyActions.address,
      )

      const requiredTotalCollateral = currentColl.plus(toBorrowCollateralAmount)
      const resultTotalCollateral = new BigNumber(info.coll)

      let actionEvents = findMPAEvent(result)
      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('openMultiplyVault')
      expect(daiBalance.toFixed(0)).to.be.equal('0')
      expect(collateralBalance.toFixed(0)).to.be.equal('0')
      expect(currentCollRatio.toFixed(2)).to.be.equal(requiredCollRatio.toFixed(2))
      expect(resultTotalCollateral.gte(requiredTotalCollateral)).to.be.true
    })
  })

  describe(`Increasing Multiple`, async function () {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio

    this.beforeAll(async function () {
      oraclePrice = await getOraclePrice(provider, MAINNET_ADRESSES.PIP_WBTC)
      marketPrice = oraclePrice

      await exchange.setPrice(MAINNET_ADRESSES.WBTC, amountToWei(marketPrice).toFixed(0))

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentColl = new BigNumber(info.coll)
      currentDebt = new BigNumber(info.debt)
    })

    it(`should increase vault's multiple to required collateralization ratio`, async function () {
      requiredCollRatio = new BigNumber(7)
      ;[requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
        oraclePrice,
        marketPrice,
        OF,
        FF,
        currentColl,
        currentDebt,
        requiredCollRatio,
        slippage,
      )

      desiredCdpState = {
        requiredDebt,
        toBorrowCollateralAmount,
        fromTokenAmount: requiredDebt,
        toTokenAmount: toBorrowCollateralAmount,
      }

      let params = prepareMultiplyParameters2(
        MAINNET_ADRESSES.MCD_DAI,
        MAINNET_ADRESSES.WBTC,
        exchangeDataMock,
        CDP_ID,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        true,
        MAINNET_ADRESSES.MCD_JOIN_WBTC_A,
        8,
      )

      params[1].skipFL = true

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      const originalCollRatio = new BigNumber(info.coll)
        .times(oraclePrice)
        .div(new BigNumber(info.debt))
      let [status, result] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'increaseMultiple',
        params,
      )
      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      const currentCollRatio = new BigNumber(info.coll)
        .times(oraclePrice)
        .div(new BigNumber(info.debt))
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADRESSES.WBTC,
        multiplyProxyActions.address,
      )
      /*
      let actionEvents = findMPAEvent(result)
      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('increaseMultiple')
      */
      expect(daiBalance.toFixed(0)).to.be.equal('0')
      expect(collateralBalance.toFixed(0)).to.be.equal('0')
      expect(currentCollRatio.toFixed(3)).to.be.equal(requiredCollRatio.toFixed(3))
    })
  })

  describe(`Increasing Multiple deposit Dai`, async function () {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio

    this.beforeAll(async function () {
      oraclePrice = await getOraclePrice(provider, MAINNET_ADRESSES.PIP_WBTC)
      marketPrice = oraclePrice

      await exchange.setPrice(MAINNET_ADRESSES.WBTC, amountToWei(marketPrice).toFixed(0))

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentColl = new BigNumber(info.coll)
      currentDebt = new BigNumber(info.debt)
    })

    it(`should increase vault's multiple to required collateralization ratio with additional Dai deposited`, async function () {
      requiredCollRatio = new BigNumber(6)
      const daiDeposit = new BigNumber(300)

      await DAI.approve(userProxyAddress, amountToWei(daiDeposit).toFixed(0))
      ;[requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
        oraclePrice,
        marketPrice,
        OF,
        FF,
        currentColl,
        currentDebt,
        requiredCollRatio,
        slippage,
        daiDeposit,
      )

      desiredCdpState = {
        requiredDebt,
        toBorrowCollateralAmount,
        providedDai: daiDeposit,
        fromTokenAmount: requiredDebt,
        toTokenAmount: toBorrowCollateralAmount,
      }

      let params = prepareMultiplyParameters2(
        MAINNET_ADRESSES.MCD_DAI,
        MAINNET_ADRESSES.WBTC,
        exchangeDataMock,
        CDP_ID,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        true,
        MAINNET_ADRESSES.MCD_JOIN_WBTC_A,
        8,
      )
      params[1].skipFL = true

      let [status, result] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'increaseMultipleDepositDai',
        params,
      )
      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      const currentCollRatio = new BigNumber(info.coll)
        .times(oraclePrice)
        .div(new BigNumber(info.debt))
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADRESSES.WBTC,
        multiplyProxyActions.address,
      )
      /*
      let actionEvents = findMPAEvent(result)
      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('increaseMultipleDepositDai')
      */
      expect(daiBalance.toFixed(0)).to.be.equal('0')
      expect(collateralBalance.toFixed(0)).to.be.equal('0')
      expect(currentCollRatio.toFixed(3)).to.be.equal(requiredCollRatio.toFixed(3))
    })
  })

  describe(`Increasing Multiple deposit collateral`, async function () {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio

    this.beforeAll(async function () {
      oraclePrice = await getOraclePrice(provider, MAINNET_ADRESSES.PIP_WBTC)
      marketPrice = oraclePrice

      await exchange.setPrice(MAINNET_ADRESSES.WBTC, amountToWei(marketPrice).toFixed(0))

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentColl = new BigNumber(info.coll)
      currentDebt = new BigNumber(info.debt)
    })

    it(`should increase vault's multiple to required collateralization ratio with additional collateral deposited`, async function () {
      requiredCollRatio = new BigNumber(5)
      const collateralDeposit = new BigNumber(1)
      ;[requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
        oraclePrice,
        marketPrice,
        OF,
        FF,
        currentColl.plus(collateralDeposit),
        currentDebt,
        requiredCollRatio,
        slippage,
      )

      desiredCdpState = {
        requiredDebt,
        toBorrowCollateralAmount,
        providedCollateral: collateralDeposit,
        fromTokenAmount: requiredDebt,
        toTokenAmount: toBorrowCollateralAmount,
      }

      let params = prepareMultiplyParameters2(
        MAINNET_ADRESSES.MCD_DAI,
        MAINNET_ADRESSES.WBTC,
        exchangeDataMock,
        CDP_ID,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        true,
        MAINNET_ADRESSES.MCD_JOIN_WBTC_A,
        8,
      )
      params[1].skipFL = true

      let [status, result] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'increaseMultipleDepositCollateral',
        params,
        amountToWei(collateralDeposit).toFixed(0),
      )
      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      const currentCollRatio = new BigNumber(info.coll)
        .times(oraclePrice)
        .div(new BigNumber(info.debt))
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADRESSES.WBTC,
        multiplyProxyActions.address,
      )
      /*
      let actionEvents = findMPAEvent(result)
      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('increaseMultipleDepositCollateral')
      */
      expect(daiBalance.toFixed(0)).to.be.equal('0')
      expect(collateralBalance.toFixed(0)).to.be.equal('0')
      expect(currentCollRatio.toFixed(3)).to.be.equal(requiredCollRatio.toFixed(3))
    })
  })

  describe(`Decrease Multiple`, async function () {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio

    this.beforeAll(async function () {
      oraclePrice = await getOraclePrice(provider, MAINNET_ADRESSES.PIP_WBTC)
      marketPrice = oraclePrice

      await exchange.setPrice(MAINNET_ADRESSES.WBTC, amountToWei(marketPrice).toFixed(0))

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentColl = new BigNumber(info.coll)
      currentDebt = new BigNumber(info.debt)
    })

    it(`should decrease vault's multiple to required collateralization ratio`, async function () {
      let cCollRatio = new BigNumber(info.coll).times(oraclePrice).div(new BigNumber(info.debt))
      const requiredCollRatio = cCollRatio.plus(0.1)

      ;[requiredDebt, toBorrowCollateralAmount] = calculateParamsDecreaseMP(
        oraclePrice,
        marketPrice,
        OF,
        FF,
        currentColl,
        currentDebt,
        requiredCollRatio,
        slippage,
        0,
        false,
      )

      desiredCdpState = {
        requiredDebt,
        toBorrowCollateralAmount,
        fromTokenAmount: toBorrowCollateralAmount,
        toTokenAmount: requiredDebt,
      }

      let params = prepareMultiplyParameters2(
        MAINNET_ADRESSES.WBTC,
        MAINNET_ADRESSES.MCD_DAI,
        exchangeDataMock,
        CDP_ID,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        true,
        MAINNET_ADRESSES.MCD_JOIN_WBTC_A,
        8,
        true,
      )

      params[1].skipFL = true

      let [status, result] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'decreaseMultiple',
        params,
      )

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      cCollRatio = new BigNumber(info.coll).times(oraclePrice).div(new BigNumber(info.debt))
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADRESSES.WBTC,
        multiplyProxyActions.address,
      )
      /*
      let actionEvents = findMPAEvent(result)
      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('decreaseMultiple')
*/
      expect(daiBalance.toFixed(0)).to.be.equal('0')
      expect(collateralBalance.toFixed(0)).to.be.equal('0')
      expect(cCollRatio.toFixed(3)).to.be.equal(requiredCollRatio.toFixed(3))
    })
  })

  describe(`Decrease Multiple withdraw Dai`, async function () {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio

    this.beforeAll(async function () {
      oraclePrice = await getOraclePrice(provider, MAINNET_ADRESSES.PIP_WBTC)
      marketPrice = oraclePrice

      await exchange.setPrice(MAINNET_ADRESSES.WBTC, amountToWei(marketPrice).toFixed(0))

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentColl = new BigNumber(info.coll)
      currentDebt = new BigNumber(info.debt)
    })

    it(`should decrease vault's multiple to required collateralization ratio with additional Dai withdrawn`, async function () {
      let cCollRatio = new BigNumber(info.coll).times(oraclePrice).div(new BigNumber(info.debt))
      const requiredCollRatio = cCollRatio.plus(0.1)
      const withdrawDai = new BigNumber(100)

      ;[requiredDebt, toBorrowCollateralAmount] = calculateParamsDecreaseMP(
        oraclePrice,
        marketPrice,
        OF,
        FF,
        currentColl,
        currentDebt.plus(withdrawDai),
        requiredCollRatio,
        slippage,
      )

      desiredCdpState = {
        withdrawDai,
        requiredDebt,
        toBorrowCollateralAmount,
        fromTokenAmount: toBorrowCollateralAmount,
        toTokenAmount: requiredDebt,
      }

      let params = prepareMultiplyParameters2(
        MAINNET_ADRESSES.WBTC,
        MAINNET_ADRESSES.MCD_DAI,
        exchangeDataMock,
        CDP_ID,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        true,
        MAINNET_ADRESSES.MCD_JOIN_WBTC_A,
        8,
        true,
      )
      params[1].skipFL = true

      let [status, result] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'decreaseMultipleWithdrawDai',
        params,
      )

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      const currentCollRatio = new BigNumber(info.coll)
        .times(oraclePrice)
        .div(new BigNumber(info.debt))
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADRESSES.WBTC,
        multiplyProxyActions.address,
      )

      /*
      let actionEvents = findMPAEvent(result)
      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('decreaseMultipleWithdrawDai')
      */

      expect(daiBalance.toFixed(0)).to.be.equal('0')
      expect(collateralBalance.toFixed(0)).to.be.equal('0')
      expect(currentCollRatio.toFixed(2)).to.be.equal(requiredCollRatio.toFixed(2))
    })
  })

  describe(`Decrease Multiple withdraw collateral`, async function () {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio

    this.beforeAll(async function () {
      oraclePrice = await getOraclePrice(provider, MAINNET_ADRESSES.PIP_WBTC)
      marketPrice = oraclePrice

      await exchange.setPrice(MAINNET_ADRESSES.WBTC, amountToWei(marketPrice).toFixed(0))

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentColl = new BigNumber(info.coll)
      currentDebt = new BigNumber(info.debt)
    })

    it(`should decrease vault's multiple to required collateralization ratio with additional collateral withdrawn`, async function () {
      let cCollRatio = new BigNumber(info.coll).times(oraclePrice).div(new BigNumber(info.debt))
      const requiredCollRatio = cCollRatio.plus(0.1)

      const withdrawCollateral = new BigNumber(1)

      ;[requiredDebt, toBorrowCollateralAmount] = calculateParamsDecreaseMP(
        oraclePrice,
        marketPrice,
        OF,
        FF,
        currentColl.minus(withdrawCollateral),
        currentDebt,
        requiredCollRatio,
        slippage,
      )

      desiredCdpState = {
        withdrawCollateral,
        requiredDebt,
        toBorrowCollateralAmount,
        fromTokenAmount: toBorrowCollateralAmount,
        toTokenAmount: requiredDebt,
      }

      let params = prepareMultiplyParameters2(
        MAINNET_ADRESSES.WBTC,
        MAINNET_ADRESSES.MCD_DAI,
        exchangeDataMock,
        CDP_ID,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        true,
        MAINNET_ADRESSES.MCD_JOIN_WBTC_A,
        8,
        true,
      )
      params[1].skipFL = true

      let [status, result] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'decreaseMultipleWithdrawCollateral',
        params,
      )

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      const currentCollRatio = new BigNumber(info.coll)
        .times(oraclePrice)
        .div(new BigNumber(info.debt))
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADRESSES.WBTC,
        multiplyProxyActions.address,
      )

      /*
      let actionEvents = findMPAEvent(result)
      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('decreaseMultipleWithdrawCollateral')
      */

      expect(daiBalance.toFixed(0)).to.be.equal('0')
      expect(collateralBalance.toFixed(0)).to.be.equal('0')
      expect(currentCollRatio.toFixed(2)).to.be.equal(requiredCollRatio.toFixed(2))
    })
  })

  describe(`Close vault and exit all collateral`, async function () {
    let marketPrice, currentColl, currentDebt

    this.beforeAll(async function () {
      oraclePrice = await getOraclePrice(provider, MAINNET_ADRESSES.PIP_WBTC)
      marketPrice = oraclePrice

      await exchange.setPrice(MAINNET_ADRESSES.WBTC, amountToWei(marketPrice).toFixed(0))

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      let infoRaw = await getVaultInfoRaw(mcdView, CDP_ID, CDP_ILK)
      console.log(infoRaw)
      console.log(info)
      currentColl = new BigNumber(infoRaw.coll).dividedBy(TEN.exponentiatedBy(18)) //it is normalized collateral
      currentDebt = new BigNumber(info.debt)
    })

    it(`should close vault and return  collateral`, async function () {
      await exchange.setPrice(MAINNET_ADRESSES.WBTC, amountToWei(marketPrice).toFixed(0))

      const marketPriceSlippage = marketPrice.times(one.minus(slippage))
      const minToTokenAmount = currentDebt.times(one.plus(OF).plus(FF))
      console.log('Market Price', marketPriceSlippage.toString())
      console.log('Debt to Pay', minToTokenAmount.toString())
      console.log('Collateral available', currentColl.toString())
      const sellCollateralAmount = minToTokenAmount.div(marketPriceSlippage)

      console.log('Collateral To Sell', sellCollateralAmount.toString())

      desiredCdpState = {
        requiredDebt: 0,
        toBorrowCollateralAmount: sellCollateralAmount,
        fromTokenAmount: sellCollateralAmount,
        toTokenAmount: minToTokenAmount,
        withdrawCollateral: currentColl.minus(sellCollateralAmount),
      }

      let params = prepareMultiplyParameters2(
        MAINNET_ADRESSES.WBTC,
        MAINNET_ADRESSES.MCD_DAI,
        exchangeDataMock,
        CDP_ID,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        true,
        MAINNET_ADRESSES.MCD_JOIN_WBTC_A,
        8,
        true,
      )
      params[1].skipFL = true

      console.log(params)

      let [status, result] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'closeVaultExitCollateral',
        params,
      )

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADRESSES.WBTC,
        multiplyProxyActions.address,
      )

      /*
      let actionEvents = findMPAEvent(result)
      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('closeVaultExitCollateral')
*/

      expect(daiBalance.toFixed(0)).to.be.equal('0')
      expect(collateralBalance.toString()).to.be.equal('0')
      expect(info.debt.toString()).to.be.equal('0')
      expect(new BigNumber(info.coll.toString()).toNumber()).to.be.lessThanOrEqual(0.00001)
    })
  })
})
