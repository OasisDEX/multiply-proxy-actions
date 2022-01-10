import { exec } from 'child_process'
import { getFile } from './utils'
import { DEPLOYMENTS_FOLDER_NAME } from './writer'

const networkName = process.argv[2]
const contractName = process.argv[3]

if (!contractName || !networkName) {
  process.exitCode = 1
  throw new Error('You need to provide network name and contract name respectively')
}

;(async () => {
  const filename = (await getFile(`./${DEPLOYMENTS_FOLDER_NAME}`, `${contractName}.json`))[0]
  const file = require(filename)
  const address = file.networks[networkName].address
  const args = file.networks[networkName].args.join(' ')

  const command = `npx hardhat verify --network ${networkName} ${address} ${args}`

  console.log(command)

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.log(`error: ${error.message}`)
      return
    }
    if (stderr) {
      console.log(`stderr: ${stderr}`)
      return
    }
    console.log(`stdout: ${stdout}`)
  })
})()
