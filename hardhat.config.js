const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '.env') })
require('@nomiclabs/hardhat-waffle')
require('@nomiclabs/hardhat-etherscan')
require('@tenderly/hardhat-tenderly')
require('@nomiclabs/hardhat-ethers')
// require("hardhat-gas-reporter");
require('hardhat-log-remover')
require('hardhat-contract-sizer')
require('solidity-coverage')
require('hardhat-abi-exporter')

const blockNumber = process.env.BLOCK_NUMBER

if (!blockNumber) {
  throw new Error(`You must provide a block number.`)
}

if (!/^\d+$/.test(blockNumber)) {
  throw new Error(`Provide a valid block number. Provided value is ${blockNumber}`)
}

console.log(`Forking from block number: ${blockNumber}`)

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  networks: {
    local: {
      url: 'http://127.0.0.1:8545',
      timeout: 100000,
    },
    hardhat: {
      forking: {
        url: process.env.ALCHEMY_NODE,
        blockNumber: parseInt(blockNumber),
      },
      chainId: 2137,
      mining: {
        auto: true,
      },
      hardfork: 'london',
      gas: 'auto',
      initialBaseFeePerGas: '1000000000',
      allowUnlimitedContractSize: true,
      timeout: 100000,
    },
    mainnet: {
      url: process.env.ALCHEMY_NODE,
      accounts: [process.env.PRIV_KEY_MAINNET],
      gasPrice: 40000000000,
    },
    rinkeby: {
      url: process.env.ALCHEMY_NODE_RINKEBY,
      accounts: [process.env.PRIV_KEY_MAINNET],
      gasPrice: 40000000000,
    },
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
    username: process.env.TENDERLY_USERNAME,
    project: process.env.TENDERLY_PROJECT,
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
  },
}
