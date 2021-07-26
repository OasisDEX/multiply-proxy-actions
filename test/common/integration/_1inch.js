const { default: BigNumber } = require('bignumber.js')
const {
    exchangeFromDAI,
    exchangeToDAI,
  } = require('./../http_apis')


  const {
    convertToBigNumber,
    mul,
    div,
    MAINNET_ADRESSES,
  } = require('./../params-calculation-utils')

  const TEN = new BigNumber(10);

const getPayload = async function (exchangeData, beneficiary, slippage,fee) {
    let retVal, url;
    if (exchangeData.fromTokenAddress == MAINNET_ADRESSES.MCD_DAI) {
      ;[url, retVal] = await exchangeFromDAI(
        exchangeData.toTokenAddress,
        div(convertToBigNumber(exchangeData.fromTokenAmount), TEN.pow(18)),
        mul(slippage, 100),
        beneficiary,
        fee,
      )
    } else {
      ;[url, retVal] = await exchangeToDAI(
        exchangeData.fromTokenAddress,
        div(convertToBigNumber(exchangeData.fromTokenAmount), TEN.pow(18)),
        mul(slippage, 100),
        beneficiary,
      )
    }
    var tmp = JSON.parse(JSON.stringify(retVal))
    tmp.data = undefined
    return retVal
  }

  module.exports = {
      getPayload
  }