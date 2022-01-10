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

const mainnet = require('./addresses/mainnet.json')

const blockNumber = process.env.BLOCK_NUMBER

if (!blockNumber) {
  throw new Error(`You must provide a block number.`)
}

if (!/^\d+$/.test(blockNumber)) {
  throw new Error(`Provide a valid block number. Provided value is ${blockNumber}`)
}

console.log(`Forking from block number: ${blockNumber}`)
task('updatevowner', 'Impersonates account and changes owner')
  .addParam('vaultid', 'Id of vault that should change user')
  .addParam('oldowner', 'user to be impersonated')
  .addParam('dsproxy', 'dsproxy of a user that is supposed to be impersonated')
  .setAction(async (taskArgs) => {
    const proxyAbi = [
      'function execute(address _target, bytes _data) payable returns (bytes32 response)',
    ]
    const dssAbi = [
      'function giveToProxy(address proxyRegistry, address manager, uint cdp, address dst)',
    ]
    const dssProxyAddress = mainnet.PROXY_ACTIONS
    const proxyRegistry = mainnet.PROXY_REGISTRY
    const manager = mainnet.CDP_MANAGER
    const vaultId = parseInt(await taskArgs.vaultid)
    const oldowner = await taskArgs.oldowner
    const dsproxy = await taskArgs.dsproxy

    const oldSigner = await ethers.getSigner(0)
    provider = ethers.getDefaultProvider()

    const proxyInterface = new ethers.utils.Interface(proxyAbi)
    const dssProxyInterface = new ethers.utils.Interface(dssAbi)

    const dssData = dssProxyInterface.encodeFunctionData('giveToProxy', [
      proxyRegistry,
      manager,
      vaultId,
      oldSigner.address,
    ])

    console.log('dssData', dssData)

    const proxyData = proxyInterface.encodeFunctionData('execute', [dssProxyAddress, dssData])

    console.log('proxyData', proxyData)

    await oldSigner.sendTransaction({
      from: oldSigner.address,
      to: oldowner,
      value: ethers.utils.parseEther('1'),
      gasLimit: ethers.utils.hexlify(1000000),
    })

    console.log(`impersonate=${oldowner}`)

    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [oldowner],
    })

    const newSigner = await ethers.getSigner(oldowner)
    console.log(`newSigner=${newSigner.address} oldSigner=${oldSigner.address}`)
    await newSigner.sendTransaction({
      from: oldowner,
      to: dsproxy,
      data: proxyData,
      gasLimit: ethers.utils.hexlify(10000000),
    })

    console.log('Impersonation done')
  })

function createHardhatNetwork(network, url, key) {
  if (!url) {
    return null
  }

  return [
    network,
    {
      url: url,
      accounts: [key],
      gasPrice: 40000000000,
    },
  ]
}

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
    ...[
      createHardhatNetwork('mainnet', process.env.ALCHEMY_NODE, process.env.PRIV_KEY_MAINNET),
      createHardhatNetwork(
        'rinkeby',
        process.env.ALCHEMY_NODE_RINKEBY,
        process.env.PRIV_KEY_MAINNET,
      ),
      createHardhatNetwork('goerli', process.env.ALCHEMY_NODE_GOERLI, process.env.PRIV_KEY_MAINNET),
    ]
      .filter(Boolean)
      .reduce((agg, [network, config]) => {
        agg[network] = config
        return agg
      }, {}),
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
