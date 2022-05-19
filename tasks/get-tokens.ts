import { task } from 'hardhat/config'
import { BigNumber, ethers, Signer } from 'ethers'

import mainnet from '../addresses/mainnet.json'
// import { swapTokens } from '../test/common/utils/mcd-deployment.utils'
import { impersonate } from './utils/impersonate'
import { JsonRpcProvider } from '@ethersproject/providers'
import UniswapRouterV3ABI from '../abi/external/IUniswapRouter.json'

export async function swapTokens(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  amountOutMinimum: string,
  recipient: string,
  provider: JsonRpcProvider,
  signer: Signer,
) {
  const value = tokenIn === mainnet.ETH ? amountIn : 0

  const UNISWAP_ROUTER_V3 = '0xe592427a0aece92de3edee1f18e0157c05861564'
  const uniswapV3 = new ethers.Contract(UNISWAP_ROUTER_V3, UniswapRouterV3ABI, provider).connect(
    signer,
  )

  const swapParams = {
    tokenIn,
    tokenOut,
    fee: 3000,
    recipient,
    deadline: 1751366148,
    amountIn,
    amountOutMinimum,
    sqrtPriceLimitX96: 0,
  }

  await uniswapV3.exactInputSingle(swapParams, { value })
}

const tokens = {
    DAI: mainnet.MCD_DAI,
    USDC: mainnet.USDC,
    MANA: mainnet.MANA,
    WBTC: mainnet.WBTC,
    YFI: mainnet.YFI,
    UNI: mainnet.UNI,
    WSTETH: mainnet.WSTETH,
    RENBTC: mainnet.RENBTC,
    LINK: mainnet.LINK,
    MATIC: mainnet.MATIC,
    GUSD: mainnet.GUSD,
}

task('get-tokens', 'Gets you all tokens you need')
  .addOptionalParam('to', '[Optional] address to transfer tokens to, default address 0')
  .addOptionalParam('token', '[Optional] get just one token, default all tokens')
  .setAction(async (taskArgs, hre) => {
      const signer = hre.ethers.provider.getSigner(0)
      const recipient = taskArgs.to || (await signer.getAddress())
      const tokensToGet = taskArgs.token ? Object.entries(tokens).filter(([token]) => token === taskArgs.token.toUpperCase()) : Object.entries(tokens)

      for (const [token, tokenAddress] of tokensToGet) {
        await hre.network.provider.send("hardhat_setBalance", [
          await signer.getAddress(),
          '0x3BA1910BF341B00000',
        ]);
        console.log(`Swapping ETH for ${token}`);
        try {
          await swapTokens(
            mainnet.ETH,
            tokenAddress,
            '0x3635C9ADC5DEA00000',
            '0x0',
            recipient,
            signer.provider,
            signer,
          )
        } catch  {
          console.log(`Could not swap ETH for ${token}`);
        }
        
      }
  })

export {}

