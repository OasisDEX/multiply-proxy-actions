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
const GUNITokenAbi = require('../abi/IGUNIToken.json')

const ethers = hre.ethers

async function checkMPAPostState(tokenAddress, mpaAddress) {
  const daiBalance = await balanceOf(MAINNET_ADRESSES.MCD_DAI, mpaAddress)
  const collateralBalance = await balanceOf(tokenAddress, mpaAddress)

  return {
    daiBalance: new BigNumber(daiBalance.toString()),
    collateralBalance: new BigNumber(collateralBalance.toString()),
  }
}

(async function () {

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

  let CDP_ID // this test suite operates on one Vault that is created in first test case (opening Multiply Vault)
  let CDP_ILK

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
  const GUNIDAIUSDCPool = new ethers.Contract("0xAbDDAfB225e10B90D798bB8A886238Fb835e2053", GUNITokenAbi, provider).connect(signer)

  let ilk = ethers.utils.formatBytes32String("GUNIV3DAIUSDC1-A")
  const mat = await spotter.ilks(ilk);

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

  const OazoFee = 20 // divided by base (10000), 1 = 0.01%;
  OF = new BigNumber(OazoFee / 10000) // OAZO FEE
  FF = new BigNumber(0.0009) // FLASHLOAN FEE
  slippage = new BigNumber(0.0001) // Percent

  // await exchange.setSlippage(0);
  // await exchange.setMode(0);

  await exchange.setFee(OazoFee)

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
  // console.log('DAI balance', balanceDAI.toString());
  // console.log('USDC balance', balanceUSDC.toString());
  // console.log('DAI approval', balanceDAI.toString());

  await DAI.approve(userProxyAddress, balanceDAI.toString());
  await USDC.approve(userProxyAddress, balanceUSDC.toString());
  USDC.transfer(exchange.address, balanceUSDC);

  const usdcDecimals = await USDC.decimals();


  let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio

  marketPrice = await new BigNumber(2380)
  oraclePrice = await getOraclePrice(provider, MAINNET_ADRESSES.PIP_GUNIV3DAIUSDC1)

  console.log('ORACLE PRICE', oraclePrice.toString());

  await exchange.setPrice(MAINNET_ADRESSES.ETH, amountToWei(marketPrice).toFixed(0))
  await exchange.setPrice(MAINNET_ADRESSES.USDC, amountToWei(new BigNumber(1)).toFixed(0))

  currentColl = new BigNumber(100) // STARTING COLLATERAL AMOUNT
  currentDebt = new BigNumber(0) // STARTING VAULT DEBT


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

  let { params, exchangeData, cdpData } = prepareMultiplyParameters(
    exchangeDataMock,
    desiredCdpState,
    multiplyProxyActions.address,
    exchange.address,
    address,
    false,
  )

  const guniDaiUsdc = '0xAbDDAfB225e10B90D798bB8A886238Fb835e2053';
  const gUniResolver = '0x0317650Af6f184344D7368AC8bB0bEbA5EDB214a'
  // const amount = await guni.getOtherTokenAmount(guniDaiUsdc, gUniResolver, amountToWei(daiBal, 18).toFixed(0), 6);


  const divider = amountFromWei(mat[1].toString(), 27).minus(1);
  console.log('divider', divider.toString());

  const daiBal = new BigNumber(10000);
  const expectedCR = new BigNumber(1.05);
  const leveragedAmount = daiBal.div(expectedCR.minus(one));
  const flAmount = leveragedAmount.minus(daiBal);

  let usdcAmount = await guni.getOtherTokenAmount(guniDaiUsdc, gUniResolver, amountToWei(leveragedAmount).toFixed(0), 6);  
  usdcAmount = new BigNumber(usdcAmount.toString());    
  const daiAmount = leveragedAmount.times(10**18).minus(usdcAmount);

  console.log('USDC AMOUNT', usdcAmount.toString());
  console.log('DAI AMOUNT', daiAmount.toString());
  
  const slippageFee = usdcAmount.times( new BigNumber(0.001).plus(OF));

  const usdcAmountSlippageFee = usdcAmount.times( one.minus(0.001).minus(OF));
  console.log('usdcAmount', usdcAmountSlippageFee.toFixed(0));
  console.log('daiAmount', daiAmount.toFixed(0));

  // const amounts = await GUNIDAIUSDCPool.getMintAmounts(
  //   amountToWei(daiAmount).toFixed(0),
  //   amountToWei(usdcAmountSlippageFee).toFixed(0)
  // )

  // console.log('AMOUNTS', amounts.mintAmount.toString() );
  
  cdpData.gemJoin = "0xbFD445A97e7459b0eBb34cfbd3245750Dba4d7a4";
  cdpData.requiredDebt = amountToWei(flAmount).toFixed(0);
  cdpData.token0Amount = amountToWei(daiBal).toFixed(0); 

  exchangeData.fromTokenAmount = usdcAmount.toFixed(0); //amountToWei(daiBal).toFixed(0); // assuming 1 dai = 1 usdc . TO DO: change to DAI USDC swap with slippage !!!
  exchangeData.fromTokenAddress = MAINNET_ADRESSES.MCD_DAI;
  exchangeData.minToTokenAmount = usdcAmountSlippageFee.toFixed(0);
  exchangeData.toTokenAddress = MAINNET_ADRESSES.USDC;

  const guniAddressRegistry = {
    guni: '0xAbDDAfB225e10B90D798bB8A886238Fb835e2053',
    resolver: '0x0317650Af6f184344D7368AC8bB0bEbA5EDB214a',
    router: '0x14E6D67F824C3a7b4329d3228807f8654294e4bd',
    guniProxyActions: guni.address,
    otherToken: MAINNET_ADRESSES.USDC,
    exchange: exchange.address,
    jug: '0x19c0976f590D67707E62397C87829d896Dc0f1F1',
    manager: '0x5ef30b9986345249bc32d8928B7ee64DE9435E39',
    lender: '0x1EB4CF3A948E7D72A198fe073cCb8C7a948cD853',
  }

  // MULTIPLY

  let params2 = [
    exchangeData,
    cdpData,
    guniAddressRegistry
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

  // // close to DAI
  // cdpData.cdpId = 25897;
  // cdpData.depositDai = 0; 

  // let params4 = [
  //   exchangeData,
  //   cdpData,
  //   guniAddressRegistry
  // ]

  // var [status, result] = await dsproxyExecuteAction(
  //   guni,
  //   dsProxy,
  //   address,
  //   'closeGuniVaultExitDai',
  //   params4,
  //   0
  // )

  const lastCDP = await getLastCDP(provider, signer, userProxyAddress)
  console.log('lastCDP', lastCDP);
  let info = await getVaultInfo(mcdView, lastCDP.id, lastCDP.ilk)

  console.log('CDP INFO', info);

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

  console.log('RESULT COLLATERAL', resultTotalCollateral.toString());
  console.log('RESULT COLL RATIO', currentCollRatio.toString());

})()