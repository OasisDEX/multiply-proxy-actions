const { deploySystem, getOraclePrice, dsproxyExecuteAction, getLastCDP, getVaultInfo, balanceOf, MAINNET_ADRESSES } = require('./common/mcd-deployment-utils');
const { default: BigNumber } = require('bignumber.js');
const { amountToWei, calculateParamsIncreaseMP, calculateParamsDecreaseMP, prepareMultiplyParameters } = require('./common/params-calculation-utils');
const { expect } = require("chai");
const { one } = require('./utils');

const UniswapRouterV3Abi = require('../abi/external/IUniswapRouter.json')
const wethAbi = require('../abi/IWETH.json')
const erc20Abi = require('../abi/IERC20.json')

const ethers = hre.ethers

async function addFundsDummyExchange(provider, signer, address, WETH, DAI, exchange) {
  const UNISWAP_ROUTER_V3 = "0xe592427a0aece92de3edee1f18e0157c05861564";
  const uniswapV3 = new ethers.Contract(UNISWAP_ROUTER_V3, UniswapRouterV3Abi, provider).connect(signer);

  let swapParams = {
    tokenIn:MAINNET_ADRESSES.ETH,
    tokenOut: MAINNET_ADRESSES.MCD_DAI,
    fee: 3000,
    recipient: address,
    deadline: 1751366148,
    amountIn: amountToWei(new BigNumber(400), 'ETH').toFixed(0),
    amountOutMinimum: amountToWei(new BigNumber(400000), 'ETH').toFixed(0),
    sqrtPriceLimitX96: 0
  }
  await uniswapV3.exactInputSingle(swapParams, {value:  amountToWei(new BigNumber(400), 'ETH').toFixed(0)});
  
  await WETH.deposit({
    value: amountToWei(new BigNumber(1000), 'ETH').toFixed(0)
  });

  await WETH.transfer(exchange.address, amountToWei(new BigNumber(500), 'ETH').toFixed(0));
  await DAI.transfer(exchange.address, amountToWei(new BigNumber(400000), 'ETH').toFixed(0));
}

async function checkMPAPostState(tokenAddress, mpaAddress) {
  const daiBalance = await balanceOf(MAINNET_ADRESSES.MCD_DAI, mpaAddress);
  const collateralBalance = await balanceOf(tokenAddress, mpaAddress);

  return { daiBalance: new BigNumber(daiBalance.toString()), collateralBalance: new BigNumber(collateralBalance.toString()) };
}

