import { task } from 'hardhat/config'
import { ethers } from 'ethers'

import mainnet from '../addresses/mainnet.json'
import { swapTokens } from '../test/common/utils/mcd-deployment.utils'
import { impersonate } from './utils/impersonate'

const tokens = {
    DAI: mainnet.MCD_DAI,
    // USDC: mainnet.USDC,
    // PAX: mainnet.PAX,
    // MANA: mainnet.MANA,
    // WBTC: mainnet.WBTC,
    // YFI: mainnet.YFI,
    // UNI: mainnet.UNI,
    // WSTETH: mainnet.WSTETH,
    // RENBTC: mainnet.RENBTC,
    // LINK: mainnet.LINK,
    // MATIC: mainnet.MATIC,
    // GUSD: mainnet.GUSD,
}

task('get-money', 'Gets you all tokens you need')
  .addOptionalParam('to', '[Optional] address to transfer tokens to, default address 0')
  .addOptionalParam('token', '[Optional] get just one token, default all tokens')
  .setAction(async (taskArgs, hre) => {
      const signer = hre.ethers.provider.getSigner(0)
      const recipient = taskArgs.to || (await signer.getAddress())

    Object.entries(tokens).forEach(async ([_, tokenAddress]) => {
        await hre.network.provider.send("hardhat_setBalance", [
            await signer.getAddress(),
            ethers.utils.formatEther(1010),
          ]);
        await swapTokens(
            mainnet.ETH,
            tokenAddress,
            ethers.utils.formatEther(1000),
            ethers.utils.formatEther(1),
            recipient,
            signer.provider,
            signer,
        )
    })
  })

export {}

