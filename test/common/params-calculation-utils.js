const { default: BigNumber } = require("bignumber.js");
let MAINNET_ADRESSES = require("../../addresses/mainnet.json");
const { WETH_ADDRESS, one, zero, TEN, balanceOf } = require("../utils");

MAINNET_ADRESSES.WETH_ADDRESS = WETH_ADDRESS;

const addressRegistryFactory = function (
    multiplyProxyActionsInstanceAddress,
    exchangeInstanceAddress
) {
    return {
        jug: "0x19c0976f590D67707E62397C87829d896Dc0f1F1",
        manager: "0x5ef30b9986345249bc32d8928B7ee64DE9435E39",
        multiplyProxyActions: multiplyProxyActionsInstanceAddress,
        aaveLendingPoolProvider: "0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5",
        feeRecepient: "0x79d7176aE8F93A04bC73b9BC710d4b44f9e362Ce",
        exchange: exchangeInstanceAddress,
    };
};

function amountToWei(amount, precision = 18) {
    if (!amount) {
        amount = 0;
    }
    if (BigNumber.isBigNumber(amount) == false) {
        amount = new BigNumber(amount);
    }
    return amount.times(new BigNumber(10).pow(precision));
}

function amountFromWei(amount, precision = 18) {
    if (BigNumber.isBigNumber(amount) == false) {
      amount = new BigNumber(amount);
    }
    return amount.div(new BigNumber(10).pow(precision));
  }

const calculateParamsIncreaseMP = function (
    oraclePrice,
    marketPrice,
    OF,
    FF,
    currentColl,
    currentDebt,
    requiredCollRatio,
    slippage,
    depositDai = new BigNumber(0),
    debug = false
) {
    if (debug) {
        console.log("calculateParamsIncreaseMP.oraclePrice", oraclePrice.toFixed(2));
        console.log("calculateParamsIncreaseMP.marketPrice", marketPrice.toFixed(2));
        console.log("calculateParamsIncreaseMP.OF", OF.toFixed(5));
        console.log("calculateParamsIncreaseMP.FF", FF.toFixed(5));
        console.log("calculateParamsIncreaseMP.currentColl", currentColl.toFixed(2));
        console.log("calculateParamsIncreaseMP.currentDebt", currentDebt.toFixed(2));
        console.log("calculateParamsIncreaseMP.requiredCollRatio", requiredCollRatio.toFixed(2));
        console.log("calculateParamsIncreaseMP.slippage", slippage.toFixed(2));
    }
    const marketPriceSlippage = marketPrice.times(one.plus(slippage));
    const debt = marketPriceSlippage
        .times(currentColl.times(oraclePrice).minus(requiredCollRatio.times(currentDebt)))
        .plus(oraclePrice.times(depositDai).minus(oraclePrice.times(depositDai).times(OF)))
        .div(
            marketPriceSlippage
                .times(requiredCollRatio)
                .times(one.plus(FF))
                .minus(oraclePrice.times(one.minus(OF)))
        );
    const collateral = debt.times(one.minus(OF)).div(marketPriceSlippage);
    if (debug) {
        console.log("Computed: calculateParamsIncreaseMP.debt", debt.toFixed(2));
        console.log("Computed: calculateParamsIncreaseMP.collateral", collateral.toFixed(2));
    }
    return [debt, collateral];
};

const calculateParamsDecreaseMP = function (
    oraclePrice,
    marketPrice,
    OF,
    FF,
    currentColl,
    currentDebt,
    requiredCollRatio,
    slippage,
    depositDai = new BigNumber(0),
    debug = false
) {
    if (debug) {
        console.log("calculateParamsDecreaseMP.oraclePrice", oraclePrice.toFixed(2));
        console.log("calculateParamsDecreaseMP.marketPrice", marketPrice.toFixed(2));
        console.log("calculateParamsDecreaseMP.OF", OF.toFixed(5));
        console.log("calculateParamsDecreaseMP.FF", FF.toFixed(5));
        console.log("calculateParamsDecreaseMP.currentColl", currentColl.toFixed(2));
        console.log("calculateParamsDecreaseMP.currentDebt", currentDebt.toFixed(2));
        console.log("calculateParamsDecreaseMP.requiredCollRatio", requiredCollRatio.toFixed(2));
        console.log("calculateParamsDecreaseMP.slippage", slippage.toFixed(2));
    }
    const marketPriceSlippage = marketPrice.times(one.minus(slippage));
    const debt = currentColl
        .times(oraclePrice)
        .times(marketPriceSlippage)
        .minus(requiredCollRatio.times(currentDebt).times(marketPriceSlippage))
        .div(
            oraclePrice
                .times(one.plus(FF).plus(OF).plus(OF.times(FF)))
                .minus(marketPriceSlippage.times(requiredCollRatio))
        );
    const collateral = debt.times(one.plus(OF).plus(FF)).div(marketPriceSlippage);
    if (debug) {
        console.log("Computed: calculateParamsDecreaseMP.debt", debt.toFixed(2));
        console.log("Computed: calculateParamsDecreaseMP.collateral", collateral.toFixed(2));
    }
    return [debt, collateral];
};

