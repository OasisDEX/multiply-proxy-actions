const { ethers } = require('hardhat');
/*
In order to verify call
npx hardhat verify >>address<< --network rinkeby/mainnet
npx hardhat verify  --constructor-args prod-exchange-params.js >>address<< --network rinkeby/mainnet
*/

async function deploy() {
  const provider = ethers.provider;
  const signer = provider.getSigner(0);
  const authCaller = process.env.AUTH_CALLER;
  const feeRecipient = process.env.FEE_RECIPIENT;
  const FEE = 0;

  console.log('Deployer address:',await signer.getAddress());
  console.log('---Deploying the system---')
  
  const MPActions = await ethers.getContractFactory('MultiplyProxyActions', signer)
  console.log('---Deploying MultiplyProxyActions---')
  const multiplyProxyActions = await MPActions.deploy()
  let mpa =await multiplyProxyActions.deployed();
  console.log('---MultiplyProxyActions Deployed---', mpa.address)

  const Exchange = await ethers.getContractFactory('Exchange', signer)
  console.log('---Deploying Exchange---')
  const exchange = await Exchange.deploy(
    authCaller,
    feeRecipient,
    FEE,
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