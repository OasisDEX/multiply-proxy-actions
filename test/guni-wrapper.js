const {
  deploySystem,
  getOraclePrice,
  dsproxyExecuteAction,
  getLastCDP,
  getVaultInfo,
  balanceOf,
  MAINNET_ADRESSES,
  findMPAEvent,
  swapTokens,
} = require('./common/mcd-deployment-utils')
const { default: BigNumber } = require('bignumber.js')
const {
  amountToWei,
  amountFromWei,
  ensureWeiFormat,
  calculateParamsIncreaseMP,
  calculateParamsDecreaseMP,
  prepareMultiplyParameters,
  packMPAParams,
  prepareMultiplyParameters2,
} = require('./common/params-calculation-utils')
const { expect } = require('chai')
const { one } = require('./utils')

const wethAbi = require('../abi/IWETH.json')
const erc20Abi = require('../abi/IERC20.json')
const spotterAbi = require('../abi/ISpotter.json')

const ethers = hre.ethers

async function checkMPAPostState(tokenAddress, mpaAddress) {
  const daiBalance = await balanceOf(MAINNET_ADRESSES.MCD_DAI, mpaAddress)
  const collateralBalance = await balanceOf(tokenAddress, mpaAddress)

  return {
    daiBalance: new BigNumber(daiBalance.toString()),
    collateralBalance: new BigNumber(collateralBalance.toString()),
  }
}

const guniDaiUsdc = '0xAbDDAfB225e10B90D798bB8A886238Fb835e2053'
const gUniResolver = '0x0317650Af6f184344D7368AC8bB0bEbA5EDB214a'


const addressRegistryFactory = function (
  multiplyProxyActionsInstanceAddress,
  exchangeInstanceAddress,
) {
  return {
    jug: '0x19c0976f590D67707E62397C87829d896Dc0f1F1',
    manager: '0x5ef30b9986345249bc32d8928B7ee64DE9435E39',
    multiplyProxyActions: multiplyProxyActionsInstanceAddress,
    lender: '0x1EB4CF3A948E7D72A198fe073cCb8C7a948cD853',
    feeRecepient: '0x79d7176aE8F93A04bC73b9BC710d4b44f9e362Ce',
    exchange: exchangeInstanceAddress,
  }
}