const packMPAParams = function (cdpData, exchangeData, registry) {
    let params = [exchangeData, cdpData, registry];
    return params;
};

const convertToBigNumber = function (a) {
    try {
        if (typeof a == "number" || typeof a == "string") {
            a = new BigNumber(a);
        } else {
            if (BigNumber.isBigNumber(a) == false || a.toFixed == undefined) {
                a = new BigNumber(a.toString());
            }
        }
    } catch (ex) {
        console.log(a);
        console.log(ex);
        throw `Conversion for BigNumber failed`;
    }
    return a;
};

const ensureWeiFormat = function (input, interpretBigNum = true) {
    let formated;
    input = convertToBigNumber(input);
    try {
        if (interpretBigNum) {
            if (input.isLessThan(TEN.pow(9))) {
                input = input.multipliedBy(TEN.pow(18));
                input = input.decimalPlaces(0);
                formated = input.toFixed(0);
            } else {
                input = input.decimalPlaces(0);
                formated = input.toFixed(0);
            }
        } else {
            formated = input.decimalPlaces(0);
            formated = formated.toFixed(0);
        }
    } catch (ex) {
        console.log(input);
        console.log(ex);
        throw `ensureWeiFormat, implementation bug`;
    }
    return formated;
};

const mul = function (a, b) {
    a = convertToBigNumber(a);
    b = convertToBigNumber(b);
    return a.multipliedBy(b);
};

const div = function (a, b) {
    a = convertToBigNumber(a);
    b = convertToBigNumber(b);
    return a.dividedBy(b);
};

const add = function (a, b) {
    a = convertToBigNumber(a);
    b = convertToBigNumber(b);
    return a.plus(b);
};

const sub = function (a, b) {
    a = convertToBigNumber(a);
    b = convertToBigNumber(b);
    return new BigNumber(a).minus(b);
};

const prepareBasicParams = function (
    gemAddress,
    debtDelta,
    collateralDelta,
    providedCollateral,
    oneInchPayload,
    existingCDP,
    fundsReciver,
    toDAI = false
) {
    debtDelta = ensureWeiFormat(debtDelta);
    collateralDelta = ensureWeiFormat(collateralDelta);
    providedCollateral = ensureWeiFormat(providedCollateral);

    let exchangeData = {
        fromTokenAddress: toDAI ? gemAddress : MAINNET_ADRESSES.MCD_DAI,
        toTokenAddress: toDAI ? MAINNET_ADRESSES.MCD_DAI : gemAddress,
        fromTokenAmount: toDAI ? collateralDelta : debtDelta,
        toTokenAmount: toDAI ? debtDelta : collateralDelta,
        minToTokenAmount: toDAI ? debtDelta : collateralDelta,
        exchangeAddress: oneInchPayload.to,
        _exchangeCalldata: oneInchPayload.data,
    };

    let cdpData = {
        gemJoin: MAINNET_ADRESSES.MCD_JOIN_ETH_A,
        cdpId: existingCDP ? existingCDP.id : 0,
        ilk: existingCDP
            ? existingCDP.ilk
            : "0x0000000000000000000000000000000000000000000000000000000000000000",
        borrowCollateral: collateralDelta,
        requiredDebt: debtDelta,
        depositDai: 0,
        depositCollateral: providedCollateral,
        withdrawDai: 0,
        withdrawCollateral: 0,
        fundsReceiver: fundsReciver,
    };

    return {
        exchangeData,
        cdpData,
    };
};

