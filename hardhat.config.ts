import path from 'path'
import type { HardhatNetworkConfig } from 'hardhat/types'
import '@nomiclabs/hardhat-waffle'
import '@nomiclabs/hardhat-etherscan'
import '@tenderly/hardhat-tenderly'
import '@nomiclabs/hardhat-ethers'
import 'hardhat-log-remover'
import 'hardhat-contract-sizer'
import 'solidity-coverage'
import 'hardhat-abi-exporter'
import './tasks/update-vowner'
// import 'hardhat-gas-reporter'

import { config as env } from 'dotenv'
env({ path: path.resolve(__dirname, '.env') })

if (!process.env.PRIV_KEY_MAINNET) {
  throw new Error(`No private key provided`)
}

const blockNumber = process.env.BLOCK_NUMBER
if (!blockNumber) {
  throw new Error(`You must provide a block number.`)
}

if (!/^\d+$/.test(blockNumber)) {
  throw new Error(`Provide a valid block number. Provided value is ${blockNumber}`)
}

console.log(`Forking from block number: ${blockNumber}`)

function createHardhatNetwork(
  network: string,
  node: string | undefined,
  key: string | undefined,
  gasPrice: number,
) {
  if (!node) {
    return null
  }

  return [
    network,
    {
      url: node,
      accounts: [key],
      gasPrice,
    },
  ]
}

const config = {
  networks: {
    local: {
      url: 'http://127.0.0.1:8545',
      timeout: 100000,
    },
    hardhat: {
      forking: {
        url: process.env.ALCHEMY_NODE!,
        blockNumber: parseInt(blockNumber),
      },
      chainId: 2137,
      mining: {
        auto: true,
      },
      hardfork: 'london',
      gas: 'auto',
      initialBaseFeePerGas: 1000000000,
      allowUnlimitedContractSize: true,
      timeout: 100000,
    },
    ...Object.fromEntries(
      [
        createHardhatNetwork(
          'mainnet',
          process.env.ALCHEMY_NODE,
          process.env.PRIV_KEY_MAINNET!,
          40000000000,
        ),
        createHardhatNetwork(
          'rinkeby',
          process.env.ALCHEMY_NODE_RINKEBY,
          process.env.PRIV_KEY_MAINNET!,
          40000000000,
        ),
        createHardhatNetwork(
          'goerli',
          process.env.ALCHEMY_NODE_GOERLI,
          process.env.PRIV_KEY_MAINNET!,
          40000000000,
        ),
      ].filter(Boolean) as [string, HardhatNetworkConfig][],
    ),
  },
  solidity: {
    version: '0.7.6',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  tenderly: {
    username: process.env.TENDERLY_USERNAME!,
    project: process.env.TENDERLY_PROJECT!,
    forkNetwork: '1',
  },
  mocha: {
    timeout: 600000,
  },
  abiExporter: {
    path: './abi',
    // clear: true,
    flat: true,
    // only: [':ERC20$'],
    spacing: 2,
    runOnCompile: true,
  },
}

export default config
