import { expect } from 'chai'
import BigNumber from 'bignumber.js'
import { ethers } from 'hardhat'
import { JsonRpcProvider } from '@ethersproject/providers'
import { Contract, Signer } from 'ethers'
import MAINNET_ADDRESSES from '../addresses/mainnet.json'
import {
  deploySystem,
  getOraclePrice,
  dsproxyExecuteAction,
  getLastCDP,
  findMPAEvent,
  DeployedSystemInfo,
} from './common/utils/mcd-deployment.utils'
import {
  amountToWei,
  calculateParamsIncreaseMP,
  calculateParamsDecreaseMP,
  prepareMultiplyParameters,
  ensureWeiFormat,
} from './common/utils/params-calculation.utils'
import { balanceOf } from './utils'

import ERC20ABI from '../abi/IERC20.json'
import CDPManagerABI from '../abi/external/dss-cdp-manager.json'
import { getVaultInfo } from './common/utils/mcd.utils'
import { expectToBe, expectToBeEqual } from './common/utils/test.utils'
import { one } from './common/cosntants'

const LENDER_FEE = new BigNumber(0)

async function checkMPAPostState(tokenAddress: string, mpaAddress: string) {
  return {
    daiBalance: await balanceOf(MAINNET_ADDRESSES.MCD_DAI, mpaAddress),
    collateralBalance: await balanceOf(tokenAddress, mpaAddress),
  }
}

describe('Multiply Proxy Action with Mocked Exchange', async () => {
  const oazoFee = 2 // divided by base (10000), 1 = 0.01%;
  const oazoFeePct = new BigNumber(oazoFee).div(10000)
  const flashLoanFee = LENDER_FEE
  const slippage = new BigNumber(0.0001) // percentage

  let provider: JsonRpcProvider
  let signer: Signer
  let address: string
  let system: DeployedSystemInfo
  let exchangeDataMock: { to: string; data: number }
  let DAI: Contract

  let CDP_ID: number // this test suite operates on one Vault that is created in first test case (opening Multiply Vault)
  let CDP_ILK: string

  before(async () => {
    provider = new ethers.providers.JsonRpcProvider()
    signer = provider.getSigner(0)
    DAI = new ethers.Contract(MAINNET_ADDRESSES.MCD_DAI, ERC20ABI, provider).connect(signer)
    address = await signer.getAddress()

    provider.send('hardhat_reset', [
      {
        forking: {
          jsonRpcUrl: process.env.ALCHEMY_NODE,
          blockNumber: 13274574,
        },
      },
    ])

    system = await deploySystem(provider, signer, true)

    // exchangeDataMock = {
    //   to: system.exchangeInstance.address,
    //   data: 0,
    // }
    // // await system.exchangeInstance.setSlippage(0);
    // // await system.exchangeInstance.setMode(0);

    // await system.exchangeInstance.setFee(oazoFee)
  })

  describe(`opening Multiply Vault`, async () => {
    const marketPrice = new BigNumber(2380)
    const currentColl = new BigNumber(100) // STARTING COLLATERAL AMOUNT
    const currentDebt = new BigNumber(0) // STARTING VAULT DEBT
    let oraclePrice: BigNumber

    before(async () => {
      oraclePrice = await getOraclePrice(provider)

      await system.exchangeInstance.setPrice(
        MAINNET_ADDRESSES.ETH,
        amountToWei(marketPrice).toFixed(0),
      )
    })

    it(`should open vault with required collateralisation ratio`, async () => {
      const mcdJoinEth = ethers.utils.defaultAbiCoder.encode(["address"], [MAINNET_ADDRESSES.MCD_JOIN_ETH_A])
      const cdpManager = ethers.utils.defaultAbiCoder.encode(["address"], [MAINNET_ADDRESSES.CDP_MANAGER])

      const operationRunnerHashName = await system.serviceRegistry.getServiceNameHash('OPERATION_RUNNER');
      const openVaultHashName = await system.serviceRegistry.getServiceNameHash('OPEN_VAULT');
      const flashLoanHashName = await system.serviceRegistry.getServiceNameHash('FLASH_LOAN');
      const depositHashName = await system.serviceRegistry.getServiceNameHash('DEPOSIT');
      const flashLoanLenderHashName = await system.serviceRegistry.getServiceNameHash('FLASH_LOAN_LENDER');

      const FMM = "0x1EB4CF3A948E7D72A198fe073cCb8C7a948cD853"; // Maker Flash Mint Module

      await system.serviceRegistry.addNamedService(
        operationRunnerHashName,
        system.operationRunner.address,
      )
      await system.serviceRegistry.addNamedService(
        openVaultHashName,
        system.actionOpenVault.address,
      )
      await system.serviceRegistry.addNamedService(
        flashLoanHashName,
        system.actionFlashLoan.address,
      )
      await system.serviceRegistry.addNamedService(
        depositHashName,
        system.actionDeposit.address,
      )
      await system.serviceRegistry.addNamedService(
        flashLoanLenderHashName,
        FMM,
      )

      const dsproxy_calldata = system.operationRunner.interface.encodeFunctionData("executeOperation",
        [{
          name: 'openDepositDrawDebtOperation',
          callData: [
            [mcdJoinEth, cdpManager],
            [1000000,0],
            [0, 10000, mcdJoinEth, system.userProxyAddress, cdpManager ]
          ],
          actionIds: [
            openVaultHashName,
            flashLoanHashName,
            depositHashName],
        }]
      )

      const tx = await system.dsProxyInstance['execute(address,bytes)'](system.operationRunner.address, dsproxy_calldata, {
        from: address,
        value: ensureWeiFormat(0),
        gasLimit: 8500000,
        gasPrice: 1000000000,
      })
      const lastCDP = await getLastCDP(provider, signer, system.userProxyAddress)
      console.log('LAST CDP', lastCDP );
      
      const cdpManagerContract = new ethers.Contract(MAINNET_ADDRESSES.CDP_MANAGER, CDPManagerABI, provider).connect(
        signer,
      )

      const vaultOwner = await cdpManagerContract.owns(lastCDP.id);

      expectToBeEqual(vaultOwner, system.userProxyAddress)
      
    })
  })
})