const prepareMultiplyParameters = function (
    oneInchPayload,
    desiredCdpState,
    multiplyProxyActionsInstanceAddress,
    exchangeInstanceAddress,
    fundsReceiver,
    toDAI = false,
    cdpId = 0
) {
    let exchangeData = {
        fromTokenAddress: toDAI ? MAINNET_ADRESSES.WETH_ADDRESS : MAINNET_ADRESSES.MCD_DAI,
        toTokenAddress: toDAI ? MAINNET_ADRESSES.MCD_DAI : MAINNET_ADRESSES.WETH_ADDRESS,
        fromTokenAmount: toDAI
            ? amountToWei(desiredCdpState.toBorrowCollateralAmount).toFixed(0)
            : amountToWei(desiredCdpState.requiredDebt).toFixed(0),
        toTokenAmount: toDAI
            ? amountToWei(desiredCdpState.requiredDebt).toFixed(0)
            : amountToWei(desiredCdpState.toBorrowCollateralAmount).toFixed(0),
        minToTokenAmount: toDAI
            ? amountToWei(desiredCdpState.requiredDebt).toFixed(0)
            : amountToWei(desiredCdpState.toBorrowCollateralAmount).toFixed(0),
        expectedFee: 0,
        exchangeAddress: oneInchPayload.to,
        _exchangeCalldata: oneInchPayload.data,
    };

    let cdpData = {
        gemJoin: MAINNET_ADRESSES.MCD_JOIN_ETH_A,
        cdpId: cdpId,
        ilk: "0x0000000000000000000000000000000000000000000000000000000000000000",
        fundsReceiver: fundsReceiver,
        borrowCollateral: amountToWei(desiredCdpState.toBorrowCollateralAmount).toFixed(0),
        requiredDebt: amountToWei(desiredCdpState.requiredDebt).toFixed(0),
        depositDai: amountToWei(desiredCdpState.providedDai).toFixed(0),
        depositCollateral: amountToWei(desiredCdpState.providedCollateral).toFixed(0),
        withdrawDai: amountToWei(desiredCdpState.withdrawDai).toFixed(0),
        withdrawCollateral: amountToWei(desiredCdpState.withdrawCollateral).toFixed(0),
    };

    let params = packMPAParams(
        cdpData,
        exchangeData,
        addressRegistryFactory(multiplyProxyActionsInstanceAddress, exchangeInstanceAddress)
    );

    return { params, exchangeData, cdpData };
};


const prepareMultiplyParameters2 = function(fromTokenAddress, toTokenAddress, oneInchPayload, cdpId, desiredCdpState, multiplyProxyActionsInstanceAddress, exchangeInstanceAddress, userAddress, join = MAINNET_ADRESSES.MCD_JOIN_ETH_A, precision = 18, reversedSwap = false){
        
    let exchangeData = {
      fromTokenAddress,
      toTokenAddress,
      fromTokenAmount: amountToWei(desiredCdpState.fromTokenAmount,reversedSwap ? precision : 18).toFixed(0),
      toTokenAmount: amountToWei(desiredCdpState.toTokenAmount, !reversedSwap ? precision : 18).toFixed(0),
      minToTokenAmount: amountToWei(desiredCdpState.toTokenAmount, !reversedSwap ? precision : 18).toFixed(0),
      expectedFee: 0,
      exchangeAddress: oneInchPayload.to,
      _exchangeCalldata: oneInchPayload.data
    };
    
    let cdpData =  {
      gemJoin: join,
      cdpId: cdpId,
      ilk: "0x0000000000000000000000000000000000000000000000000000000000000000",
      fundsReceiver: userAddress,
      borrowCollateral: amountToWei(desiredCdpState.toBorrowCollateralAmount, precision).toFixed(0),
      requiredDebt: amountToWei(desiredCdpState.requiredDebt).toFixed(0),
      depositDai: amountToWei(desiredCdpState.providedDai || zero).toFixed(0),
      depositCollateral: amountToWei(desiredCdpState.providedCollateral || zero, precision).toFixed(0),
      withdrawDai: amountToWei(desiredCdpState.withdrawDai || zero).toFixed(0),
      withdrawCollateral: amountToWei(desiredCdpState.withdrawCollateral || zero, precision).toFixed(0),
    }
  
  
    let params = [
      exchangeData,
      cdpData,
      addressRegistryFactory(multiplyProxyActionsInstanceAddress,exchangeInstanceAddress)
    ]
  
    return params;
  }

module.exports = {
    add,
    mul,
    sub,
    div,
    calculateParamsIncreaseMP,
    calculateParamsDecreaseMP,
    amountToWei,
    prepareMultiplyParameters,
    prepareMultiplyParameters2,
    addressRegistryFactory,
    prepareBasicParams,
    packMPAParams,
    ensureWeiFormat,
    convertToBigNumber,
    amountFromWei,
    MAINNET_ADRESSES,
};
