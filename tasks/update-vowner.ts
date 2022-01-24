import { task } from 'hardhat/config'

import mainnet from '../addresses/mainnet.json'

task('updatevowner', 'Impersonates account and changes owner')
  .addParam('vaultid', 'Id of vault that should change user')
  .addParam('oldowner', 'user to be impersonated')
  .addParam('dsproxy', 'dsproxy of a user that is supposed to be impersonated')
  .setAction(async (taskArgs, hre) => {
    const proxyAbi = [
      'function execute(address _target, bytes _data) payable returns (bytes32 response)',
    ]
    const dssAbi = [
      'function giveToProxy(address proxyRegistry, address manager, uint cdp, address dst)',
    ]
    const dssProxyAddress = mainnet.PROXY_ACTIONS
    const proxyRegistry = mainnet.PROXY_REGISTRY
    const manager = mainnet.CDP_MANAGER
    const vaultId = parseInt(await taskArgs.vaultid)
    const oldOwner = await taskArgs.oldowner
    const dsproxy = await taskArgs.dsproxy

    const oldSigner = hre.ethers.provider.getSigner(0)
    const oldSignerAddress = await oldSigner.getAddress()

    const proxyInterface = new hre.ethers.utils.Interface(proxyAbi)
    const dssProxyInterface = new hre.ethers.utils.Interface(dssAbi)

    const dssData = dssProxyInterface.encodeFunctionData('giveToProxy', [
      proxyRegistry,
      manager,
      vaultId,
      oldSignerAddress,
    ])

    console.log('dssData', dssData)

    const proxyData = proxyInterface.encodeFunctionData('execute', [dssProxyAddress, dssData])

    console.log('proxyData', proxyData)

    await oldSigner.sendTransaction({
      from: oldSignerAddress,
      to: oldOwner,
      value: hre.ethers.utils.parseEther('1'),
      gasLimit: hre.ethers.utils.hexlify(1000000),
    })

    console.log(`impersonate=${oldOwner}`)

    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [oldOwner],
    })

    const newSigner = await hre.ethers.getSigner(oldOwner)
    console.log(`newSigner=${newSigner.address} oldSigner=${oldSignerAddress}`)
    await newSigner.sendTransaction({
      from: oldOwner,
      to: dsproxy,
      data: proxyData,
      gasLimit: hre.ethers.utils.hexlify(10000000),
    })

    console.log('Impersonation done')
  })

export {}
