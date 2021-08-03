const { default: BigNumber } = require('bignumber.js')
const { exchangeFromDAI, exchangeToDAI } = require('./../http_apis')
const { ONE } = require('../mcd-deployment-utils')
const {
  convertToBigNumber,
  mul,
  MAINNET_ADRESSES,
} = require('./../params-calculation-utils')

const getPayload = async function (exchangeData, beneficiary, slippage, fee, protocols) {
  let retVal

  if (exchangeData.fromTokenAddress == MAINNET_ADRESSES.MCD_DAI) {
    let response = await exchangeFromDAI(
      exchangeData.toTokenAddress,
      convertToBigNumber(exchangeData.fromTokenAmount).times(ONE.minus(fee)).toFixed(0),
      mul(slippage, 100),
      beneficiary,
      protocols,
    )

    retVal = response && response.tx
  } else {
    let response = await exchangeToDAI(
      exchangeData.fromTokenAddress,
      exchangeData.fromTokenAmount,
      beneficiary,
      mul(slippage, 100),
      protocols,
    )

    retVal = response && response.tx
  }

  return retVal
}

module.exports = {
  getPayload,
}
