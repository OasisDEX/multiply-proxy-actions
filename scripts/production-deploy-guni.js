const { ethers } = require('hardhat');
/*
In order to verify call
npx hardhat verify >>address<< --network rinkeby/mainnet
npx hardhat verify  --constructor-args prod-exchange-params.js >>address<< --network rinkeby/mainnet
*/

async function deploy() {
  const provider = ethers.provider;
  const signer = provider.getSigner(0);

  console.log('Deployer address:', await signer.getAddress());
  console.log('---Deploying GUNI---')

  const GUNIMPActions = await ethers.getContractFactory('GuniMultiplyProxyActions', signer)
  console.log('---Deploying guniMultiplyProxyActions---')
  const guniMultiplyProxyActions = await GUNIMPActions.deploy()
  let mpa = await guniMultiplyProxyActions.deployed();
  console.log('---guniMultiplyProxyActions Deployed---', mpa.address)

}

deploy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });




