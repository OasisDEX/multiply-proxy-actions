const {
  init,
  deploySystem,
  getOraclePrice,
  dsproxyExecuteAction,
  getLastCDP,
  getVaultInfo,
  MAINNET_ADRESSES,
  swapTokens,
} = require('./common/mcd-deployment-utils')
const { default: BigNumber } = require('bignumber.js')
const {
  amountToWei,
  calculateParamsIncreaseMP,
  calculateParamsDecreaseMP,
  prepareMultiplyParameters2,
} = require('./common/params-calculation-utils')
const { expect } = require('chai')

const erc20Abi = require('../abi/IERC20.json')

const ethers = hre.ethers

describe.only(`Manage vault with a collateral with different than 18 precision`, async function () {
  let provider,
    signer,
    address,
    vault,
    oraclePrice,
    marketPrice,
    initialCollRatio,
    exchange,
    snapshotId,
    exchangeStub,
    OF,
    FF,
    WBTC,
    slippage

  this.beforeAll(async function () {
    let [_provider, _signer] = await init(process.env.BLOCK_NUMBER)
    provider = _provider
    signer = _signer
    address = await signer.getAddress()

    const received = amountToWei(new BigNumber(2), 8).toFixed(0)

    await swapTokens(
      MAINNET_ADRESSES.ETH,
      MAINNET_ADRESSES.WBTC,
      amountToWei(new BigNumber(400), 18).toFixed(0),
      received,
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

    WBTC = new ethers.Contract(MAINNET_ADRESSES.WBTC, erc20Abi, provider).connect(signer)
    await WBTC.transfer(exchange.address, received)

    exchangeStub = {
      to: exchange.address,
      data: 0,
    }

    const OazoFee = 2 // divided by base (10000), 1 = 0.01%;
    OF = new BigNumber(OazoFee / 10000) // OAZO FEE
    FF = new BigNumber(0.0009) // FLASHLOAN FEE
    slippage = new BigNumber(0.0001) // Percent

    await exchange.setFee(OazoFee)

    oraclePrice = await getOraclePrice(provider, MAINNET_ADRESSES.PIP_WBTC)
    console.log("OracleFee",oraclePrice.toFixed(0));
    marketPrice = oraclePrice
    initialCollRatio = new BigNumber(1.8)
    let collAmount = new BigNumber(0.5)
    let debtAmount = new BigNumber(0)

    await exchange.setPrecision(MAINNET_ADRESSES.WBTC, 8)
    await exchange.setPrice(amountToWei(marketPrice).toFixed(0))

    let [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
      oraclePrice,
      marketPrice,
      OF,
      FF,
      collAmount,
      debtAmount,
      initialCollRatio,
      slippage,
    )

    let desiredCdpState = {
      requiredDebt,
      toBorrowCollateralAmount,
      providedCollateral: collAmount,
      fromTokenAmount: requiredDebt,
      toTokenAmount: toBorrowCollateralAmount,
    }

    let params = prepareMultiplyParameters2(
      MAINNET_ADRESSES.MCD_DAI,
      MAINNET_ADRESSES.WBTC,
      exchangeStub,
      0,
      desiredCdpState,
      multiplyProxyActions.address,
      exchange.address,
      address,
      false,
      MAINNET_ADRESSES.MCD_JOIN_WBTC_A,
      8,
    )

    await WBTC.approve(userProxyAddress, amountToWei(new BigNumber(10), 8).toFixed(0))


    let [status, msg] = await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'openMultiplyVault', params)
    if (status === false){
      console.log(params);
      throw new Error("tx failed");
    }
    vault = await getLastCDP(provider, signer, userProxyAddress)

    snapshotId = await provider.send('evm_snapshot', [])
  })

  this.afterEach(async function () {
    await provider.send('evm_revert', [snapshotId])
  })

  it(`should open a vault`, async function () {
    let info = await getVaultInfo(mcdView, vault.id, vault.ilk, 8)

    const currentCollRatio = new BigNumber(info.coll)
      .times(oraclePrice)
      .div(new BigNumber(info.debt))
    expect(currentCollRatio.toFixed(3)).to.be.equal(initialCollRatio.toFixed(3))
  })

  it(`should increase vault's multiple`, async function () {
    const desiredCollRatio = initialCollRatio.minus(new BigNumber(0.3))
    const info = await getVaultInfo(mcdView, vault.id, vault.ilk)
    const currentColl = new BigNumber(info.coll)
    const currentDebt = new BigNumber(info.debt)

    let [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(
      oraclePrice,
      marketPrice,
      OF,
      FF,
      currentColl,
      currentDebt,
      desiredCollRatio,
      slippage,
    )

    let desiredCdpState = {
      requiredDebt,
      toBorrowCollateralAmount,
      fromTokenAmount: requiredDebt,
      toTokenAmount: toBorrowCollateralAmount,
    }

    let params = prepareMultiplyParameters2(
      MAINNET_ADRESSES.MCD_DAI,
      MAINNET_ADRESSES.WBTC,
      exchangeStub,
      vault.id,
      desiredCdpState,
      multiplyProxyActions.address,
      exchange.address,
      address,
      false,
      MAINNET_ADRESSES.MCD_JOIN_WBTC_A,
      8,
    )

    let [status, ] = await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'increaseMultiple', params)
    if (status === false){
      throw new Error("tx failed");
    }
    let currentVaultState = await getVaultInfo(mcdView, vault.id, vault.ilk, 8)
    const currentCollRatio = new BigNumber(currentVaultState.coll)
      .times(oraclePrice)
      .div(new BigNumber(currentVaultState.debt))
    expect(currentCollRatio.toFixed(3)).to.be.equal(desiredCollRatio.toFixed(3))
  })

  it(`should decrease vault's multiple`, async function () {
    const desiredCollRatio = initialCollRatio.plus(new BigNumber(0.2))
    const info = await getVaultInfo(mcdView, vault.id, vault.ilk)
    const currentColl = new BigNumber(info.coll)
    const currentDebt = new BigNumber(info.debt)

    let [requiredDebt, toBorrowCollateralAmount] = calculateParamsDecreaseMP(
      oraclePrice,
      marketPrice,
      OF,
      FF,
      currentColl,
      currentDebt,
      desiredCollRatio,
      slippage,
    )

    let desiredCdpState = {
      requiredDebt,
      toBorrowCollateralAmount,
      fromTokenAmount: toBorrowCollateralAmount,
      toTokenAmount: requiredDebt,
    }

    let params = prepareMultiplyParameters2(
      MAINNET_ADRESSES.WBTC,
      MAINNET_ADRESSES.MCD_DAI,
      exchangeStub,
      vault.id,
      desiredCdpState,
      multiplyProxyActions.address,
      exchange.address,
      address,
      false,
      MAINNET_ADRESSES.MCD_JOIN_WBTC_A,
      8,
      true,
    )

    await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'decreaseMultiple', params)

    let currentVaultState = await getVaultInfo(mcdView, vault.id, vault.ilk, 8)
    const currentCollRatio = new BigNumber(currentVaultState.coll)
      .times(oraclePrice)
      .div(new BigNumber(currentVaultState.debt))
    expect(currentCollRatio.toFixed(3)).to.be.equal(desiredCollRatio.toFixed(3))
  })
  /*
  it('should close vault correctly to DAI',async function(){
    const desiredCollRatio = initialCollRatio.plus(new BigNumber(0.2))
    const info = await getVaultInfo(mcdView, vault.id, vault.ilk)
    console.log("getVaultInfo before",info);
    const currentColl = new BigNumber(info.coll)
    const currentDebt = new BigNumber(info.debt)

    let desiredCdpState = {
      requiredDebt:currentDebt,
      toBorrowCollateralAmount: currentColl,
      fromTokenAmount: currentColl,
      toTokenAmount: currentDebt,
    }

    let params = prepareMultiplyParameters2(
      MAINNET_ADRESSES.WBTC,
      MAINNET_ADRESSES.MCD_DAI,
      exchangeStub,
      vault.id,
      desiredCdpState,
      multiplyProxyActions.address,
      exchange.address,
      address,
      false,
      MAINNET_ADRESSES.MCD_JOIN_WBTC_A,
      8,
      true,
    )

    let [status, ] = await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'closeVaultExitDai', params)
    if (status === false){
      throw new Error("tx failed");
    }

    let currentVaultState = await getVaultInfo(mcdView, vault.id, vault.ilk, 8)

    console.log("getVaultInfo after",currentVaultState);
  })
  */
  it('should close vault correctly to collateral',async function(){
    const desiredCollRatio = initialCollRatio.plus(new BigNumber(0.2))
    const info = await getVaultInfo(mcdView, vault.id, vault.ilk)
    console.log("getVaultInfo before",info);
    const currentColl = new BigNumber(info.coll)
    const currentDebt = new BigNumber(info.debt)
    let one = new BigNumber(1);

    const marketPriceSlippage = marketPrice.times(one.minus(slippage))
    const minToTokenAmount = currentDebt.times(one.plus(OF).plus(FF))
    const sellCollateralAmount = minToTokenAmount.div(marketPriceSlippage)

    desiredCdpState = {
      requiredDebt: 0,
      toBorrowCollateralAmount: 0,
      toBorrowCollateralAmount: sellCollateralAmount,
      providedCollateral: 0,
      minToTokenAmount: minToTokenAmount,
    }

    let params = prepareMultiplyParameters2(
      MAINNET_ADRESSES.WBTC,
      MAINNET_ADRESSES.MCD_DAI,
      exchangeStub,
      vault.id,
      desiredCdpState,
      multiplyProxyActions.address,
      exchange.address,
      address,
      false,
      MAINNET_ADRESSES.MCD_JOIN_WBTC_A,
      8,
      true,
    )

    let [status, ] = await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'closeVaultExitCollateral', params)
    if (status === false){
      throw new Error("tx failed");
    }

    let currentVaultState = await getVaultInfo(mcdView, vault.id, vault.ilk, 8)

    console.log("getVaultInfo after",currentVaultState);
  })
})
