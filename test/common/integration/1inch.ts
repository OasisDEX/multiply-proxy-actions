import BigNumber from 'bignumber.js'
import MAINNET_ADDRESSES from '../../../addresses/mainnet.json'
import { exchangeFromDAI, exchangeToDAI } from '../http-apis'
import { ONE } from '../mcd-deployment-utils'

export async function getPayload(
  exchangeData, // TODO:
  beneficiary: string,
  slippage: BigNumber.Value,
  fee, // TODO:
  protocols: string[],
) {
  const slippageAdjusted = new BigNumber(slippage).times(100)

  if (exchangeData.fromTokenAddress == MAINNET_ADDRESSES.MCD_DAI) {
    const response = await exchangeFromDAI(
      exchangeData.toTokenAddress,
      new BigNumber(exchangeData.fromTokenAmount).times(ONE.minus(fee)).toFixed(0),
      slippageAdjusted,
      beneficiary,
      protocols,
    )

    return response?.tx
  }

  const response = await exchangeToDAI(
    exchangeData.fromTokenAddress,
    exchangeData.fromTokenAmount,
    beneficiary,
    slippageAdjusted,
    protocols,
  )

  return response?.tx
}
