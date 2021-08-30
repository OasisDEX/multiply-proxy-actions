const {
  init,
  deploySystem,
  loadDummyExchangeFixtures,
} = require('../test/common/mcd-deployment-utils')

async function deploy() {
  const shouldDebug = true;
  const shouldUseDummy = process.env.USE_DUMMY && process.env.USE_DUMMY === '1'
  const [provider, signer] = await init(process.env.BLOCK_NUMBER)
  console.log('--- Deploying the system ---')
  const contracts = await deploySystem(provider, signer, shouldUseDummy, shouldDebug)
  if (shouldUseDummy) {
    console.log('--- Using Dummy Exchange ---')
    await loadDummyExchangeFixtures(provider, signer, contracts.exchangeInstance, shouldDebug)
  }
  console.log('--- System successfully deployed! ---')
  if (shouldDebug) {
    console.log('Signer address:', await signer.getAddress())
    console.log('Exchange address:', contracts.exchangeInstance.address)
    console.log('User Proxy Address:', contracts.userProxyAddress)
    console.log('DSProxy address:', contracts.dsProxyInstance.address)
    console.log(
      'MultiplyProxyActions address:',
      contracts.multiplyProxyActionsInstance.address,
    )
    console.log('MCDView address:', contracts.mcdViewInstance.address)
  }
}

deploy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
