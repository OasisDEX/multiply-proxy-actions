const { init, deploySystem,getOraclePrice } = require('../test/common/mcd-deployment-utils');

const {
  amountToWei
} = require('../test/common/params-calculation-utils')

async function deploy() {
  const shouldUseDummy = process.env.USE_DUMMY && process.env.USE_DUMMY === '1'
  console.log('USE_DUMMY', shouldUseDummy)
  const [provider, signer] = await init(process.env.BLOCK_NUMBER);
  console.log('---Deploying the system---')
  let contracts = await deploySystem(provider, signer, shouldUseDummy, true);
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