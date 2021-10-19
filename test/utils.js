const hre = require('hardhat')

const R = require('ramda')
const fs = require('fs')
const { utils } = require('ethers')
const chalk = require('chalk')
const BigNumber = require('bignumber.js')

const nullAddress = '0x0000000000000000000000000000000000000000'
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const ETH_ADDR = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

const MAX_UINT = '115792089237316195423570985008687907853269984665640564039457584007913129639935'

const standardAmounts = {
  ETH: '2',
  WETH: '2',
  AAVE: '8',
  BAT: '4000',
  USDC: '2000',
  UNI: '50',
  SUSD: '2000',
  BUSD: '2000',
  SNX: '100',
  REP: '70',
  REN: '1000',
  MKR: '1',
  ENJ: '1000',
  DAI: '2000',
  WBTC: '0.04',
  RENBTC: '0.04',
  ZRX: '2000',
  KNC: '1000',
  MANA: '2000',
  PAXUSD: '2000',
  COMP: '5',
  LRC: '3000',
  LINK: '70',
  USDT: '2000',
  TUSD: '2000',
  BAL: '50',
  GUSD: '2000',
  YFI: '0.05',
}

const zero = new BigNumber(0)
const one = new BigNumber(1)
const TEN = new BigNumber(10)

const fetchStandardAmounts = async () => {
  return standardAmounts
}

const abiEncodeArgs = (deployed, contractArgs) => {
  // not writing abi encoded args if this does not pass
  if (!contractArgs || !deployed || !R.hasPath(['interface', 'deploy'], deployed)) {
    return ''
  }
  const encoded = utils.defaultAbiCoder.encode(deployed.interface.deploy.inputs, contractArgs)
  return encoded
}

const deploy = async (contractName, _args = [], overrides = {}, libraries = {}, silent) => {
  if (silent == false) console.log(` 🛰  Deploying: ${contractName}`)

  const contractArgs = _args || []
  const contractArtifacts = await ethers.getContractFactory(contractName, {
    libraries: libraries,
  })
  const deployed = await contractArtifacts.deploy(...contractArgs, overrides)
  const encoded = abiEncodeArgs(deployed, contractArgs)
  fs.writeFileSync(`artifacts/${contractName}.address`, deployed.address)

  let extraGasInfo = ''
  if (deployed && deployed.deployTransaction) {
    const gasUsed = deployed.deployTransaction.gasLimit.mul(deployed.deployTransaction.gasPrice)
    extraGasInfo = '(' + utils.formatEther(gasUsed) + ' ETH)'
  }
  if (silent == false) {
    console.log(
      ' 📄',
      chalk.cyan(contractName),
      'deployed to:',
      chalk.magenta(deployed.address),
      chalk.grey(extraGasInfo),
      'in block',
      chalk.yellow(deployed.deployTransaction.blockNumber),
    )
  }

  if (!encoded || encoded.length <= 2) return deployed
  fs.writeFileSync(`artifacts/${contractName}.args`, encoded.slice(2))

  return deployed
}

const send = async (tokenAddr, to, amount) => {
  const tokenContract = await hre.ethers.getContractAt('IERC20', tokenAddr)

  await tokenContract.transfer(to, amount)
}

const approve = async (tokenAddr, to) => {
  const tokenContract = await hre.ethers.getContractAt('IERC20', tokenAddr)

  const allowance = await tokenContract.allowance(tokenContract.signer.address, to)

  if (allowance.toString() == '0') {
    await tokenContract.approve(to, MAX_UINT, { gasLimit: 1000000 })
  }
}

const sendEther = async (signer, to, amount) => {
  const value = ethers.utils.parseUnits(amount, 18)
  const txObj = await signer.populateTransaction({ to, value, gasLimit: 300000 })

  await signer.sendTransaction(txObj)
}

const balanceOf = async (tokenAddr, addr) => {
  const tokenContract = await hre.ethers.getContractAt('IERC20', tokenAddr)

  let balance = ''

  if (tokenAddr.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
    balance = await hre.ethers.provider.getBalance(addr)
  } else {
    balance = await tokenContract.balanceOf(addr)
  }

  // console.log(`Balance of ${tokenAddr} for ${addr} is ${balance.toString()} in block ${await hre.ethers.provider.getBlockNumber()}`);

  return balance
}

const isEth = (tokenAddr) => {
  if (
    tokenAddr.toLowerCase() === ETH_ADDR.toLowerCase() ||
    tokenAddr.toLowerCase() === WETH_ADDRESS.toLowerCase()
  ) {
    return true
  }

  return false
}

const convertToWeth = (tokenAddr) => {
  if (isEth(tokenAddr)) {
    return WETH_ADDRESS
  }

  return tokenAddr
}

const impersonateAccount = async (account) => {
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [account],
  })
}

const stopImpersonatingAccount = async (account) => {
  await hre.network.provider.request({
    method: 'hardhat_stopImpersonatingAccount',
    params: [account],
  })
}

const timeTravel = async (timeIncrease) => {
  await hre.network.provider.request({
    method: 'evm_increaseTime',
    params: [timeIncrease],
    id: new Date().getTime(),
  })
}

module.exports = {
  deploy,
  send,
  approve,
  balanceOf,
  isEth,
  sendEther,
  impersonateAccount,
  stopImpersonatingAccount,
  convertToWeth,
  timeTravel,
  fetchStandardAmounts,
  standardAmounts,
  nullAddress,
  WETH_ADDRESS,
  ETH_ADDR,
  MAX_UINT,
  zero,
  one,
  TEN,
}
