import { task } from 'hardhat/config'
import erc20abi from '../abi/IERC20.json'

task(
  'pilfer',
  'Transfers funds from the provided address to your wallet.  Mainnet not supported :(',
)
  .addParam(
    'theRich',
    'Address of the wallet that we are transferring tokens from (robbing the rich)',
  )
  .addParam(
    'thePoor',
    'Address of the wallet that we are transferring tokens to (to feed the poor)',
  )
  .addParam(
    'tokenAddress',
    'The address of the token that we want to transfer.  The entire balance at theRich address will be transferred to thePoor.',
  )
  .setAction(async (taskArgs, hre) => {
    const theRichAddress = await taskArgs.theRich
    const theRichSigner = await hre.ethers.getSigner(theRichAddress)

    const thePoorAddress = await taskArgs.thePoor
    const thePoorSigner = await hre.ethers.getSigner(thePoorAddress)

    const tokenAddress = await taskArgs.tokenAddress

    // send the rich some eth so that she can cover the gas costs of the transaction
    await thePoorSigner.sendTransaction({
      from: thePoorAddress,
      to: theRichAddress,
      value: hre.ethers.utils.parseEther('1'),
      gasLimit: hre.ethers.utils.hexlify(1000000),
    })

    console.log(`
    the rich  = ${theRichAddress}
    the poor  = ${thePoorAddress}
    the token = ${tokenAddress}
    `)

    console.log(' ----------------------------- ')
    console.log('| starting balances for token |')
    console.log(' ----------------------------- ')
    const theRichTokenContract = new hre.ethers.Contract(tokenAddress, erc20abi, theRichSigner)
    let theRichTokenBalanace = await theRichTokenContract.balanceOf(theRichAddress)
    console.log(`the rich: ${theRichTokenBalanace}`)

    const thePoorTokenContract = new hre.ethers.Contract(tokenAddress, erc20abi, thePoorSigner)
    let thePoorTokenBalance = await thePoorTokenContract.balanceOf(thePoorAddress)
    console.log(`the poor: ${thePoorTokenBalance}`)

    await theRichTokenContract.transfer(thePoorAddress, theRichTokenBalanace.toString())

    console.log(' --------------------------- ')
    console.log('| ending balances for token |')
    console.log(' --------------------------- ')
    theRichTokenBalanace = await theRichTokenContract.balanceOf(theRichAddress)
    console.log(`the rich: ${theRichTokenBalanace}`)
    thePoorTokenBalance = await thePoorTokenContract.balanceOf(thePoorAddress)
    console.log(`the poor: ${thePoorTokenBalance}`)

    console.log(' --------------------------- ')
    console.log('done')
  })

export {}
