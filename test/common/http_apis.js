const { default: BigNumber } = require('bignumber.js')
const { amountToWei, convertToBigNumber } = require('./params-calculation-utils')
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
//convertToBigNumber(amount).times(one.minus(fee)).toFixed(0)
const exchangeFromDAI = async function (toTokenAddress, amount, slippage, recepient, protocols) {
  protocols = !protocols || !protocols.length ? '' : `&protocols=${protocols.join(',')}`

  var url = `https://api.1inch.exchange/v3.0/1/swap?
    fromTokenAddress=${MAINNET_ADRESSES.MCD_DAI}
    &toTokenAddress=${toTokenAddress}
    &amount=${amount}
    &fromAddress=${recepient}
    ${protocols}
    &slippage=${slippage}
    &disableEstimate=true
    &allowPartialFill=false`.replace(/\n(\s*)/g, '')

  var data = await (await fetch(url)).json()

  if (!data) console.log('incorrect response from 1inch ', data, 'original request', url)

  return data
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
  amount,
  recepient,
  slippage,
  protocols = [],
) {
  protocols = !protocols || !protocols.length ? '' : `&protocols=${protocols.join(',')}`

  var url = `https://api.1inch.exchange/v3.0/1/swap?
    fromTokenAddress=${fromTokenAddress}
    &toTokenAddress=${MAINNET_ADRESSES.MCD_DAI}
    &amount=${amount}
    ${protocols}
    &fromAddress=${recepient}
    &slippage=${slippage}
    &disableEstimate=true
    &allowPartialFill=false`.replace(/\n(\s*)/g, '')

  var data = await (await fetch(url)).json()

  if (!data) {
    console.log('incorrect response from 1inch ', data, 'original request', url)
  }

  return data
}

module.exports = {
  getMarketPrice,
  exchangeFromDAI,
  exchangeToDAI,
  getCurrentBlockNumber,
}
