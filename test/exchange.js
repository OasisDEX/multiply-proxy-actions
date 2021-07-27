const { init, balanceOf, MAINNET_ADRESSES, addressRegistryFactory, FEE, FEE_BASE, ONE } = require('./common/mcd-deployment-utils');
const { expect } = require("chai");
const { amountFromWei, amountToWei } = require('./common/params-calculation-utils');
const { exchangeToDAI } = require('./common/http_apis');
const wethAbi = require('../abi/IWETH.json')
const erc20Abi = require('../abi/IERC20.json')
const BigNumber = require('bignumber.js');
const { zero } = require('./utils');
const _ = require('lodash')

BigNumber.config({ DECIMAL_PLACES: 22 });

const AGGREGATOR_V3_ADDRESS = "0x11111112542d85b3ef69ae05771c2dccff4faa26"

const ethers = hre.ethers

function asPercentageValue(value, base) {
  value = !BigNumber.isBigNumber(value)
    ? new BigNumber(value) 
    : value
  
  return {
    get value() {
      return value;
    },

    asDecimal: value.div(new BigNumber(base))
  }
}

function asBigNumber(value) {
  if(BigNumber.isBigNumber(value)) {
    return new BigNumber(value.toString())
  }

  return new BigNumber(value)
}

describe("Exchanging", async function () {
  let provider, signer, address, exchange, WETH, DAI, feeBeneficiary, slippage, fee, snapshotId, initialDaiWalletBalance;

  this.beforeAll(async function(){
    let [_provider, _signer] = await init(undefined, provider, signer);
    provider = _provider
    signer = _signer
    address = await signer.getAddress();

    feeBeneficiary = addressRegistryFactory(undefined, undefined).feeRecepient
    slippage = asPercentageValue(8, 100);
    fee = asPercentageValue(FEE, FEE_BASE)

    const Exchange = await ethers.getContractFactory("Exchange", signer);
    exchange = await Exchange.deploy(address, feeBeneficiary, fee.value.toString());
    await exchange.deployed();    

    WETH = new ethers.Contract(MAINNET_ADRESSES.ETH, wethAbi, provider).connect(signer);
    DAI = new ethers.Contract(MAINNET_ADRESSES.MCD_DAI, erc20Abi, provider).connect(signer);

    snapshotId = await provider.send("evm_snapshot", []);
  })

  this.afterEach(async function() {
    await provider.send("evm_revert", [snapshotId]);
  })

  describe('Asset for DAI', async function() {    
    const amount = new BigNumber(10);
    const amountInWei = amountToWei(amount).toFixed(0);
    let receiveAtLeastInWei;
    let to, data;

    this.beforeAll(async function() {      
      const response = await exchangeToDAI(MAINNET_ADRESSES.ETH, amountInWei, exchange.address, slippage.value.toString());      
      initialDaiWalletBalance = asBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address));   
  
      const { toTokenAmount, tx: { to: _to, data: _data } } = response
      to = _to;
      data = _data;
  
      const receiveAtLeast = new BigNumber(amountFromWei(toTokenAmount)).times(ONE.minus(slippage.asDecimal));
      receiveAtLeastInWei = amountToWei(receiveAtLeast).toFixed(0);
    })

    this.afterEach(async function() {
      await provider.send("evm_revert", [snapshotId]);
    })

    describe("and transferring an exact amount to the exchange", async function(){
      let localSnapshotId, initialWethWalletBalance

      this.beforeEach(async function(){
        localSnapshotId = await provider.send("evm_snapshot", []);

        await WETH.deposit({
          value: amountToWei(1000).toFixed(0)
        });    

        initialWethWalletBalance = asBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address));     

        await WETH.approve(exchange.address, amountInWei);   

        await exchange.swapTokenForDai(MAINNET_ADRESSES.ETH, amountInWei, receiveAtLeastInWei, to, data, {
          value: 0,
          gasLimit: 2500000,
        });  
      })

      this.afterEach(async function() {
        await provider.send("evm_revert", [localSnapshotId]);
      })

      it("should exchange all amount", async function() {
        const wethBalance = asBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address));
        const daiBalance = asBigNumber(await balanceOf(MAINNET_ADRESSES.MCD_DAI, address));
    
        expect(wethBalance.toString()).to.equals(initialWethWalletBalance.minus(amountToWei(amount)).toString());
        expect(daiBalance.gte(asBigNumber(receiveAtLeastInWei))).to.be.true;    
      })
  
      it("should not have Asset amount left in the exchange", async function() {
        const exchangeWethBalance = asBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, exchange.address));
        const wethBalance = asBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address));
    
        expect(wethBalance.toString()).to.equals(initialWethWalletBalance.minus(amountToWei(amount)).toString());
        expect(exchangeWethBalance.toString()).to.equals(zero.toString());
      })
  
      it("should not have DAI amount left in the exchange", async function() {
        const exchangeDaiBalance = asBigNumber(await balanceOf(MAINNET_ADRESSES.MCD_DAI, exchange.address));
    
        expect(exchangeDaiBalance.toString()).to.equals(zero.toString());
      })
    })    

    describe("and transferring more amount to the exchange", async function() {
      let initialWethWalletBalance, moreThanTheTransferAmount, localSnapshotId

      this.beforeEach(async function(){
        localSnapshotId = await provider.send("evm_snapshot", []);

        await WETH.deposit({
          value: amountToWei(1000).toFixed(0)
        });

        initialWethWalletBalance = asBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address));
        moreThanTheTransferAmount = asBigNumber(amountInWei).plus(amountToWei(10)).toFixed(0);

        await WETH.approve(exchange.address, moreThanTheTransferAmount);          
        await exchange.swapTokenForDai(MAINNET_ADRESSES.ETH, moreThanTheTransferAmount, receiveAtLeastInWei, to, data, {
          value: 0,
          gasLimit: 2500000,
        });  
      })

      this.afterEach(async function() {
        await provider.send("evm_revert", [localSnapshotId]);
      })

      it("should exchange all amount", async function() {
        const wethBalance = asBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address));
        const daiBalance = asBigNumber(await balanceOf(MAINNET_ADRESSES.MCD_DAI, address));
    
        expect(wethBalance.toString()).to.equals(initialWethWalletBalance.minus(amountInWei).toString());
        expect(daiBalance.gte(asBigNumber(receiveAtLeastInWei))).to.be.true;    
      })
  
      it("should not have Asset amount left in the exchange", async function() {
        const exchangeWethBalance = asBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, exchange.address));
        const wethBalance = asBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address));

        expect(exchangeWethBalance.toString()).to.equals(zero.toString());
        expect(wethBalance.toString()).to.equals(initialWethWalletBalance.minus(amountInWei).toString());
      })
  
      it("should not have DAI amount left in the exchange", async function() {
        const exchangeDaiBalance = asBigNumber(await balanceOf(MAINNET_ADRESSES.MCD_DAI, exchange.address));
    
        expect(exchangeDaiBalance.toString()).to.equals(zero.toString());
      })
    })
  })


  it("should not happen if it is triggered from unauthorized caller", async () => {
      try {
          await exchange
              .connect(provider.getSigner(1))
              .swapTokenForDai(
                  MAINNET_ADRESSES.ETH,
                  amountToWei(1).toFixed(0),
                  amountFromWei(1).toFixed(0),
                  AGGREGATOR_V3_ADDRESS,
                  0
              );
      } catch (err) {
          expect(err.body).to.have.string('Exchange / Unauthorized Caller');
      }
  });

  


  it.skip('happy path integration', async function() {
    const amountToExchange = new BigNumber(10);
    console.log('Slippage:::', slippage.toString());
    console.log('Fee', fee.toString());
    const slippageIncludingFee = slippage.minus(fee);
    const slippageIncludingFeePercent = new BigNumber(slippageIncludingFee).times(100);
    console.log("Slippage is:::", slippageIncludingFee.toString())
    console.log("Slippage Including Fee Percent:::", slippageIncludingFeePercent.toString());
    const txData = await exchangeToDAI(MAINNET_ADRESSES.ETH, amountToExchange, slippageIncludingFeePercent, exchange.address);
    const {toTokenAmount, protocols, tx: {to, data}} = txData;

    console.log("PROTOCOLS:::", protocols[0].map(protocol => protocol[0].name))

    console.log("Amount to receive:::", amountFromWei(toTokenAmount).toString())
    const receiveAtLeast = new BigNumber(amountFromWei(toTokenAmount).toString()).times(ONE.minus(slippageIncludingFee));
    console.log("Receive at least:::", receiveAtLeast.toString())
    const feeToCollect = amountFromWei(toTokenAmount.toString()).times(fee);
    console.log("Fee to Collect:::", feeToCollect.toString())

    await WETH.approve(exchange.address, amountToWei(amountToExchange).toFixed(0));
    
    
    await exchange.swapTokenForDai(MAINNET_ADRESSES.ETH, amountToWei(amountToExchange).toFixed(0), amountToWei(receiveAtLeast).toFixed(0), to, data, {
      value: 0,
      gasLimit: 2500000,
    });
    
    const feeBeneficiaryBalance = await balanceOf(MAINNET_ADRESSES.MCD_DAI, feeBeneficiary);
    const assetBalance = await balanceOf(MAINNET_ADRESSES.ETH, address);
    const daiBalance = await balanceOf(MAINNET_ADRESSES.MCD_DAI, address);

    console.log('WALLET WETH BALANCE:::', amountFromWei(assetBalance.toString()).toString());
    console.log('WALLET DAI BALANCE:::', amountFromWei(daiBalance.toString()).toString());

    const actuallyReceived = new BigNumber(amountFromWei(daiBalance.toString())).div(ONE.minus(fee));
    console.log("Acually Recieved", actuallyReceived.toString());
    const deltaReceived = new BigNumber(amountFromWei(toTokenAmount.toString())).minus(actuallyReceived);
    console.log("Delta Received", deltaReceived.toString())
    const deltaFeeReceived = deltaReceived.times(fee);
    console.log("Delta Fee Collected", deltaFeeReceived.toString())
    const actualFeeCollected = feeToCollect.minus(deltaFeeReceived);
    console.log("Actual Fee Collected", actualFeeCollected.toString())
    expect(amountFromWei(feeBeneficiaryBalance.toString()).toString()).to.equals(actualFeeCollected.toFixed(18))
  })


});
