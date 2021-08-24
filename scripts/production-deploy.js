const { ethers } = require('hardhat');
const { init, deploySystem,getOraclePrice } = require('../test/common/mcd-deployment-utils');

const {
  amountToWei
} = require('../test/common/params-calculation-utils')

async function deploy() {
  const [provider, signer] = await init(undefined,ethers.provider);
  console.log('Deployer address:',await signer.getAddress());
  console.log('---Deploying the system---')
  let contracts = await deploySystem(provider, signer, false, true, false);
  console.log('---System successfully deployed!---')
}

deploy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });