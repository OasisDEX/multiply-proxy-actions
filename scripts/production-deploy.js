const { ethers } = require('hardhat');
const { init, deploySystem,getOraclePrice } = require('../test/common/mcd-deployment-utils');

const {
  amountToWei
} = require('../test/common/params-calculation-utils')

async function deploy() {
  const [provider, signer] = await init(undefined,ethers.provider);
  console.log('---Deploying the system---')
  let contracts = await deploySystem(provider, signer, false, true);
  oraclePrice = await getOraclePrice(provider);
  marketPrice = oraclePrice;
  console.log('---Change price---',oraclePrice.toFixed(0))
  await contracts.exchangeInstance.setPrice(amountToWei(marketPrice).toFixed(0));
  console.log('---System successfully deployed!---')
}

deploy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });