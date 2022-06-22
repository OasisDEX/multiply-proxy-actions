import { ethers } from 'hardhat'
/**
 * In order to verify call
 *  `npx hardhat verify <address> --network goerli`
 *  `npx hardhat verify --constructor-args prod-exchange-params.ts <address> --network goerli`
 */

async function deploy() {
  const provider = ethers.provider
  const signer = provider.getSigner(0)

  const deployerAddress = await signer.getAddress()
  console.log('Deployer address:', await signer.getAddress())
  console.log('---Deploying the system---')

  const MPActions = await ethers.getContractFactory('MultiplyProxyActions', signer)
  console.log('---Deploying MultiplyProxyActions---')
  const multiplyProxyActions = await MPActions.deploy()
  const mpa = await multiplyProxyActions.deployed()
  console.log('---MultiplyProxyActions Deployed---', mpa.address)

  const Exchange = await ethers.getContractFactory('GoerliDummyExchange', signer)
  console.log('---Deploying Exchange---')
  const exchange = await Exchange.deploy(
    deployerAddress,
    20,
    0,
    '0x11fe4b6ae13d2a6055c8d9cf65c55bac32b5d844',
    mpa.address,
  )
  const exchangeInstance = await exchange.deployed()
  console.log('---Exchange Deployed---', exchangeInstance.address)

  console.log('---System successfully deployed!---')
}

deploy()
  .then(() => (process.exitCode = 0))
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
