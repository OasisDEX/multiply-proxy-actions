import { network, ethers } from 'hardhat'
import { BigNumber as EthersBN, Signer } from 'ethers'
import { config } from 'dotenv'
import { write } from './writer'

config()

async function getGasPrice(exGasPrice) {
  let defaultGasPrice = EthersBN.from(10000000000)
  let newGasPrice = defaultGasPrice

  if (exGasPrice.gt(0)) {
    newGasPrice = exGasPrice.add(exGasPrice.div(8))
  } else {
    if (network.name === 'mainnet') {
      defaultGasPrice = EthersBN.from(network.config.gasPrice)
      newGasPrice = defaultGasPrice.gt(0) ? defaultGasPrice : await ethers.provider.getGasPrice()
    }
  }

  if (exGasPrice.gte(newGasPrice)) {
    newGasPrice = exGasPrice.add(1)
  }

  return newGasPrice
}

export async function deploy(
  contractName: string,
  signer: Signer,
  action: string,
  gasPrice,
  nonce: number,
  ...args: any[]
) {
  try {
    console.log('-------------------------------------------------------------')

    const Contract = await ethers.getContractFactory(contractName, signer)
    // const provider = await ethers.provider

    let options = { gasPrice, nonce }

    if (nonce === -1) {
      options = { gasPrice }
    }

    let contract
    if (!args.length) {
      contract = await Contract.deploy(options)
    } else {
      contract = await Contract.deploy(...args, options)
    }

    console.log(`${action} ${contractName}: ${contract.deployTransaction.hash}`)
    console.log(`Gas price: ${parseInt(gasPrice.toString()) / 1e9}`)

    await contract.deployed()
    const tx = await contract.deployTransaction.wait(1)

    console.log(`Gas used: ${tx.gasUsed}`)
    console.log(`${contractName} deployed to:`, contract.address)
    console.log(`Mainnet link: https://etherscan.io/address/${contract.address}`)

    await write(contractName, network.name, contract.address, ...args)
    console.log('-------------------------------------------------------------')
    return contract
  } catch (e) {
    console.log(e)
    return null
  }
}

export async function deployWithResend(
  contractName: string,
  signer: Signer,
  action: string,
  exGasPrice,
  nonce,
  ...args: any[]
) {
  const timeoutMinutes = process.env.TIMEOUT_MINUTES ? parseFloat(process.env.TIMEOUT_MINUTES) : 1
  const gasPrice = await getGasPrice(exGasPrice)
  const deployPromise = deploy(contractName, signer, action, gasPrice, nonce, ...args)

  return new Promise(resolve => {
    const timeoutId = setTimeout(
      () => resolve(deployWithResend(contractName, signer, 'Resending', gasPrice, nonce, ...args)),
      timeoutMinutes * 60 * 1000,
    )

    deployPromise.then(contract => {
      clearTimeout(timeoutId)

      if (contract !== null) {
        resolve(contract)
      }
    })
  })
}

export async function deployContract(contractName: string, ...args: any[]) {
  const signers = await ethers.getSigners()
  const address = await signers[0].getAddress()
  const nonce = await ethers.provider.getTransactionCount(address)

  return deployWithResend(
    contractName,
    signers[0],
    'Deploying',
    ethers.BigNumber.from('0'),
    nonce,
    ...args,
  )
}

export async function deployAsOwner(contractName: string, signer: Signer, ...args: any[]) {
  return deployWithResend(
    contractName,
    signer,
    'Deploying',
    ethers.BigNumber.from('0'),
    -1,
    ...args,
  )
}

module.exports = {
  deployWithResend,
}
