const path = require('path');
require('dotenv').config({path:path.resolve(__dirname,".env")});
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-etherscan");
require("@tenderly/hardhat-tenderly");
require("@nomiclabs/hardhat-ethers");
// require("hardhat-gas-reporter");
require('hardhat-log-remover');
require("solidity-coverage");
require('hardhat-abi-exporter');



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
        blockNumber: 12763570
      },
      // chainId: 1,
      chainId: 2137,
      mining: {
        auto: true
      },
      gas: 12000000,
      blockGasLimit: 14000000,
      allowUnlimitedContractSize: true,
      timeout: 100000,
    },
    mainnet: {
        url: process.env.ALCHEMY_NODE,
        accounts: [process.env.PRIV_KEY_MAINNET],
        gasPrice: 40000000000
    }
  },
  solidity: "0.7.6",
  settings: {
    optimizer: {
      enabled: false,
      runs: 1000
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY
  },
  tenderly: {
    username: process.env.TENDERLY_USERNAME,
    project: process.env.TENDERLY_PROJECT,
    forkNetwork: "1"
  },
  mocha: {
    timeout: 600000
  },
  abiExporter: {
    path: './abi',
    // clear: true,
    flat: true,
    // only: [':ERC20$'],
    spacing: 2
  }

};
