import { task } from 'hardhat/config'
import { ethers } from 'ethers'

import mainnet from '../addresses/mainnet.json'

function getStorageSlotForMapping(slot: Number, key: string) {
  return ethers.BigNumber.from(ethers.utils.solidityKeccak256(['uint256','uint256'],[key,slot]))
}

task('get-proxy', 'Impersonates account and take their proxy')
  .addParam('proxy', 'A proxy address to transfer')
  .addOptionalParam('to', '[Optional] address to transfer proxy to, default address 0')
  .setAction(async (taskArgs, hre) => {
    const dssProxyInterface = [
      'function setOwner(address owner_)',
      'function owner() public view returns (address)'
    ]
    const proxyRegistryInterface = [
      'function proxies(address) public view returns (address)',
    ]

    const signer = hre.ethers.provider.getSigner(0)
    const newProxyOwner = taskArgs.to || await signer.getAddress()
    console.log(`New owner address: ${newProxyOwner}`)
    
    const dssProxy = new hre.ethers.Contract(taskArgs.proxy, dssProxyInterface, signer)
    const proxyRegistry = new hre.ethers.Contract(mainnet.PROXY_REGISTRY, proxyRegistryInterface, signer)

    const newOwnerExistingProxy = await proxyRegistry.proxies(newProxyOwner)

    if (newOwnerExistingProxy !== hre.ethers.constants.AddressZero) {
      console.log(`User already has a proxy, removing old proxy: ${newOwnerExistingProxy}`)
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [newProxyOwner],
      })
      await signer.sendTransaction({
        from: signer.getAddress(),
        to: newProxyOwner,
        value: hre.ethers.utils.parseEther('1'),
        gasLimit: hre.ethers.utils.hexlify(1000000),
      })
      const newProxyOwnerSigner = await hre.ethers.getSigner(newProxyOwner)
      const existingProxy = new hre.ethers.Contract(newOwnerExistingProxy, dssProxyInterface, newProxyOwnerSigner)
      await existingProxy.setOwner(hre.ethers.constants.AddressZero)

      await hre.network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [newProxyOwner],
      });
    }


    const proxyOwner = await dssProxy.owner()

    // Send some Eth to proxyOwner so they have some Eth to cover transfer costs
    await signer.sendTransaction({
      from: signer.getAddress(),
      to: proxyOwner,
      value: hre.ethers.utils.parseEther('1'),
      gasLimit: hre.ethers.utils.hexlify(1000000),
    })
    

    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [proxyOwner],
    })

    const proxyOwnerSigner = await hre.ethers.getSigner(proxyOwner)

    const dssProxyImpersonated= new hre.ethers.Contract(taskArgs.proxy, dssProxyInterface, proxyOwnerSigner)
    
    await dssProxyImpersonated.setOwner(newProxyOwner)

    console.log(`Proxy transferred to ${await dssProxyImpersonated.owner()}`)
    console.log('Updating proxy registry...')
  
    const storageSlot = getStorageSlotForMapping(0, newProxyOwner)

    await hre.network.provider.send("hardhat_setStorageAt", [
      mainnet.PROXY_REGISTRY,
      storageSlot.toHexString(),
      ethers.utils.hexZeroPad(taskArgs.proxy, 32),
    ]);
    console.log(`Proxy registry mapping updated: user(${newProxyOwner}) => ${await proxyRegistry.proxies(newProxyOwner)}`)
  })

export {}
