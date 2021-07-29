const { default: BigNumber } = require('bignumber.js')
const { amountToWei } = require('./params-calculation-utils')
let MAINNET_ADRESSES = require('../../addresses/mainnet.json')
const { one } = require('../utils')

const fetch = require('node-fetch')

const getMarketPrice = async function (from, to, fromPrecision = 18, toPrecision = 18) {
  const endpoint = `https://api.1inch.exchange/v3.0/1/quote?fromTokenAddress=${from}&toTokenAddress=${to}&amount=${ethers.utils.parseUnits(
    '0.1',
    fromPrecision,
  )}`
  const response = await fetch(endpoint)
  const result = await response.json()

  const fromTokenAmount = new BigNumber(
    ethers.utils.formatUnits(result.fromTokenAmount, fromPrecision),
  )
  const toTokenAmount = new BigNumber(ethers.utils.formatUnits(result.toTokenAmount, toPrecision))

  const marketPrice = toTokenAmount.div(fromTokenAmount)
  return marketPrice
}

const exchangeFromDAI = async function (
  toTokenAddress,
  sourceAmount,
  slippagePercentage,
  beneficiary,
  fee,
  precision = 18,
  protocols,
) {
  var url =
    `https://api.1inch.exchange/v3.0/1/swap?fromTokenAddress=${
      MAINNET_ADRESSES.MCD_DAI
    }&toTokenAddress=${toTokenAddress}&amount=${amountToWei(
      sourceAmount.times(one.minus(fee)),
      precision,
    ).toFixed(
      0,
    )}&fromAddress=${beneficiary}&slippage=${slippagePercentage.toNumber()}&disableEstimate=true&allowPartial=false` +
    (protocols ? `&protocols=${protocols}` : '')
  var _1inchResponse = await (await fetch(url)).json()
  var txData = _1inchResponse.tx

  if (txData == undefined)
    console.log('incorrect response from 1inch ', _1inchResponse, 'original request', url)

  return [url, txData]
}

const getCurrentBlockNumber = async function () {
  const result = await fetch(
    `https://api.etherscan.io/api?module=block&action=getblocknobytime&timestamp=${Math.floor(
      new Date().getTime() / 1000,
    )}&closest=before&apikey=YAJI4NVD8QTQ9JVWG2NKN3FFUK6IZTMV5S`,
  )

  const json = await result.json()

  return parseInt(json.result)
}

const exchangeToDAI = async function (
  fromTokenAddress,
  sourceAmount,
  slippagePercentage,
  beneficiary,
  precision = 18,
  protocols,
) {
  var url =
    `https://api.1inch.exchange/v3.0/1/swap?fromTokenAddress=${fromTokenAddress}&toTokenAddress=${
      MAINNET_ADRESSES.MCD_DAI
    }&amount=${amountToWei(sourceAmount, precision).toFixed(0)}&fromAddress=${beneficiary}` +
    `&slippage=${slippagePercentage.toNumber()}&disableEstimate=true&allowPartial=false` +
    (protocols ? `&protocols=${protocols}` : '')
  var _1inchResponse = await (await fetch(url)).json()
  var txData = _1inchResponse.tx
  if (txData == undefined) {
    console.log('incorrect response from 1inch ', _1inchResponse, 'original request', url)
  }
  return [url, txData]
}

module.exports = {
  getMarketPrice,
  exchangeFromDAI,
  exchangeToDAI,
  getCurrentBlockNumber,
}
