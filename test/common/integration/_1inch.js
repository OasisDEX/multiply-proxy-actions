const {
    exchangeFromDAI,
    exchangeToDAI,
  } = require('./../http_apis')


  const {
    convertToBigNumber,
    mul,
    div,
  } = require('./../params-calculation-utils')

const getPayload = async function (exchangeData, beneficiary, slippage) {
    let retVal, url
    if (exchangeData.fromTokenAddress == MAINNET_ADRESSES.MCD_DAI) {
      ;[url, retVal] = await exchangeFromDAI(
        exchangeData.toTokenAddress,
        div(convertToBigNumber(exchangeData.fromTokenAmount), TEN.pow(18)),
        mul(slippage, 100),
        beneficiary,
        OUR_FEE,
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