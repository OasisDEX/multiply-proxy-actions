import BigNumber from 'bignumber.js'
import { isError, tryF } from 'ts-try'
import MAINNET_ADRESSES from '../../addresses/mainnet.json'
import { one, zero, TEN, WETH_ADDRESS } from '../utils'

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
  oasisFee: BigNumber,
  flashLoanFee: BigNumber,
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
    console.log('calculateParamsIncreaseMP.OF', oasisFee.toFixed(5))
    console.log('calculateParamsIncreaseMP.FF', flashLoanFee.toFixed(5))
    console.log('calculateParamsIncreaseMP.currentColl', currentColl.toFixed(2))
    console.log('calculateParamsIncreaseMP.currentDebt', currentDebt.toFixed(2))
    console.log('calculateParamsIncreaseMP.requiredCollRatio', requiredCollRatio.toFixed(2))
    console.log('calculateParamsIncreaseMP.slippage', slippage.toFixed(2))
  }
  const marketPriceSlippage = marketPrice.times(one.plus(slippage))
  const debt = marketPriceSlippage
    .times(currentColl.times(oraclePrice).minus(requiredCollRatio.times(currentDebt)))
    .plus(oraclePrice.times(depositDai).minus(oraclePrice.times(depositDai).times(oasisFee)))
    .div(
      marketPriceSlippage
        .times(requiredCollRatio)
        .times(one.plus(flashLoanFee))
        .minus(oraclePrice.times(one.minus(oasisFee))),
    )
  const collateral = debt.times(one.minus(oasisFee)).div(marketPriceSlippage)
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
  const registryClone = { ...registry }
  delete registryClone.feeRecepient

  const params = [exchangeData, cdpData, registryClone]
  return params
}

// TODO: remove
export function convertToBigNumber(a: any) {
  try {
    if (typeof a === 'number' || typeof a === 'string') {
      a = new BigNumber(a)
    } else {
      if (!BigNumber.isBigNumber(a) || a.toFixed === undefined) {
        a = new BigNumber(a.toString())
      }
    }
  } catch (ex) {
    console.log(a)
    console.log(ex)
    throw new Error(`Conversion for BigNumber failed`)
  }
  return a
}

export function ensureWeiFormat(
  input: BigNumber.Value, // TODO:
  interpretBigNum = true,
) {
  const bn = new BigNumber(input)

  const result = tryF(() => {
    if (interpretBigNum && bn.lt(TEN.pow(9))) {
      return bn.times(TEN.pow(18))
    }

    return bn
  })

  if (isError(result)) {
    throw Error(`Error running \`ensureWeiFormat\` with input ${input.toString()}: ${result}`)
  }

  return result.decimalPlaces(0).toFixed(0)
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
  const exchangeData = {
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

  const cdpData = {
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

  const params = packMPAParams(
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
  const exchangeData = {
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

  const cdpData = {
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

  const params = [
    exchangeData,
    cdpData,
    addressRegistryFactory(multiplyProxyActionsInstanceAddress, exchangeInstanceAddress),
  ]

  return params
}
