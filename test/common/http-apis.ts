import { ethers } from 'hardhat'
import fetch from 'node-fetch'
import BigNumber from 'bignumber.js'
import MAINNET_ADDRESSES from '../../addresses/mainnet.json'

export interface OneInchResponse {
  toTokenAmount: string
  fromTokenAmount: string
  tx: {
    from: string
    to: string
    data: string
    value: string
    gasPrice: string
  }
}

export async function getMarketPrice(
  from: string,
  to: string,
  fromPrecision = 18,
  toPrecision = 18,
) {
  const endpoint = `https://api.1inch.exchange/v4.0/1/quote?fromTokenAddress=${from}&toTokenAddress=${to}&amount=${ethers.utils.parseUnits(
    '0.1',
    fromPrecision,
  )}&protocols=UNISWAP_V3`

  const response = await fetch(endpoint)
  const result = await response.json()

  const fromTokenAmount = new BigNumber(
    ethers.utils.formatUnits(result.fromTokenAmount, fromPrecision),
  )
  const toTokenAmount = new BigNumber(ethers.utils.formatUnits(result.toTokenAmount, toPrecision))

  return toTokenAmount.div(fromTokenAmount)
}

export async function exchangeFromDAI(
  toTokenAddress: string,
  amount: string,
  slippage: string,
  recepient: string,
  protocols: string[] = [],
): Promise<OneInchResponse> {
  const url = `https://oasis.api.enterprise.1inch.exchange/v4.0/1/swap?
    fromTokenAddress=${MAINNET_ADDRESSES.MCD_DAI}
    &toTokenAddress=${toTokenAddress}
    &amount=${amount}
    &fromAddress=${recepient}
    ${!protocols?.length ? '' : `&protocols=${protocols.join(',')}`}
    &slippage=${slippage}
    &disableEstimate=true
    &allowPartialFill=false`.replace(/\n(\s*)/g, '')

  const response = await fetch(url)
  const data = await response.json()

  if (!data) {
    console.log('incorrect response from 1inch ', data, 'original request', url)
  }

  return data
}

// TODO:
export async function getCurrentBlockNumber() {
  const url = `https://api.etherscan.io/api?module=block&action=getblocknobytime&timestamp=${Math.floor(
    new Date().getTime() / 1000,
  )}&closest=before&apikey=YAJI4NVD8QTQ9JVWG2NKN3FFUK6IZTMV5S`
  try {
    const result = await fetch(url)

    const json = await result.json()
    return parseInt(json.result)
  } catch (err) {
    console.log('getCurrentBlockNumber Url', url)
    throw err
  }
}

export async function exchangeToDAI(
  fromTokenAddress: string,
  amount: string,
  recepient: string,
  slippage: string,
  protocols: string[] = [],
): Promise<OneInchResponse> {
  const url = `https://oasis.api.enterprise.1inch.exchange/v4.0/1/swap?
    fromTokenAddress=${fromTokenAddress}
    &toTokenAddress=${MAINNET_ADDRESSES.MCD_DAI}
    &amount=${amount}
    ${!protocols?.length ? '' : `&protocols=${protocols.join(',')}`}
    &fromAddress=${recepient}
    &slippage=${slippage}
    &disableEstimate=true
    &allowPartialFill=false`.replace(/\n(\s*)/g, '')

  const response = await fetch(url)
  const data = await response.json()

  if (!data) {
    console.log('incorrect response from 1inch ', data, 'original request', url)
  }

  return data
}