describe("Multiply Proxy Action with Mocked Exchange", async function() {

  let provider, signer, address, mcdView, exchange, multiplyProxyActions, dsProxy, userProxyAddress, OF, FF, slippage, exchangeDataMock, DAI, WETH;

  let CDP_ID; // this test suite operates on one Vault that is created in first test case (opening Multiply Vault)
  let CDP_ILK;

  this.beforeAll(async function() {
    provider = new hre.ethers.providers.JsonRpcProvider()
    signer = provider.getSigner(0)  
    address = await signer.getAddress();  
    
    provider.send("hardhat_reset", [{
      forking: {
        jsonRpcUrl: process.env.ALCHEMY_NODE,
        blockNumber: 12831000
      }
    }]);

    WETH = new ethers.Contract(MAINNET_ADRESSES.ETH, wethAbi, provider).connect(signer);
    DAI = new ethers.Contract(MAINNET_ADRESSES.MCD_DAI, erc20Abi, provider).connect(signer);

    const deployment = await deploySystem(provider, signer);
    
    // ({ dsProxy, exchange, multiplyProxyActions, mcdView }) = deployment;
    dsProxy = deployment.dsProxy;
    multiplyProxyActions = deployment.multiplyProxyActions;
    mcdView = deployment.mcdView;
    userProxyAddress = deployment.userProxyAddress;

    // Replace real Exchange contract with DummyExchange contract for testing purposes
    const Exchange = await ethers.getContractFactory("DummyExchange", signer);
    exchange = await Exchange.deploy();
    await exchange.deployed();

    await addFundsDummyExchange(provider, signer, address, WETH, DAI, exchange);

    exchangeDataMock = {
      to: exchange.address,
      data: 0,
    }
    

    const OazoFee = 2;  // divided by base (10000), 1 = 0.01%;
    OF = new BigNumber(OazoFee/10000); // OAZO FEE
    FF = new BigNumber(0.0009); // FLASHLOAN FEE
    slippage = new BigNumber(0.0001); // Percent

    await exchange.setFee(OazoFee);
  });

  describe(`opening Multiply Vault`, async function() {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio;

    this.beforeAll(async function() {
      marketPrice = await new BigNumber(2380);
      oraclePrice = await getOraclePrice(provider);
    
      await exchange.setPrice(amountToWei(marketPrice).toFixed(0));
    
      currentColl = new BigNumber(100); // STARTING COLLATERAL AMOUNT
      currentDebt = new BigNumber(0); // STARTING VAULT DEBT
    });

    it(`should open vault with required collateralisation ratio`, async function() {
      requiredCollRatio = new BigNumber(3);     
      let [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(oraclePrice, marketPrice, OF, FF, currentColl, currentDebt, requiredCollRatio, slippage);
      let desiredCdpState = {
        requiredDebt,
        toBorrowCollateralAmount,
        providedCollateral: currentColl,
        fromTokenAmount: requiredDebt,
        toTokenAmount: toBorrowCollateralAmount,
      };
      let params = prepareMultiplyParameters(MAINNET_ADRESSES.MCD_DAI, MAINNET_ADRESSES.ETH, exchangeDataMock, 0, desiredCdpState, multiplyProxyActions.address, exchange.address, address);
      await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'openMultiplyVault', params, amountToWei(currentColl, 'ETH').toFixed(0));
      const lastCDP = await getLastCDP(provider, signer, userProxyAddress);
      let info = await getVaultInfo(mcdView, lastCDP.id, lastCDP.ilk);
      CDP_ID = lastCDP.id;
      CDP_ILK = lastCDP.ilk;
      const currentCollRatio = new BigNumber(info.coll).times(oraclePrice).div(new BigNumber(info.debt));
      const { daiBalance, collateralBalance } = await checkMPAPostState(MAINNET_ADRESSES.ETH, multiplyProxyActions.address);

      const requiredTotalCollateral = currentColl.plus(toBorrowCollateralAmount);
      const resultTotalCollateral = new BigNumber(info.coll);
      
      expect(daiBalance.toFixed(0)).to.be.equal('0');
      expect(collateralBalance.toFixed(0)).to.be.equal('0');
      expect(currentCollRatio.toFixed(2)).to.be.equal(requiredCollRatio.toFixed(2));
      expect(resultTotalCollateral.gte(requiredTotalCollateral)).to.be.true;

    });

    // it(`should fail opening new vault with collateralization below min. collRatio limit`, async function() {
    //   requiredCollRatio = new BigNumber(1.4);  
    //   let [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(oraclePrice, marketPrice, OF, FF, currentColl, currentDebt, requiredCollRatio, slippage);
    //   let desiredCdpState = {
    //     requiredDebt,
    //     toBorrowCollateralAmount,
    //     providedCollateral: currentColl,
    //     fromTokenAmount: requiredDebt,
    //     toTokenAmount: toBorrowCollateralAmount,
    //   };
    //   let params = prepareMultiplyParameters(MAINNET_ADRESSES.MCD_DAI, MAINNET_ADRESSES.ETH, exchangeDataMock, 0, desiredCdpState, multiplyProxyActions.address, exchange.address, address);
    //   const result = await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'openMultiplyVault', params, amountToWei(currentColl, 'ETH').toFixed(0));
          
    //   expect(result).to.be.false;
    // });
  });

  describe(`Increasing Multiple`, async function() {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio;

    this.beforeAll(async function() {
      marketPrice = await new BigNumber(2380);
      oraclePrice = await getOraclePrice(provider);
    
      await exchange.setPrice(amountToWei(marketPrice).toFixed(0));
    
      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK);
      currentColl = new BigNumber(info.coll);
      currentDebt = new BigNumber(info.debt);
    });

    it(`should increase vault's multiple to required collateralization ratio`, async function() {
      requiredCollRatio = new BigNumber(2.6);

      [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(oraclePrice, marketPrice, OF, FF, currentColl, currentDebt, requiredCollRatio, slippage);

      desiredCdpState = {
        requiredDebt,
        toBorrowCollateralAmount,
        fromTokenAmount: requiredDebt,
        toTokenAmount: toBorrowCollateralAmount,
      };

      params = prepareMultiplyParameters(MAINNET_ADRESSES.MCD_DAI, MAINNET_ADRESSES.ETH, exchangeDataMock, CDP_ID, desiredCdpState, multiplyProxyActions.address, exchange.address, address);

      await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'increaseMultiple', params);    
      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK);
      const currentCollRatio = new BigNumber(info.coll).times(oraclePrice).div(new BigNumber(info.debt));
      const { daiBalance, collateralBalance } = await checkMPAPostState(MAINNET_ADRESSES.ETH, multiplyProxyActions.address);

      expect(daiBalance.toFixed(0)).to.be.equal('0');
      expect(collateralBalance.toFixed(0)).to.be.equal('0');
      expect(currentCollRatio.toFixed(3)).to.be.equal(requiredCollRatio.toFixed(3));
    });
  });

  describe(`Increasing Multiple deposit Dai`, async function() {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio;

    this.beforeAll(async function() {
      marketPrice = await new BigNumber(2380);
      oraclePrice = await getOraclePrice(provider);
    
      await exchange.setPrice(amountToWei(marketPrice).toFixed(0));
    
      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK);
      currentColl = new BigNumber(info.coll);
      currentDebt = new BigNumber(info.debt);
    });

    it(`should increase vault's multiple to required collateralization ratio with additional Dai deposited`, async function() {
      requiredCollRatio = new BigNumber(2.2);
      const daiDeposit = new BigNumber(300);

      await DAI.approve(userProxyAddress, amountToWei(daiDeposit, 'ETH').toFixed(0));

      [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(oraclePrice, marketPrice, OF, FF, currentColl, currentDebt, requiredCollRatio, slippage, daiDeposit)

      desiredCdpState = {
        requiredDebt,
        toBorrowCollateralAmount,
        providedDai: daiDeposit,
        fromTokenAmount: requiredDebt,
        toTokenAmount: toBorrowCollateralAmount,
      };

      params = prepareMultiplyParameters(MAINNET_ADRESSES.MCD_DAI, MAINNET_ADRESSES.ETH, exchangeDataMock, CDP_ID, desiredCdpState, multiplyProxyActions.address, exchange.address, address);

      await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'increaseMultipleDepositDai', params);    
      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK);
      const currentCollRatio = new BigNumber(info.coll).times(oraclePrice).div(new BigNumber(info.debt));
      const { daiBalance, collateralBalance } = await checkMPAPostState(MAINNET_ADRESSES.ETH, multiplyProxyActions.address);

      expect(daiBalance.toFixed(0)).to.be.equal('0');
      expect(collateralBalance.toFixed(0)).to.be.equal('0');
      expect(currentCollRatio.toFixed(3)).to.be.equal(requiredCollRatio.toFixed(3));
    });

  });

  describe(`Increasing Multiple deposit collateral`, async function() {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio;

    this.beforeAll(async function() {
      marketPrice = await new BigNumber(2380);
      oraclePrice = await getOraclePrice(provider);
    
      await exchange.setPrice(amountToWei(marketPrice).toFixed(0));
    
      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK);
      currentColl = new BigNumber(info.coll);
      currentDebt = new BigNumber(info.debt);
    });

    it(`should increase vault's multiple to required collateralization ratio with additional collateral deposited`, async function() {
      requiredCollRatio = new BigNumber(1.9);
      const collateralDeposit = new BigNumber(5);
      [requiredDebt, toBorrowCollateralAmount] = calculateParamsIncreaseMP(oraclePrice, marketPrice, OF, FF, currentColl.plus(collateralDeposit), currentDebt, requiredCollRatio, slippage)

      desiredCdpState = {
        requiredDebt,
        toBorrowCollateralAmount,
        providedCollateral: collateralDeposit,
        fromTokenAmount: requiredDebt,
        toTokenAmount: toBorrowCollateralAmount,
      };

      params = prepareMultiplyParameters(MAINNET_ADRESSES.MCD_DAI, MAINNET_ADRESSES.ETH, exchangeDataMock, CDP_ID, desiredCdpState, multiplyProxyActions.address, exchange.address, address);

      await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'increaseMultipleDepositCollateral', params, amountToWei(collateralDeposit, 'ETH').toFixed(0));    
      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK);
      const currentCollRatio = new BigNumber(info.coll).times(oraclePrice).div(new BigNumber(info.debt));
      const { daiBalance, collateralBalance } = await checkMPAPostState(MAINNET_ADRESSES.ETH, multiplyProxyActions.address);

      expect(daiBalance.toFixed(0)).to.be.equal('0');
      expect(collateralBalance.toFixed(0)).to.be.equal('0');
      expect(currentCollRatio.toFixed(3)).to.be.equal(requiredCollRatio.toFixed(3)); 
    });
  });

  describe(`Decrease Multiple`, async function() {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio;

    this.beforeAll(async function() {
      marketPrice = await new BigNumber(2380);
      oraclePrice = await getOraclePrice(provider);
    
      await exchange.setPrice(amountToWei(marketPrice).toFixed(0));
    
      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK);
      currentColl = new BigNumber(info.coll);
      currentDebt = new BigNumber(info.debt);
    });

    it(`should decrease vault's multiple to required collateralization ratio`, async function() {
      requiredCollRatio = new BigNumber(2.8);
      [requiredDebt, toBorrowCollateralAmount] = calculateParamsDecreaseMP(oraclePrice, marketPrice, OF, FF, currentColl, currentDebt, requiredCollRatio, slippage);

      desiredCdpState = {
        requiredDebt,
        toBorrowCollateralAmount,
        fromTokenAmount: toBorrowCollateralAmount,
        toTokenAmount: requiredDebt
      };

      params = prepareMultiplyParameters(MAINNET_ADRESSES.ETH, MAINNET_ADRESSES.MCD_DAI, exchangeDataMock, CDP_ID, desiredCdpState, multiplyProxyActions.address, exchange.address, address);

      await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'decreaseMultiple', params);

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK);
      const currentCollRatio = new BigNumber(info.coll).times(oraclePrice).div(new BigNumber(info.debt));
      const { daiBalance, collateralBalance } = await checkMPAPostState(MAINNET_ADRESSES.ETH, multiplyProxyActions.address);

      expect(daiBalance.toFixed(0)).to.be.equal('0');
      expect(collateralBalance.toFixed(0)).to.be.equal('0');
      expect(currentCollRatio.toFixed(3)).to.be.equal(requiredCollRatio.toFixed(3));
    });
  });

  describe(`Decrease Multiple withdraw Dai`, async function() {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio;

    this.beforeAll(async function() {
      marketPrice = await new BigNumber(2380);
      oraclePrice = await getOraclePrice(provider);
    
      await exchange.setPrice(amountToWei(marketPrice).toFixed(0));
    
      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK);
      currentColl = new BigNumber(info.coll);
      currentDebt = new BigNumber(info.debt);
    });

    it(`should decrease vault's multiple to required collateralization ratio with additional Dai withdrawn`, async function() {
      requiredCollRatio = new BigNumber(3.2);
      const withdrawDai = new BigNumber(200);

      [requiredDebt, toBorrowCollateralAmount] = calculateParamsDecreaseMP(oraclePrice, marketPrice, OF, FF, currentColl, currentDebt.plus(withdrawDai), requiredCollRatio, slippage);

      desiredCdpState = {
        withdrawDai,
        requiredDebt,
        toBorrowCollateralAmount,
        fromTokenAmount: toBorrowCollateralAmount,
        toTokenAmount: requiredDebt,
      };

      params = prepareMultiplyParameters(MAINNET_ADRESSES.ETH, MAINNET_ADRESSES.MCD_DAI, exchangeDataMock, CDP_ID, desiredCdpState, multiplyProxyActions.address, exchange.address, address);  

      await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'decreaseMultipleWithdrawDai', params);

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK);
      const currentCollRatio = new BigNumber(info.coll).times(oraclePrice).div(new BigNumber(info.debt));
      const { daiBalance, collateralBalance } = await checkMPAPostState(MAINNET_ADRESSES.ETH, multiplyProxyActions.address);

      expect(daiBalance.toFixed(0)).to.be.equal('0');
      expect(collateralBalance.toFixed(0)).to.be.equal('0');
      expect(currentCollRatio.toFixed(3)).to.be.equal(requiredCollRatio.toFixed(3));
    });

  });

  describe(`Decrease Multiple withdraw collateral`, async function() {
    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio;

    this.beforeAll(async function() {
      marketPrice = await new BigNumber(2380);
      oraclePrice = await getOraclePrice(provider);
    
      await exchange.setPrice(amountToWei(marketPrice).toFixed(0));
    
      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK);
      currentColl = new BigNumber(info.coll);
      currentDebt = new BigNumber(info.debt);
    });

    it(`should decrease vault's multiple to required collateralization ratio with additional collateral withdrawn`, async function() {
      requiredCollRatio = new BigNumber(3.8);
      const withdrawCollateral = new BigNumber(8);

      [requiredDebt, toBorrowCollateralAmount] = calculateParamsDecreaseMP(oraclePrice, marketPrice, OF, FF, currentColl.minus(withdrawCollateral), currentDebt, requiredCollRatio, slippage);

      desiredCdpState = {
        withdrawCollateral,
        requiredDebt,
        toBorrowCollateralAmount,
        fromTokenAmount: toBorrowCollateralAmount,
        toTokenAmount: requiredDebt,
      };

      params = prepareMultiplyParameters(MAINNET_ADRESSES.ETH, MAINNET_ADRESSES.MCD_DAI, exchangeDataMock, CDP_ID, desiredCdpState, multiplyProxyActions.address, exchange.address, address);  

      await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'decreaseMultipleWithdrawCollateral', params);

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK);
      const currentCollRatio = new BigNumber(info.coll).times(oraclePrice).div(new BigNumber(info.debt));
      const { daiBalance, collateralBalance } = await checkMPAPostState(MAINNET_ADRESSES.ETH, multiplyProxyActions.address);

      expect(daiBalance.toFixed(0)).to.be.equal('0');
      expect(collateralBalance.toFixed(0)).to.be.equal('0');
      expect(currentCollRatio.toFixed(3)).to.be.equal(requiredCollRatio.toFixed(3));
    });
  });

  // To use this test comment out 'Close vault and exit all collateral' as there cannot be two closing actions together
  
  // describe(`Close vault and exit all Dai`, async function() {

  //   let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio;

  //   this.beforeAll(async function() {
  //     marketPrice = await new BigNumber(2380);
  //     oraclePrice = await getOraclePrice(provider);
    
  //     await exchange.setPrice(amountToWei(marketPrice).toFixed(0));
    
  //     info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK);
  //     currentColl = new BigNumber(info.coll);
  //     currentDebt = new BigNumber(info.debt);
  //   });

  //   it(`should close vault and return Dai`, async function() {
  //     const minToTokenAmount = currentDebt.times(one.plus(OF).plus(FF));
      
  //     desiredCdpState = {
  //       requiredDebt: 0,
  //       toBorrowCollateralAmount: 0,
  //       fromTokenAmount: amountToWei(currentColl).toFixed(0),
  //       toTokenAmount: minToTokenAmount,
  //     };

  //     params = prepareMultiplyParameters(MAINNET_ADRESSES.ETH, MAINNET_ADRESSES.MCD_DAI, exchangeDataMock, CDP_ID, desiredCdpState, multiplyProxyActions.address, exchange.address, address);  

  //     await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'closeVaultExitDai', params);

  //     info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK);
  //     const { daiBalance, collateralBalance } = await checkMPAPostState(MAINNET_ADRESSES.ETH, multiplyProxyActions.address);

  //     expect(daiBalance.toFixed(0)).to.be.equal('0');
  //     expect(collateralBalance.toFixed(0)).to.be.equal('0');
  //     expect(info.debt.toString()).to.be.equal('0');
  //     expect(info.coll.toString()).to.be.equal('0');
  //   });
  // });

  describe(`Close vault and exit all collateral`, async function() {

    let marketPrice, oraclePrice, currentColl, currentDebt, requiredCollRatio;

    this.beforeAll(async function() {
      marketPrice = await new BigNumber(2380);
      oraclePrice = await getOraclePrice(provider);
    
      await exchange.setPrice(amountToWei(marketPrice).toFixed(0));
    
      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK);
      currentColl = new BigNumber(info.coll);
      currentDebt = new BigNumber(info.debt);
    });

    it(`should close vault and return  collateral`, async function() {
      await exchange.setPrice(amountToWei(marketPrice).toFixed(0));

      const marketPriceSlippage = marketPrice.times(one.minus(slippage));
      const minToTokenAmount = currentDebt.times(one.plus(OF).plus(FF));
      const sellCollateralAmount = minToTokenAmount.div(marketPriceSlippage);

      desiredCdpState = {
        requiredDebt: 0,
        toBorrowCollateralAmount: 0,
        fromTokenAmount: sellCollateralAmount,
        toTokenAmount: minToTokenAmount,
      };
      
      params = prepareMultiplyParameters(MAINNET_ADRESSES.ETH, MAINNET_ADRESSES.MCD_DAI, exchangeDataMock, CDP_ID, desiredCdpState, multiplyProxyActions.address, exchange.address, address);  

      await dsproxyExecuteAction(multiplyProxyActions, dsProxy, address, 'closeVaultExitCollateral', params);

      info = await getVaultInfo(mcdView, CDP_ID, CDP_ILK);
      const { daiBalance, collateralBalance } = await checkMPAPostState(MAINNET_ADRESSES.ETH, multiplyProxyActions.address);

      expect(daiBalance.toFixed(0)).to.be.equal('0');
      expect(collateralBalance.toFixed(0)).to.be.equal('0');
      expect(info.debt.toString()).to.be.equal('0');
      expect(info.coll.toString()).to.be.equal('0');
    });
  });
});
