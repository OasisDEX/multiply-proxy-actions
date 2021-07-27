const erc20Abi = require('../../abi/IERC20.json');
const {FEE, FEE_BASE, deploySystem,dsproxyExecuteAction, getOraclePrice, getLastCDP, MAINNET_ADRESSES} = require('../../test/common/mcd-deployment-utils');
const {getMarketPrice, exchangeFromDAI, exchangeToDAI, getCurrentBlockNumber} = require('../../test/common/http_apis');
const {calculateParamsIncreaseMP, calculateParamsDecreaseMP, amountToWei, addressRegistryFactory} = require('../../test/common/params-calculation-utils');
const {
  one,
  balanceOf,
  ETH_ADDR,
} = require('../../test/utils.js');
const {
  getVaultInfo
} = require('../../test/utils-mcd.js');
const _ = require('lodash');

const { default: BigNumber } = require('bignumber.js');

const ethers =  hre.ethers;

async function main() {
  console.time("MULTIPLYING");
  
  const provider = new hre.ethers.providers.JsonRpcProvider()
  const signer = provider.getSigner(0);
  const address = await signer.getAddress();  
  console.log("ADDRESS:::", address);

  let blockNumber = await getCurrentBlockNumber();
  
  provider.send("hardhat_reset", [{
    forking: {
      jsonRpcUrl: process.env.ALCHEMY_NODE,
      blockNumber: blockNumber-6
    }
  }])



  let swapParams = {
    tokenIn:MAINNET_ADRESSES.WETH_ADDRESS,
    tokenOut: MAINNET_ADRESSES.WBTC,
    fee: 3000,
    recipient: address,
    deadline: new Date().getTime(),
    amountIn: amountToWei(new BigNumber(20), 18).toFixed(0),
    amountOutMinimum: amountToWei(new BigNumber(1),  8).toFixed(0),
    sqrtPriceLimitX96: 0
  }

  const UniswapRouterV3Abi = require('../../abi/external/ISwapRouter.json')
  const UNISWAP_ROUTER_V3 = "0xe592427a0aece92de3edee1f18e0157c05861564";
  const uniswapV3 = new ethers.Contract(UNISWAP_ROUTER_V3, UniswapRouterV3Abi, provider).connect(signer);
  await uniswapV3.exactInputSingle(swapParams, {value:  amountToWei(new BigNumber(40), 18).toFixed(0)});
  let wbtcB = ethers.utils.formatUnits((await balanceOf(MAINNET_ADRESSES.WBTC, address)).toString(), 8)
  console.log('Wallet WBTC. Balance', wbtcB);
  
  const { mcdView, exchange, multiplyProxyActions, dsProxy, userProxyAddress } = await deploySystem(provider, signer); 

  let caseParams = {
    precision: 18,
    collAmount: new BigNumber(14),
    debtAmount: new BigNumber(0),
    requiredCollRatio: new BigNumber(3),
    pipAddress: MAINNET_ADRESSES.PIP_ETH,
    collAddress: MAINNET_ADRESSES.WETH_ADDRESS,
    daiAddress: MAINNET_ADRESSES.MCD_DAI,
    joinAddress: MAINNET_ADRESSES.MCD_JOIN_ETH_A,
  }

  caseParams = {
    precision: 8,
    collAmount: new BigNumber(0.5),
    debtAmount: new BigNumber(0),
    requiredCollRatio: new BigNumber(1.8),
    pipAddress: MAINNET_ADRESSES.PIP_WBTC,
    collAddress: MAINNET_ADRESSES.WBTC.toLowerCase(),
    daiAddress: MAINNET_ADRESSES.MCD_DAI.toLowerCase(),
    joinAddress: MAINNET_ADRESSES.MCD_JOIN_WBTC_A,
  }

  const { precision, pipAddress, collAddress, daiAddress, joinAddress, collAmount, debtAmount, requiredCollRatio } = caseParams;

  let oraclePrice = await getOraclePrice(provider, pipAddress);
  let marketPrice = await getMarketPrice(collAddress, daiAddress, precision);

  const FF = 0.0009; // FLASHLOAN FEE
  const OF = FEE/FEE_BASE; // OAZO FEE

  const ADDRESS_REGISTRY = addressRegistryFactory(multiplyProxyActions.address, exchange.address);

  console.log('--------- OPEN MULTIPLY VAULT -----------', );

  console.time("Open")

  let currentColl = collAmount; // STARTING COLLATERAL AMOUNT
  let currentDebt = debtAmount; // STARTING VAULT DEBT

  const slippage = new BigNumber(0.08);
  const slippagePercent = slippage.times(new BigNumber(100));
  let [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(oraclePrice, marketPrice, OF, FF, currentColl, currentDebt, requiredCollRatio, slippage);
 
  console.log('Deposit collateral amount:::', currentColl.toString() );
  console.log('Market price:::', marketPrice.toString() );
  console.log('Oracle price:::',  oraclePrice.toString());
  console.log('Debt delta:::', requiredDebt.toNumber() , amountToWei(requiredDebt, precision).toFixed(0));  
  console.log('Collateral delta:::', toBorrowCollateralAmount.toNumber() );

  txData = await exchangeFromDAI(collAddress, requiredDebt, slippagePercent, exchange.address, OF, 18);
 
  console.log('PROXY:::', userProxyAddress );
  console.log("Exchange Address:::',", exchange.address);
  console.log("MPA Address:::',", multiplyProxyActions.address);
  console.log("McdView Address:::',", mcdView.address);
   
  let exchangeData = {
    fromTokenAddress: daiAddress,
    toTokenAddress: collAddress,
    fromTokenAmount: amountToWei(requiredDebt).toFixed(0),
    toTokenAmount: amountToWei(toBorrowCollateralAmount, precision).toFixed(0),
    minToTokenAmount: amountToWei(toBorrowCollateralAmount, precision).toFixed(0),
    exchangeAddress: txData.to,
    _exchangeCalldata: txData.data
  };
   
  let cdpData =  {
    gemJoin: joinAddress,
    fundsReceiver: address,
    cdpId: 0,
    ilk: "0x0000000000000000000000000000000000000000000000000000000000000000",
    borrowCollateral: amountToWei(toBorrowCollateralAmount, precision).toFixed(0),
    requiredDebt: amountToWei(requiredDebt).toFixed(0),
    depositDai: 0,
    depositCollateral: amountToWei(currentColl, precision).toFixed(0),
    withdrawDai: 0,
    withdrawCollateral: 0
  }

  let params = [
    exchangeData,
    cdpData,
    ADDRESS_REGISTRY,
  ]

  const coll = new ethers.Contract(collAddress, erc20Abi, provider).connect(signer);
  await coll.approve(userProxyAddress, amountToWei(currentColl, precision).toFixed(0));


  console.log('Multiplying...');

  await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'openMultiplyVault', params, amountToWei(currentColl, precision).toFixed(0));

  const lastCDP = await getLastCDP(provider, signer, userProxyAddress);
  console.log('CDP Created with ID #', lastCDP.id);
  
  console.timeEnd("Open");


  // const snapshotId = await provider.send("evm_snapshot", []);
  // console.log("Snapshot ID:::", snapshotId);

  let feeBalance = ethers.utils.formatEther((await balanceOf(MAINNET_ADRESSES.MCD_DAI, ADDRESS_REGISTRY.feeRecepient)).toString())
  console.log('Collected Fee So Far:::', feeBalance);

  let collBalance = ethers.utils.formatUnits((await balanceOf(collAddress, address), precision).toString())
  let daiBalance = ethers.utils.formatEther((await balanceOf(daiAddress, address)).toString())
  console.log('Wallet Coll. Balance', collBalance);
  console.log('Wallet Dai Balance', daiBalance);


  // console.log('--------- INCREASE MULTIPLY VAULT -----------');
  // console.time("Increase");
  // let info = await getVaultInfo(mcdView, lastCDP.id, lastCDP.ilk);
  // console.log('VAULT INFO' , info );

  // let reqCollRatioMultiply = new BigNumber(2.2);

  // [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(oraclePrice, marketPrice, OF, FF, currentColl, currentDebt, reqCollRatioMultiply, slippage)

  // console.log('Debt delta', requiredDebt.toNumber() );
  // console.log('Collateral delta', toBorrowCollateralAmount.toNumber() );
  // txData = await exchangeFromDAI(MAINNET_ADRESSES.WETH_ADDRESS, requiredDebt, slippagePercent, exchange.address, OF);

  // exchangeData = {
  //   fromTokenAddress: MAINNET_ADRESSES.MCD_DAI,
  //   toTokenAddress: MAINNET_ADRESSES.WETH_ADDRESS,
  //   fromTokenAmount: amountToWei(requiredDebt).toFixed(0),
  //   toTokenAmount: amountToWei(toBorrowCollateralAmount).toFixed(0),
  //   minToTokenAmount: amountToWei(toBorrowCollateralAmount).toFixed(0),
  //   exchangeAddress: txData.to,
  //   _exchangeCalldata: txData.data
  // }

  // cdpData =  {
  //   gemJoin: joinAddress,
  //   fundsReceiver: address,
  //   cdpId: lastCDP.id,
  //   ilk: "0x0000000000000000000000000000000000000000000000000000000000000000",
  //   borrowCollateral: amountToWei(toBorrowCollateralAmount, 'ETH').toFixed(0),
  //   requiredDebt: amountToWei(requiredDebt, 'ETH').toFixed(0),
  //   depositDai: 0,
  //   depositCollateral: 0,
  //   withdrawDai: 0,
  //   withdrawCollateral: 0
  // }

  // params = [
  //   exchangeData,
  //   cdpData,
  //   ADDRESS_REGISTRY,
  // ]

  // await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'increaseMultiple', params);    
  // info = await getVaultInfo(mcdView, lastCDP.id, lastCDP.ilk);
  // console.log('VAULT INFO' , info );
  
  // feeBalance = ethers.utils.formatEther((await balanceOf(MAINNET_ADRESSES.MCD_DAI, ADDRESS_REGISTRY.feeRecepient)).toString())
  // console.log('Collected Fee So Far:::', feeBalance);

  // console.timeEnd("Increase");
  // // await provider.send("evm_revert", [snapshotId]);

  info = await getVaultInfo(mcdView, lastCDP.id, lastCDP.ilk);
  console.log('VAULT INFO' , info );
  console.log('--------- DECREASE MULTIPLY VAULT -----------');
  console.time("Decrease");


  oraclePrice = await getOraclePrice(provider, pipAddress);
  marketPrice = await getMarketPrice(collAddress, daiAddress, precision);
  console.log('Oracle PRice:', oraclePrice.toString());
  console.log('Market Price', marketPrice.toString())
  currentColl = new BigNumber(info.coll);
  console.log("Current Coll.", currentColl.toString())
  currentDebt = new BigNumber(info.debt);
  console.log("Current Debt.", currentDebt.toString())
  const reqCollRatioDeleverage = new BigNumber(2);

  let [borrowDai, drawCollateral] = calculateParamsDecreaseMP(oraclePrice, marketPrice, OF, FF, currentColl, currentDebt, reqCollRatioDeleverage, slippage);

  console.log('Debt delta', borrowDai.toString() );
  console.log('Collateral delta', drawCollateral.toString(), amountToWei(drawCollateral,8).toFixed(0) );

  txData = await exchangeToDAI(collAddress, drawCollateral, slippagePercent, exchange.address, precision);

  exchangeData = {
    fromTokenAddress: collAddress,
    toTokenAddress: daiAddress,
    fromTokenAmount: amountToWei(drawCollateral, precision).toFixed(0),
    toTokenAmount: amountToWei(borrowDai).toFixed(0),
    minToTokenAmount: amountToWei(borrowDai).toFixed(0),
    exchangeAddress: txData.to,
    _exchangeCalldata: txData.data,
  }

  cdpData = {
    gemJoin: joinAddress,
    fundsReceiver: address,
    cdpId: lastCDP.id,
    ilk: "0x0000000000000000000000000000000000000000000000000000000000000000",
    borrowCollateral: amountToWei(drawCollateral, precision).toFixed(0),
    requiredDebt: amountToWei(borrowDai).toFixed(0),
    depositDai: 0,
    depositCollateral: 0,
    withdrawDai: 0,
    withdrawCollateral: 0
  }

  params = [
    exchangeData,
    cdpData,
    ADDRESS_REGISTRY,
  ]

  await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'decreaseMultiple', params);

  info = await getVaultInfo(mcdView, lastCDP.id, lastCDP.ilk);
  console.log('VAULT INFO' , info );

  feeBalance = ethers.utils.formatEther((await balanceOf(MAINNET_ADRESSES.MCD_DAI, ADDRESS_REGISTRY.feeRecepient)).toString())
  console.log('Collected Fee So Far:::', feeBalance);

  collBalance = ethers.utils.formatUnits((await balanceOf(collAddress, address), precision).toString())
  daiBalance = ethers.utils.formatEther((await balanceOf(daiAddress, address)).toString())
  console.log('Wallet Coll. Balance', collBalance);
  console.log('Wallet Dai Balance', daiBalance);
  console.timeEnd("Decrease");
  
  
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });