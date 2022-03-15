import { task } from 'hardhat/config'
import erc20abi from '../abi/IERC20.json'

task('pilfer', 'Impersonates account and changes owner')
  // .addParam('vaultid', 'Id of vault that should change user')
  // .addParam('oldowner', 'user to be impersonated')
  // .addParam('dsproxy', 'dsproxy of a user that is supposed to be impersonated')
  .setAction(async (taskArgs, hre) => {
    const thePoor = hre.ethers.provider.getSigner(0)
    const thePoorAddress = await thePoor.getAddress()

      const theRich = '0x56c915758ad3f76fd287fff7563ee313142fb663'

      const tokenAddress = '0x06325440D014e39736583c165C2963BA99fAf14E'

      // send the poor some ether so that he can cover the gas costs of the transaction
    await thePoor.sendTransaction({
      from: thePoorAddress,
      to: theRich,
      value: hre.ethers.utils.parseEther('1'),
      gasLimit: hre.ethers.utils.hexlify(1000000),
    })
      console.log('here')

    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [theRich],
    })

    const theRichSigner = await hre.ethers.getSigner(theRich)
      
    console.log(`the rich=${theRichSigner.address} the poor=${thePoorAddress}`)

      console.log(hre.ethers)

    const tokenContract = new hre.ethers.Contract(tokenAddress, erc20abi, theRichSigner)

      const tokenBalanace = await tokenContract.balanceOf(theRich)

      await tokenContract.transfer(thePoorAddress, tokenBalanace.toString())

      console.log(tokenBalanace)
    console.log('Impersonation done')
  })

export {}
