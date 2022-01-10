// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
import { network } from 'hardhat'
import readline from 'readline'

export function start(main: () => Promise<any>) {
  if (network.name !== 'mainnet') {
    main()
      .then(() => console.log('\nFinished'))
      .catch(error => console.error(error))
  } else {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    const { gasPrice } = network.config
    const gasPriceText = typeof gasPrice === 'number' ? `${gasPrice / 1e9} gwei` : gasPrice

    console.log('-------------------------------------------------------------')
    rl.question(`Network: ${network.name}\nGas price: ${gasPriceText}\nCONFIRM [y]/n: `, answer => {
      if (answer === 'y' || answer === '') {
        main()
          .catch(error => console.error(error))
          .finally(() => rl.close())
      } else {
        rl.close()
      }
    })

    rl.on('close', () => {
      console.log('\nFinished')
      process.exitCode = 0
    })
  }
}
