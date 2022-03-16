import { task } from 'hardhat/config'
import erc20abi from '../abi/IERC20.json'

task('pilfer', 'Transfers funds from the provided address to your wallet.  Mainnet not supported :(')
  .addParam('theRich', 'Address of the wallet that we are transferring tokens from (robbing the rich)')
  .addParam('thePoor', 'Address of the wallet that we are transferring tokens to (to feed the poor)')
  .addParam('tokenAddress', 'The address of the token that we want to transfer')
  .setAction(async (taskArgs, hre) => {
    const thePoorSigner = hre.ethers.provider.getSigner(0)

    const thePoorAddress = await thePoorSigner.getAddress()

    const theRichAddress = '0x56c915758ad3f76fd287fff7563ee313142fb663'

    const tokenAddress = '0x06325440D014e39736583c165C2963BA99fAf14E'

    // send the rich some ether so that she can cover the gas costs of the transaction
    await thePoorSigner.sendTransaction({
      from: thePoorAddress,
      to: theRichAddress,
      value: hre.ethers.utils.parseEther('1'),
      gasLimit: hre.ethers.utils.hexlify(1000000),
    })

    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [theRichAddress],
    })

    const theRichSigner = await hre.ethers.getSigner(theRichAddress)

    console.log(`the rich=${theRichSigner.address} the poor=${thePoorAddress}`)

    console.log(hre.ethers)

    const tokenContract = new hre.ethers.Contract(tokenAddress, erc20abi, theRichSigner)

    const tokenBalanace = await tokenContract.balanceOf(theRichAddress)

    await tokenContract.transfer(thePoorAddress, tokenBalanace.toString())

    console.log(tokenBalanace)
    console.log('Impersonation done')
  })

export {}
