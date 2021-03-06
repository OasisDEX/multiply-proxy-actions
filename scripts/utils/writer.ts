import { config } from 'dotenv'
import { mkdirSync, writeFileSync } from 'fs'
import { getFile, getCurrentDir } from './utils'

config()

export const DEPLOYMENTS_FOLDER_NAME = 'deployments'

export async function write(
  contractName: string,
  network: string,
  address: string,
  ...args: any[]
) {
  const filename = (await getFile(`./artifacts/`, `${contractName}.json`))[0]
  const file = require(filename)

  const newFile = {
    contractName: file.contractName,
    abi: file.abi,
    networks: file.networks || {},
  }

  if (!newFile.networks[network]) {
    newFile.networks[network] = {}
  }

  if (network === 'mainnet') {
    newFile.networks[network].address = address
    newFile.networks[network].args = args
  }

  try {
    const currentDir = await getCurrentDir()

    mkdirSync(`${currentDir}/${DEPLOYMENTS_FOLDER_NAME}`, { recursive: true })

    const writeFilename = `${currentDir}/${DEPLOYMENTS_FOLDER_NAME}/${contractName}.json`
    writeFileSync(writeFilename, JSON.stringify(newFile, null, '\t'))

    return
  } catch (e) {
    console.log(e)
  }
}
