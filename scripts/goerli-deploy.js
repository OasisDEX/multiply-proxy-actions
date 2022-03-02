const { ethers } = require('hardhat');
/*
In order to verify call
npx hardhat verify >>address<< --network goerli
npx hardhat verify  --constructor-args prod-exchange-params.js >>address<< --network goerli
*/

async function deploy() {
  const provider = ethers.provider;
  const signer = provider.getSigner(0);

  console.log('Deployer address:',await signer.getAddress());
  console.log('---Deploying the system---')

  const MPActions = await ethers.getContractFactory('MultiplyProxyActionsGoerli', signer)
  console.log('---Deploying MultiplyProxyActionsGoerli---')
  const multiplyProxyActions = await MPActions.deploy()
  let mpa =await multiplyProxyActions.deployed();
  console.log('---MultiplyProxyActionsGoerli Deployed---', mpa.address)

  
  const Exchange = await ethers.getContractFactory('GoerliDummyExchange', signer)
  console.log('---Deploying Exchange---')
  const exchange = await Exchange.deploy(
    "0x59A5aC4033dB403587e8BEAb8996EDe2F170413a",
    20,
    0,
    "0x11fe4b6ae13d2a6055c8d9cf65c55bac32b5d844",
    mpa.address
  )
  const exchangeInstance = await exchange.deployed();
  console.log('---Exchange Deployed---', exchangeInstance.address)


  console.log('---System successfully deployed!---')
}

deploy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });