const { addressRegistryFactory, MAINNET_ADRESSES } = require('./mcd-deployment-utils')
const { default: BigNumber } = require('bignumber.js')
const { one } = require('../utils')

const zero = new BigNumber(0)

function amountToWei(amount) {
  const precision = 18
  if (BigNumber.isBigNumber(amount) == false) {
    amount = new BigNumber(amount)
  }
  return amount.times(new BigNumber(10).pow(precision))
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
) {
  const marketPriceSlippage = marketPrice.times(one.plus(slippage))
  const debt = marketPriceSlippage
    .times(currentColl.times(oraclePrice).minus(requiredCollRatio.times(currentDebt)))
    .plus(oraclePrice.times(depositDai).minus(oraclePrice.times(depositDai).times(OF)))
    .div(
      marketPriceSlippage
        .times(requiredCollRatio)
        .times(one.plus(FF))
        .minus(oraclePrice.times(one.minus(OF))),
    )
  const collateral = debt.times(one.minus(OF)).div(marketPriceSlippage)
  return [debt, collateral]
}

const calculateParamsDecreaseMP = function (
  oraclePrice,
  marketPrice,
  OF,
  FF,
  currentColl,
  currentDebt,
  requiredCollRatio,
  slippage,
) {
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
    return [debt, collateral];

const prepareMultiplyParameters = function (
  fromTokenAddress,
  toTokenAddress,
  oneInchPayload,
  cdpId,
  desiredCdpState,
  multiplyProxyActionsInstanceAddress,
  exchangeInstanceAddress,
  userAddress,
) {
  let exchangeData = {
    fromTokenAddress,
    fromTokenAmount: amountToWei(desiredCdpState.fromTokenAmount).toFixed(0),
    toTokenAmount: amountToWei(desiredCdpState.toTokenAmount).toFixed(0),
    minToTokenAmount: amountToWei(desiredCdpState.toTokenAmount).toFixed(0),
    expectedFee: 0,
    exchangeAddress: oneInchPayload.to,
    _exchangeCalldata: oneInchPayload.data,
  }

  let cdpData = {
    gemJoin: MAINNET_ADRESSES.MCD_JOIN_ETH_A,
    cdpId: cdpId,
    ilk: '0x0000000000000000000000000000000000000000000000000000000000000000',
    fundsReceiver: userAddress,
    borrowCollateral: amountToWei(desiredCdpState.toBorrowCollateralAmount, 'ETH').toFixed(0),
    requiredDebt: amountToWei(desiredCdpState.requiredDebt, 'ETH').toFixed(0),
    depositDai: amountToWei(desiredCdpState.providedDai || zero, 'ETH').toFixed(0),
    depositCollateral: amountToWei(desiredCdpState.providedCollateral || zero, 'ETH').toFixed(0),
    withdrawDai: amountToWei(desiredCdpState.withdrawDai || zero, 'ETH').toFixed(0),
    withdrawCollateral: amountToWei(desiredCdpState.withdrawCollateral || zero, 'ETH').toFixed(0),
  }

  let params = [
    exchangeData,
    cdpData,
    addressRegistryFactory(multiplyProxyActionsInstanceAddress, exchangeInstanceAddress),
  ]

  return params
}

module.exports = {
  calculateParamsIncreaseMP,
  calculateParamsDecreaseMP,
  amountToWei,
  prepareMultiplyParameters,
  addressRegistryFactory,
}
