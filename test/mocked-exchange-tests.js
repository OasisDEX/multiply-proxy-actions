const {
  deploySystem,
  getOraclePrice,
  dsproxyExecuteAction,
  getLastCDP,
  getVaultInfo,
  balanceOf,
  MAINNET_ADRESSES,
  findMPAEvent,
} = require('./common/mcd-deployment-utils')
const { default: BigNumber } = require('bignumber.js')
const {
  amountToWei,
  calculateParamsIncreaseMP,
  calculateParamsDecreaseMP,
  prepareMultiplyParameters,
  prepareMultiplyParameters2,
} = require('./common/params-calculation-utils')
const { expect } = require('chai')
const { one, TEN } = require('./utils')

const UniswapRouterV3Abi = require('../abi/external/IUniswapRouter.json')
const wethAbi = require('../abi/IWETH.json')
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
    DAI,
    WETH

  let CDP_ID // this test suite operates on one Vault that is created in first test case (opening Multiply Vault)
  let CDP_ILK

  this.beforeEach(async function () {})

  this.beforeAll(async function () {
    provider = new hre.ethers.providers.JsonRpcProvider()
    signer = provider.getSigner(0)
    WETH = new ethers.Contract(MAINNET_ADRESSES.ETH, wethAbi, provider).connect(signer)
    DAI = new ethers.Contract(MAINNET_ADRESSES.MCD_DAI, erc20Abi, provider).connect(signer)
    address = await signer.getAddress()

    provider.send('hardhat_reset', [
      {
        forking: {
          jsonRpcUrl: process.env.ALCHEMY_NODE,
          blockNumber: 12763570,
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

    const OazoFee = 2 // divided by base (10000), 1 = 0.01%;
    OF = new BigNumber(OazoFee / 10000) // OAZO FEE
    FF = new BigNumber(0.0009) // FLASHLOAN FEE
    slippage = new BigNumber(0.0001) // Percent

    //await exchange.setSlippage(0);
    //await exchange.setMode(0);

    await exchange.setFee(OazoFee)
  })

  describe(`opening Multiply Vault`, async function () {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio

    this.beforeAll(async function () {
      marketPrice = await new BigNumber(2380)
      oraclePrice = await getOraclePrice(provider)

      await exchange.setPrice(MAINNET_ADRESSES.ETH, amountToWei(marketPrice).toFixed(0))

      currentColl = new BigNumber(100) // STARTING COLLATERAL AMOUNT
      currentDebt = new BigNumber(0) // STARTING VAULT DEBT
    })

    it(`should open vault with required collateralisation ratio`, async function () {
      requiredCollRatio = new BigNumber(3)
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

      let { params } = prepareMultiplyParameters(
        exchangeDataMock,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        false,
      )
      var [status, result] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'openMultiplyVault',
        params,
        amountToWei(currentColl),
      )
      if (status == false) {
        throw result
      }

      let actionEvents = findMPAEvent(result)

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
        MAINNET_ADRESSES.ETH,
        multiplyProxyActions.address,
      )

      const requiredTotalCollateral = currentColl.plus(toBorrowCollateralAmount)
      const resultTotalCollateral = new BigNumber(info.coll)

      expect(daiBalance.toFixed(0)).to.be.equal('0')
      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('openMultiplyVault')
      expect(collateralBalance.toFixed(0)).to.be.equal('0')
      expect(currentCollRatio.toFixed(3)).to.be.equal(requiredCollRatio.toFixed(3))
      expect(resultTotalCollateral.gte(requiredTotalCollateral)).to.be.true
    })

    it(`should fail opening new vault with collateralization below min. collRatio limit`, async function () {
      requiredCollRatio = new BigNumber(1.4)
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
      let { params } = prepareMultiplyParameters(
        exchangeDataMock,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        false,
        0,
      )
      const [status, result] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'openMultiplyVault',
        params,
        amountToWei(currentColl).toFixed(0),
      )

      expect(status).to.be.false
    })
  })

  describe(`Increasing Multiple`, async function () {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio

    this.beforeEach(async function () {
      marketPrice = await new BigNumber(2380)
      oraclePrice = await getOraclePrice(provider)

      await exchange.setPrice(MAINNET_ADRESSES.ETH, amountToWei(marketPrice).toFixed(0))

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentColl = new BigNumber(info.coll)
      currentDebt = new BigNumber(info.debt)
    })

    it(`should increase vault's multiple to required collateralization ratio`, async function () {
      requiredCollRatio = new BigNumber(2.6)
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
        providedCollateral: 0,
      }

      let { params } = prepareMultiplyParameters(
        exchangeDataMock,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        false,
        CDP_ID,
      )

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
        MAINNET_ADRESSES.ETH,
        multiplyProxyActions.address,
      )

      let actionEvents = findMPAEvent(result)
      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('increaseMultiple')
      expect(daiBalance.toFixed(0)).to.be.equal('0')
      expect(collateralBalance.toFixed(0)).to.be.equal('0')
      expect(currentCollRatio.toFixed(3)).to.be.equal(requiredCollRatio.toFixed(3))
    })
  })

  describe(`Increasing Multiple deposit Dai`, async function () {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio

    this.beforeAll(async function () {
      marketPrice = await new BigNumber(2380)
      oraclePrice = await getOraclePrice(provider)

      await exchange.setPrice(MAINNET_ADRESSES.ETH, amountToWei(marketPrice).toFixed(0))

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentColl = new BigNumber(info.coll)
      currentDebt = new BigNumber(info.debt)
    })

    it(`should increase vault's multiple to required collateralization ratio with additional Dai deposited`, async function () {
      requiredCollRatio = new BigNumber(2.2)
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
        providedCollateral: 0,
      }

      let { params } = prepareMultiplyParameters(
        exchangeDataMock,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        false,
        CDP_ID,
      )

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
        MAINNET_ADRESSES.ETH,
        multiplyProxyActions.address,
      )

      let actionEvents = findMPAEvent(result)
      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('increaseMultipleDepositDai')
      expect(daiBalance.toFixed(0)).to.be.equal('0')
      expect(collateralBalance.toFixed(0)).to.be.equal('0')
      expect(currentCollRatio.toNumber()).to.be.greaterThanOrEqual(
        requiredCollRatio.times(0.999).toNumber(),
      )
      expect(currentCollRatio.toNumber()).to.be.lessThanOrEqual(
        requiredCollRatio.times(1.001).toNumber(),
      )
    })
  })

  describe(`Increasing Multiple deposit collateral`, async function () {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio

    this.beforeAll(async function () {
      marketPrice = await new BigNumber(2380)
      oraclePrice = await getOraclePrice(provider)

      await exchange.setPrice(MAINNET_ADRESSES.ETH, amountToWei(marketPrice).toFixed(0))

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentColl = new BigNumber(info.coll)
      currentDebt = new BigNumber(info.debt)
    })

    it(`should increase vault's multiple to required collateralization ratio with additional collateral deposited`, async function () {
      requiredCollRatio = new BigNumber(1.9)
      const collateralDeposit = new BigNumber(5)
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

      let { params } = prepareMultiplyParameters(
        exchangeDataMock,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        false,
        CDP_ID,
      )

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
        MAINNET_ADRESSES.ETH,
        multiplyProxyActions.address,
      )

      let actionEvents = findMPAEvent(result)
      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('increaseMultipleDepositCollateral')
      expect(daiBalance.toFixed(0)).to.be.equal('0')
      expect(collateralBalance.toFixed(0)).to.be.equal('0')
      expect(currentCollRatio.toFixed(3)).to.be.equal(requiredCollRatio.toFixed(3))
    })
  })

  describe(`Decrease Multiple`, async function () {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio

    this.beforeEach(async function () {
      marketPrice = await new BigNumber(2380)
      oraclePrice = await getOraclePrice(provider)

      await exchange.setPrice(MAINNET_ADRESSES.ETH, amountToWei(marketPrice).toFixed(0))

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentColl = new BigNumber(info.coll)
      currentDebt = new BigNumber(info.debt)
    })

    it(`should decrease vault's multiple to required collateralization ratio`, async function () {
      requiredCollRatio = new BigNumber(2.8)
      ;[requiredDebt, toBorrowCollateralAmount] = calculateParamsDecreaseMP(
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
        fromTokenAmount: toBorrowCollateralAmount,
        providedCollateral: 0,
        toTokenAmount: requiredDebt,
      }

      let { params } = prepareMultiplyParameters(
        exchangeDataMock,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        true,
        CDP_ID,
      )

      let [status, result] = await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'decreaseMultiple',
        params,
      )

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      const currentCollRatio = new BigNumber(info.coll)
        .times(oraclePrice)
        .div(new BigNumber(info.debt))
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADRESSES.ETH,
        multiplyProxyActions.address,
      )

      let actionEvents = findMPAEvent(result)
      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('decreaseMultiple')
      expect(daiBalance.toFixed(0)).to.be.equal('0')
      expect(collateralBalance.toFixed(0)).to.be.equal('0')
      expect(currentCollRatio.toFixed(3)).to.be.equal(requiredCollRatio.toFixed(3))
    })
  })

  describe(`Decrease Multiple withdraw Dai`, async function () {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio

    this.beforeAll(async function () {
      marketPrice = await new BigNumber(2380)
      oraclePrice = await getOraclePrice(provider)

      await exchange.setPrice(MAINNET_ADRESSES.ETH, amountToWei(marketPrice).toFixed(0))

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentColl = new BigNumber(info.coll)
      currentDebt = new BigNumber(info.debt)
    })

    it(`should decrease vault's multiple to required collateralization ratio with additional Dai withdrawn`, async function () {
      requiredCollRatio = new BigNumber(3.2)
      const withdrawDai = new BigNumber(200)

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
        providedCollateral: 0,
        toTokenAmount: requiredDebt,
      }

      let { params } = prepareMultiplyParameters(
        exchangeDataMock,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        true,
        CDP_ID,
      )

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
        MAINNET_ADRESSES.ETH,
        multiplyProxyActions.address,
      )

      let actionEvents = findMPAEvent(result)
      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('decreaseMultipleWithdrawDai')
      expect(daiBalance.toFixed(0)).to.be.equal('0')
      expect(collateralBalance.toFixed(0)).to.be.equal('0')
      expect(currentCollRatio.toNumber()).to.be.greaterThanOrEqual(
        requiredCollRatio.times(0.998).toNumber(),
      )
      expect(currentCollRatio.toNumber()).to.be.lessThanOrEqual(
        requiredCollRatio.times(1.002).toNumber(),
      )
    })
  })

  describe(`Decrease Multiple withdraw collateral`, async function () {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio

    this.beforeAll(async function () {
      marketPrice = await new BigNumber(2380)
      oraclePrice = await getOraclePrice(provider)

      await exchange.setPrice(MAINNET_ADRESSES.ETH, amountToWei(marketPrice).toFixed(0))

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      currentColl = new BigNumber(info.coll)
      currentDebt = new BigNumber(info.debt)
    })

    it(`should decrease vault's multiple to required collateralization ratio with additional collateral withdrawn`, async function () {
      requiredCollRatio = new BigNumber(3.8)
      const withdrawCollateral = new BigNumber(8)

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
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
        providedCollateral: 0,
        toTokenAmount: requiredDebt,
      }

      let { params } = prepareMultiplyParameters(
        exchangeDataMock,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        true,
        CDP_ID,
      )

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
        MAINNET_ADRESSES.ETH,
        multiplyProxyActions.address,
      )

      let actionEvents = findMPAEvent(result)
      expect(actionEvents.length).to.be.equal(1)
      expect(actionEvents[0].methodName).to.be.equal('decreaseMultipleWithdrawCollateral')
      expect(daiBalance.toFixed(0)).to.be.equal('0')
      expect(collateralBalance.toFixed(0)).to.be.equal('0')
      expect(currentCollRatio.toFixed(3)).to.be.equal(requiredCollRatio.toFixed(3))
    })
  })

  // To use this test comment out 'Close vault and exit all collateral' as there cannot be two closing actions together

  describe(`Close vault and exit all Dai`, async function () {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio

    this.beforeAll(async function () {
      marketPrice = await new BigNumber(2380)
      oraclePrice = await getOraclePrice(provider)

      await exchange.setPrice(MAINNET_ADRESSES.ETH, amountToWei(marketPrice).toFixed(0))

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      console.log(info)
      rawInfo = await getVaultInfoRaw(mcdView, CDP_ID, CDP_ILK)
      console.log(rawInfo)
      currentColl = new BigNumber(info.coll)
      currentDebt = new BigNumber(info.debt)
    })

    it(`should close vault and return Dai`, async function () {
      const minToTokenAmount = currentColl
        .times(marketPrice)
        .times(one.minus(slippage))
        .dividedBy(one.plus(OF).plus(FF))

      desiredCdpState = {
        requiredDebt: 0,
        toBorrowCollateralAmount: new BigNumber(rawInfo.coll)
          .dividedBy(TEN.exponentiatedBy(18))
          .toFixed(18),
        providedCollateral: 0,
        fromTokenAmount: new BigNumber(rawInfo.coll).dividedBy(TEN.exponentiatedBy(18)).toFixed(18),
        toTokenAmount: amountToWei(
          minToTokenAmount.dividedBy(TEN.exponentiatedBy(18)).dividedBy(one.minus(slippage)),
        ).toFixed(18),
        minToTokenAmount: amountToWei(minToTokenAmount.dividedBy(TEN.exponentiatedBy(18))).toFixed(
          18,
        ),
        withdrawCollateral: 0,
      }

      params = prepareMultiplyParameters2(
        MAINNET_ADRESSES.ETH,
        MAINNET_ADRESSES.MCD_DAI,
        exchangeDataMock,
        CDP_ID,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
      )

      await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'closeVaultExitDai',
        params,
      )

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      console.log(info)
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADRESSES.ETH,
        multiplyProxyActions.address,
      )

      expect(daiBalance.toFixed(0)).to.be.equal('0')
      expect(collateralBalance.toFixed(0)).to.be.equal('0')
      expect(info.debt.toString()).to.be.equal('0')
      expect(info.coll.toString()).to.be.equal('0')
    })
  })

  describe.skip(`Close vault and exit all collateral`, async function () {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio, rawInfo

    this.beforeAll(async function () {
      oraclePrice = await getOraclePrice(provider)
      marketPrice = await new BigNumber(2380)

      await exchange.setPrice(MAINNET_ADRESSES.ETH, amountToWei(marketPrice).toFixed(0))

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      rawInfo = await getVaultInfoRaw(mcdView, CDP_ID, CDP_ILK)
      console.log(info)
      currentColl = new BigNumber(info.coll)
      currentDebt = new BigNumber(info.debt)
    })

    it(`should close vault and return  collateral`, async function () {
      await exchange.setPrice(MAINNET_ADRESSES.ETH, amountToWei(marketPrice).toFixed(0))

      const marketPriceSlippage = marketPrice.times(one.minus(slippage))
      const minToTokenAmount = currentDebt.times(one.plus(OF).plus(FF))
      const sellCollateralAmount = minToTokenAmount.div(marketPriceSlippage)

      desiredCdpState = {
        requiredDebt: 0,
        toBorrowCollateralAmount: currentColl,
        providedCollateral: 0,
        toTokenAmount: minToTokenAmount.dividedBy(one.minus(slippage)),
        minToTokenAmount: minToTokenAmount,
        withdrawCollateral: 0,
      }

      let { params } = prepareMultiplyParameters(
        exchangeDataMock,
        desiredCdpState,
        multiplyProxyActions.address,
        exchange.address,
        address,
        true,
        CDP_ID,
      )

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      params[1].borrowCollateral = rawInfo.coll
      await dsproxyExecuteAction(
        multiplyProxyActions,
        dsProxy,
        address,
        'closeVaultExitCollateral',
        params,
      )

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK)
      console.log(info)
      const { daiBalance, collateralBalance } = await checkMPAPostState(
        MAINNET_ADRESSES.ETH,
        multiplyProxyActions.address,
      )

      expect(daiBalance.toFixed(0), 'dai left in MPA').to.be.equal('0')
      expect(collateralBalance.toFixed(0), 'collateral left in MPA').to.be.equal('0')
      expect(info.debt.toString(), 'debt left in Vault').to.be.equal('0')
      expect(info.coll.toString(), 'collateral left in Vault').to.be.equal('0')
    })
  })
})
