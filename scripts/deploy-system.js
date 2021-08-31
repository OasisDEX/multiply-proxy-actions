const {
  init,
  deploySystem,
  loadDummyExchangeFixtures,
} = require('../test/common/mcd-deployment-utils')

async function deploy() {
  const shouldDebug = true
  const shouldUseDummy = process.env.USE_DUMMY && process.env.USE_DUMMY === '1'
  const [provider, signer] = await init(process.env.BLOCK_NUMBER)
  console.log('--- Deploying the system ---')
  await deploySystem(provider, signer, shouldUseDummy, shouldDebug)
  if (shouldUseDummy) {
    console.log('--- Using Dummy Exchange ---')
  }
  console.log('--- System successfully deployed! ---')
}

deploy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