describe('GUNI Multiply Proxy Action Wrapper with Mocked Exchange', async function () {
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
    WETH,
    guni

  let CDP_ID // this test suite operates on one Vault that is created in first test case
  let CDP_ILK
  let mat

  let mpParams
  let addressRegistry
  let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio
  let guniAddressRegistry

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
          blockNumber: parseInt(process.env.BLOCK_NUMBER),
        },
      },
    ])

    const spotter = new ethers.Contract(MAINNET_ADRESSES.MCD_SPOT, spotterAbi, provider).connect(signer)
    const USDC = new ethers.Contract(MAINNET_ADRESSES.USDC, erc20Abi, provider).connect(signer)
    const GUNIDAIUSDC = new ethers.Contract("0xAbDDAfB225e10B90D798bB8A886238Fb835e2053", erc20Abi, provider).connect(signer)

    let ilk = ethers.utils.formatBytes32String("GUNIV3DAIUSDC1-A")
    mat = await spotter.ilks(ilk);

    const deployment = await deploySystem(provider, signer, true)

    dsProxy = deployment.dsProxyInstance
    multiplyProxyActions = deployment.multiplyProxyActionsInstance
    mcdView = deployment.mcdViewInstance
    userProxyAddress = deployment.userProxyAddress
    exchange = deployment.exchangeInstance
    guni = deployment.guni

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

    await exchange.setFee(0)

    const receivedUSDC = amountToWei(new BigNumber(200), 6).toFixed(0)
    const receivedDAI = amountToWei(new BigNumber(200), 18).toFixed(0)

    await swapTokens(
      MAINNET_ADRESSES.ETH,
      MAINNET_ADRESSES.USDC,
      amountToWei(new BigNumber(100), 18).toFixed(0),
      receivedUSDC,
      address,
      provider,
      signer,
    )

    await swapTokens(
      MAINNET_ADRESSES.ETH,
      MAINNET_ADRESSES.MCD_DAI,
      amountToWei(new BigNumber(100), 18).toFixed(0),
      receivedDAI,
      address,
      provider,
      signer,
    )

    let balanceDAI = await balanceOf(MAINNET_ADRESSES.MCD_DAI, address);
    let balanceUSDC = await balanceOf(MAINNET_ADRESSES.USDC, address);

    await DAI.approve(userProxyAddress, balanceDAI.toString());
    await USDC.approve(userProxyAddress, balanceUSDC.toString());
    USDC.transfer(exchange.address, balanceUSDC);



    marketPrice = await new BigNumber(2380)
    oraclePrice = await getOraclePrice(provider, MAINNET_ADRESSES.PIP_GUNIV3DAIUSDC1)

    await exchange.setPrice(MAINNET_ADRESSES.ETH, amountToWei(marketPrice).toFixed(0))
    await exchange.setPrice(MAINNET_ADRESSES.USDC, amountToWei(new BigNumber(1)).toFixed(0))

    currentColl = new BigNumber(100) // STARTING COLLATERAL AMOUNT
    currentDebt = new BigNumber(0) // STARTING VAULT DEBT

    requiredCollRatio = new BigNumber(3)

    addressRegistry = addressRegistryFactory(multiplyProxyActions.address, exchange.address);
  });

  it('should open Guni multiplied vault with required collateralisation ratio', async function () {
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

    mpParams = prepareMultiplyParameters(
      exchangeDataMock,
      desiredCdpState,
      multiplyProxyActions.address,
      exchange.address,
      address,
      false,
    )
    const { params, exchangeData, cdpData } = mpParams
    const divider = amountFromWei(mat[1].toString(), 27).minus(1);
    const daiBal = new BigNumber(10000);
    const expectedCR = new BigNumber(1.05);
    const leveragedAmount = daiBal.div(expectedCR.minus(one));
    const flAmount = leveragedAmount.minus(daiBal);

    const usdcAmount = await guni.getOtherTokenAmount(guniDaiUsdc, gUniResolver, amountToWei(leveragedAmount).toFixed(0), 6);

    cdpData.gemJoin = "0xbFD445A97e7459b0eBb34cfbd3245750Dba4d7a4";
    cdpData.skipFL = true;
    cdpData.requiredDebt = amountToWei(flAmount).toFixed(0);

    exchangeData.fromTokenAmount = usdcAmount.toString(); //amountToWei(daiBal).toFixed(0); // assuming 1 dai = 1 usdc . TO DO: change to DAI USDC swap with slippage
    exchangeData.fromTokenAddress = MAINNET_ADRESSES.MCD_DAI;
    exchangeData.minToTokenAmount = usdcAmount.toString();
    exchangeData.toTokenAddress = MAINNET_ADRESSES.USDC;

    guniAddressRegistry = {
      'guni': '0xAbDDAfB225e10B90D798bB8A886238Fb835e2053',
      'resolver': '0x0317650Af6f184344D7368AC8bB0bEbA5EDB214a',
      'router': '0x14E6D67F824C3a7b4329d3228807f8654294e4bd',
      'guniProxyActions': guni.address,
      'otherToken': MAINNET_ADRESSES.USDC,
    }

    let params2 = [
      exchangeData,
      cdpData,
      addressRegistry,
      guniAddressRegistry,
      amountToWei(daiBal).toFixed(0)
    ]

    var [status, result] = await dsproxyExecuteAction(
      guni,
      dsProxy,
      address,
      'openMultiplyGuniVault',
      params2,
      0
    )

    if (status == false) {
      throw result
    }

    const lastCDP = await getLastCDP(provider, signer, userProxyAddress)
    let info = await getVaultInfo(mcdView, lastCDP.id, lastCDP.ilk)

    // CDP_ID = lastCDP.id
    // CDP_ILK = lastCDP.ilk

    const currentCollRatio = new BigNumber(info.coll)
      .times(oraclePrice)
      .div(new BigNumber(info.debt))
    const { daiBalance, collateralBalance } = await checkMPAPostState(
      MAINNET_ADRESSES.ETH,
      multiplyProxyActions.address,
    )

    const requiredTotalCollateral = currentColl.plus(toBorrowCollateralAmount)
    const resultTotalCollateral = new BigNumber(info.coll)

    expect(currentCollRatio.toFixed(2), 'coll ratio').to.be.equal('1.05')

  })


  it('should close exiting Guni vault and return Dai to user', async function () {
    const { params, exchangeData, cdpData } = mpParams
    cdpData.cdpId = 25897;

    let params4 = [
      exchangeData,
      cdpData,
      addressRegistry,
      guniAddressRegistry
    ]

    var [status, result] = await dsproxyExecuteAction(
      guni,
      dsProxy,
      address,
      'closeGuniVaultExitDai',
      params4,
      0
    )

    const lastCDP = await getLastCDP(provider, signer, userProxyAddress)
    let info = await getVaultInfo(mcdView, lastCDP.id, lastCDP.ilk)

    const currentCollRatio = new BigNumber(info.coll)
      .times(oraclePrice)
      .div(new BigNumber(info.debt))
    const { daiBalance, collateralBalance } = await checkMPAPostState(
      MAINNET_ADRESSES.ETH,
      multiplyProxyActions.address,
    )
    const resultTotalCollateral = new BigNumber(info.coll)
  });
});