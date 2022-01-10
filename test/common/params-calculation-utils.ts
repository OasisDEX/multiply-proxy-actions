import BigNumber from 'bignumber.js'
import { BigNumber as EthersBN } from 'ethers'
import MAINNET_ADRESSES from '../../addresses/mainnet.json'
import { one, zero, TEN, WETH_ADDRESS } from '../utils'

// MAINNET_ADRESSES.WETH_ADDRESS = WETH_ADDRESS // TODO:

export function addressRegistryFactory(
  multiplyProxyActionsInstanceAddress: string,
  exchangeInstanceAddress: string,
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

export function amountToWei(amount: BigNumber.Value, precision = 18) {
  return new BigNumber(amount || 0).times(new BigNumber(10).pow(precision))
}

// TODO: change
export function amountFromWei(amount: BigNumber.Value, precision = 18) {
  return new BigNumber(amount || 0).div(new BigNumber(10).pow(precision))
}

export function calculateParamsIncreaseMP(
  oraclePrice: BigNumber,
  marketPrice: BigNumber,
  OF: BigNumber,
  FF: BigNumber,
  currentColl: BigNumber,
  currentDebt: BigNumber,
  requiredCollRatio: BigNumber,
  slippage: BigNumber,
  depositDai = new BigNumber(0),
  debug = false,
) {
  if (debug) {
    console.log('calculateParamsIncreaseMP.oraclePrice', oraclePrice.toFixed(2))
    console.log('calculateParamsIncreaseMP.marketPrice', marketPrice.toFixed(2))
    console.log('calculateParamsIncreaseMP.OF', OF.toFixed(5))
    console.log('calculateParamsIncreaseMP.FF', FF.toFixed(5))
    console.log('calculateParamsIncreaseMP.currentColl', currentColl.toFixed(2))
    console.log('calculateParamsIncreaseMP.currentDebt', currentDebt.toFixed(2))
    console.log('calculateParamsIncreaseMP.requiredCollRatio', requiredCollRatio.toFixed(2))
    console.log('calculateParamsIncreaseMP.slippage', slippage.toFixed(2))
  }
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
  if (debug) {
    console.log('Computed: calculateParamsIncreaseMP.debt', debt.toFixed(2))
    console.log('Computed: calculateParamsIncreaseMP.collateral', collateral.toFixed(2))
  }
  return [debt, collateral]
}

export function calculateParamsDecreaseMP(
  oraclePrice: BigNumber,
  marketPrice: BigNumber,
  OF: BigNumber,
  FF: BigNumber,
  currentColl: BigNumber,
  currentDebt: BigNumber,
  requiredCollRatio: BigNumber,
  slippage: BigNumber,
  depositDai = new BigNumber(0),
  debug = false,
) {
  if (debug) {
    console.log('calculateParamsDecreaseMP.oraclePrice', oraclePrice.toFixed(2))
    console.log('calculateParamsDecreaseMP.marketPrice', marketPrice.toFixed(2))
    console.log('calculateParamsDecreaseMP.OF', OF.toFixed(5))
    console.log('calculateParamsDecreaseMP.FF', FF.toFixed(5))
    console.log('calculateParamsDecreaseMP.currentColl', currentColl.toFixed(2))
    console.log('calculateParamsDecreaseMP.currentDebt', currentDebt.toFixed(2))
    console.log('calculateParamsDecreaseMP.requiredCollRatio', requiredCollRatio.toFixed(2))
    console.log('calculateParamsDecreaseMP.slippage', slippage.toFixed(2))
  }
  const marketPriceSlippage = marketPrice.times(one.minus(slippage))
  const debt = currentColl
    .times(oraclePrice)
    .times(marketPriceSlippage)
    .minus(requiredCollRatio.times(currentDebt).times(marketPriceSlippage))
    .div(
      oraclePrice
        .times(one.plus(FF).plus(OF).plus(OF.times(FF)))
        .minus(marketPriceSlippage.times(requiredCollRatio)),
    )
  const collateral = debt.times(one.plus(OF).plus(FF)).div(marketPriceSlippage)
  if (debug) {
    console.log('Computed: calculateParamsDecreaseMP.debt', debt.toFixed(2))
    console.log('Computed: calculateParamsDecreaseMP.collateral', collateral.toFixed(2))
  }
  return [debt, collateral]
}

// TODO:
export function packMPAParams(cdpData: any, exchangeData: any, registry: any) {
  let registryClone = { ...registry }
  delete registryClone.feeRecepient

  let params = [exchangeData, cdpData, registryClone]
  return params
}

// TODO: remove
export function convertToBigNumber(a: any) {
  try {
    if (typeof a == 'number' || typeof a == 'string') {
      a = new BigNumber(a)
    } else {
      if (BigNumber.isBigNumber(a) == false || a.toFixed == undefined) {
        a = new BigNumber(a.toString())
      }
    }
  } catch (ex) {
    console.log(a)
    console.log(ex)
    throw `Conversion for BigNumber failed`
  }
  return a
}

export function ensureWeiFormat(
  input: any, // TODO:
  interpretBigNum = true,
) {
  let formated
  input = convertToBigNumber(input)
  try {
    if (interpretBigNum) {
      if (input.isLessThan(TEN.pow(9))) {
        input = input.multipliedBy(TEN.pow(18))
        input = input.decimalPlaces(0)
        formated = input.toFixed(0)
      } else {
        input = input.decimalPlaces(0)
        formated = input.toFixed(0)
      }
    } else {
      formated = input.decimalPlaces(0)
      formated = formated.toFixed(0)
    }
  } catch (ex) {
    console.log(input)
    console.log(ex)
    throw `ensureWeiFormat, implementation bug`
  }
  return formated
}

// TODO: wtf
// export function mul(a, b) {
//   a = convertToBigNumber(a)
//   b = convertToBigNumber(b)
//   return a.multipliedBy(b)
// }

// export function div(a, b) {
//   a = convertToBigNumber(a)
//   b = convertToBigNumber(b)
//   return a.dividedBy(b)
// }

// export function add(a, b) {
//   a = convertToBigNumber(a)
//   b = convertToBigNumber(b)
//   return a.plus(b)
// }

// export function sub(a, b) {
//   a = convertToBigNumber(a)
//   b = convertToBigNumber(b)
//   return new BigNumber(a).minus(b)
// }

export function prepareBasicParams(
  gemAddress: string,
  debtDelta: any, // TODO:
  collateralDelta: any, // TODO:
  providedCollateral: any, // TODO:
  oneInchPayload: any, // TODO:
  existingCDP: any, // TODO:
  fundsReciver: string,
  toDAI = false,
  skipFL = false,
) {
  debtDelta = ensureWeiFormat(debtDelta)
  collateralDelta = ensureWeiFormat(collateralDelta)
  providedCollateral = ensureWeiFormat(providedCollateral)

  let exchangeData = {
    fromTokenAddress: toDAI ? gemAddress : MAINNET_ADRESSES.MCD_DAI,
    toTokenAddress: toDAI ? MAINNET_ADRESSES.MCD_DAI : gemAddress,
    fromTokenAmount: toDAI ? collateralDelta : debtDelta,
    toTokenAmount: toDAI ? debtDelta : collateralDelta,
    minToTokenAmount: toDAI ? debtDelta : collateralDelta,
    exchangeAddress: oneInchPayload.to,
    _exchangeCalldata: oneInchPayload.data,
  }

  let cdpData = {
    skipFL: skipFL,
    gemJoin: MAINNET_ADRESSES.MCD_JOIN_ETH_A,
    cdpId: existingCDP ? existingCDP.id : 0,
    ilk: existingCDP
      ? existingCDP.ilk
      : '0x0000000000000000000000000000000000000000000000000000000000000000',
    borrowCollateral: collateralDelta,
    requiredDebt: debtDelta,
    depositDai: 0,
    depositCollateral: providedCollateral,
    withdrawDai: 0,
    withdrawCollateral: 0,
    fundsReceiver: fundsReciver,
    methodName: '0x0000000000000000000000000000000000000000000000000000000000000000',
  }

  return {
    exchangeData,
    cdpData,
  }
}

export function prepareMultiplyParameters(
  oneInchPayload: any, // TODO:
  desiredCdpState: any, // TODO:
  multiplyProxyActionsInstanceAddress: string,
  exchangeInstanceAddress: string,
  fundsReceiver: string,
  toDAI = false,
  cdpId = 0,
  skipFL = false,
) {
  let exchangeData = {
    fromTokenAddress: toDAI ? WETH_ADDRESS : MAINNET_ADRESSES.MCD_DAI,
    toTokenAddress: toDAI ? MAINNET_ADRESSES.MCD_DAI : WETH_ADDRESS,
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
  }

  let cdpData = {
    skipFL: skipFL,
    gemJoin: MAINNET_ADRESSES.MCD_JOIN_ETH_A,
    cdpId: cdpId,
    ilk: '0x0000000000000000000000000000000000000000000000000000000000000000',
    fundsReceiver: fundsReceiver,
    borrowCollateral: amountToWei(desiredCdpState.toBorrowCollateralAmount).toFixed(0),
    requiredDebt: amountToWei(desiredCdpState.requiredDebt).toFixed(0),
    depositDai: amountToWei(desiredCdpState.providedDai).toFixed(0),
    depositCollateral: amountToWei(desiredCdpState.providedCollateral).toFixed(0),
    withdrawDai: amountToWei(desiredCdpState.withdrawDai).toFixed(0),
    withdrawCollateral: amountToWei(desiredCdpState.withdrawCollateral).toFixed(0),
    methodName: '',
  }

  let params = packMPAParams(
    cdpData,
    exchangeData,
    addressRegistryFactory(multiplyProxyActionsInstanceAddress, exchangeInstanceAddress),
  )

  return { params, exchangeData, cdpData }
}

export function prepareMultiplyParameters2(
  fromTokenAddress: string,
  toTokenAddress: string,
  oneInchPayload: any, // TODO:
  cdpId: string, // TODO:
  desiredCdpState: any, // TODO:
  multiplyProxyActionsInstanceAddress: string,
  exchangeInstanceAddress: string,
  userAddress: string,
  skipFL = false,
  join = MAINNET_ADRESSES.MCD_JOIN_ETH_A,
  precision = 18,
  reversedSwap = false,
) {
  let exchangeData = {
    fromTokenAddress,
    toTokenAddress,
    fromTokenAmount: amountToWei(
      desiredCdpState.fromTokenAmount,
      reversedSwap ? precision : 18,
    ).toFixed(0),
    toTokenAmount: amountToWei(
      desiredCdpState.toTokenAmount,
      !reversedSwap ? precision : 18,
    ).toFixed(0),
    minToTokenAmount: amountToWei(
      desiredCdpState.toTokenAmount,
      !reversedSwap ? precision : 18,
    ).toFixed(0),
    exchangeAddress: oneInchPayload.to,
    _exchangeCalldata: oneInchPayload.data,
  }

  let cdpData = {
    skipFL,
    gemJoin: join,
    cdpId: cdpId,
    ilk: '0x0000000000000000000000000000000000000000000000000000000000000000',
    fundsReceiver: userAddress,
    borrowCollateral: amountToWei(desiredCdpState.toBorrowCollateralAmount, precision).toFixed(0),
    requiredDebt: amountToWei(desiredCdpState.requiredDebt).toFixed(0),
    depositDai: amountToWei(desiredCdpState.providedDai || zero).toFixed(0),
    depositCollateral: amountToWei(desiredCdpState.providedCollateral || zero, precision).toFixed(
      0,
    ),
    withdrawDai: amountToWei(desiredCdpState.withdrawDai || zero).toFixed(0),
    withdrawCollateral: amountToWei(desiredCdpState.withdrawCollateral || zero, precision).toFixed(
      0,
    ),
    methodName: '',
  }

  let params = [
    exchangeData,
    cdpData,
    addressRegistryFactory(multiplyProxyActionsInstanceAddress, exchangeInstanceAddress),
  ]

  return params
}
