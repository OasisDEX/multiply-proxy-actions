import BigNumber from 'bignumber.js'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { JsonRpcProvider } from '@ethersproject/providers'
import { Contract, Signer } from 'ethers'
import WETHABI from '../abi/IWETH.json'
import ERC20ABI from '../abi/IERC20.json'
import MAINNET_ADDRESSES from '../addresses/mainnet.json'
import {
  FEE,
  FEE_BASE,
  init,
  loadDummyExchangeFixtures,
  swapTokens,
} from './common/mcd-deployment-utils'
import { amountFromWei, amountToWei } from './common/params-calculation-utils'
import { exchangeToDAI, exchangeFromDAI } from './common/http-apis'
import { balanceOf } from './utils'
import { asPercentageValue, expectToBe, expectToBeEqual } from './_utils'

const AGGREGATOR_V3_ADDRESS = '0x11111112542d85b3ef69ae05771c2dccff4faa26'
const ALLOWED_PROTOCOLS = ['UNISWAP_V2']

describe('Exchange', async () => {
  let provider: JsonRpcProvider
  let signer: Signer
  let address: string
  let exchange: Contract
  let WETH: Contract
  let DAI: Contract
  let feeBeneficiary: string
  let slippage: ReturnType<typeof asPercentageValue>
  let fee: ReturnType<typeof asPercentageValue>
  let snapshotId: string

  before(async () => {
    console.log('Before init')
    ;[provider, signer] = await init()
    console.log('After init')
    address = await signer.getAddress()

    feeBeneficiary = await provider.getSigner(1).getAddress()
    slippage = asPercentageValue(8, 100)
    fee = asPercentageValue(FEE, FEE_BASE)

    console.log('Fee and slippage', FEE, 8)

    const GoerliDummyExchange = await ethers.getContractFactory('GoerliDummyExchange', signer)
    exchange = await GoerliDummyExchange.deploy(
      feeBeneficiary,
      FEE,
      8,
      MAINNET_ADDRESSES.MCD_DAI,
      address,
    )
    await exchange.deployed()

    await loadDummyExchangeFixtures(provider, signer, exchange, true)
    console.log('After deploy', address)

    WETH = new ethers.Contract(MAINNET_ADDRESSES.ETH, WETHABI, provider).connect(signer)
    DAI = new ethers.Contract(MAINNET_ADDRESSES.MCD_DAI, ERC20ABI, provider).connect(signer)
  })

  beforeEach(async () => {
    snapshotId = await provider.send('evm_snapshot', [])
  })

  afterEach(async () => {
    await provider.send('evm_revert', [snapshotId])
  })

  it('should have fee set', async () => {
    const exchangeFee = await exchange.fee()
    expectToBeEqual(exchangeFee.toString(), fee.value)
  })

  it('should have fee beneficiary address set', async () => {
    const exchangeFeeBeneficiary = await exchange.feeBeneficiaryAddress()
    expect(exchangeFeeBeneficiary).to.be.eq(feeBeneficiary)
  })

  it('should have a whitelisted caller set', async () => {
    expect(await exchange.WHITELISTED_CALLERS(address)).to.be.true
  })

  describe('Asset for DAI', async () => {
    const amount = new BigNumber(10)
    const amountInWei = amountToWei(amount)
    let receiveAtLeastInWei: BigNumber
    let to: string
    let data: string
    // let initialDaiWalletBalance: BigNumber

    before(async () => {
      const response = await exchangeToDAI(
        MAINNET_ADDRESSES.ETH,
        amountInWei.toFixed(0),
        exchange.address,
        slippage.value.toString(),
        ALLOWED_PROTOCOLS,
      )
      // initialDaiWalletBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)

      to = response.tx.to
      data = response.tx.data

      const receiveAtLeast = amountFromWei(response.toTokenAmount).times(
        new BigNumber(1).minus(slippage.asDecimal),
      )
      receiveAtLeastInWei = amountToWei(receiveAtLeast)
    })

    afterEach(async () => {
      await provider.send('evm_revert', [snapshotId])
    })

    it('should not happen if it is triggered from unauthorized caller', async () => {
      const tx = exchange
        .connect(provider.getSigner(1))
        .swapTokenForDai(
          MAINNET_ADDRESSES.ETH,
          amountToWei(1).toFixed(0),
          amountFromWei(1).toFixed(0),
          AGGREGATOR_V3_ADDRESS,
          0,
        )
      await expect(tx).to.be.revertedWith('Exchange / Unauthorized Caller')
    })

    describe('when transferring an exact amount to the exchange', async () => {
      let initialWethWalletBalance: BigNumber
      let localSnapshotId: string

      beforeEach(async () => {
        localSnapshotId = await provider.send('evm_snapshot', [])

        await WETH.deposit({
          value: amountToWei(amount).toFixed(0),
        })

        initialWethWalletBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)

        await WETH.approve(exchange.address, amountInWei.toFixed(0))

        await exchange.swapTokenForDai(
          MAINNET_ADDRESSES.ETH,
          amountInWei.toFixed(0),
          receiveAtLeastInWei.toFixed(0),
          to,
          data,
          {
            value: 0,
            gasLimit: 2500000,
          },
        )
      })

      afterEach(async () => {
        await provider.send('evm_revert', [localSnapshotId])
      })

      // TODO: I finished here
      it(`should receive at least amount specified in receiveAtLeast`, async () => {
        const wethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)
        const daiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, address)

        expectToBeEqual(wethBalance, initialWethWalletBalance.minus(amountToWei(amount)))
        expectToBe(daiBalance, 'gte', receiveAtLeastInWei)
      })

      it('should have collected fee', async () => {
        const beneficiaryDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, feeBeneficiary)

        const expectedCollectedFee = amountFromWei(receiveAtLeastInWei)
          .div(new BigNumber(1).minus(slippage.asDecimal))
          .times(fee.asDecimal)

        expectToBeEqual(amountFromWei(beneficiaryDaiBalance), expectedCollectedFee, 6)
      })
    })

    describe('when transferring less amount to the exchange', async () => {
      let initialWethWalletBalance: BigNumber
      let lessThanTheTransferAmount: BigNumber
      let localSnapshotId: string

      beforeEach(async () => {
        localSnapshotId = await provider.send('evm_snapshot', [])

        await WETH.deposit({
          value: amountToWei(1000).toFixed(0),
        })

        initialWethWalletBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)
        lessThanTheTransferAmount = amountInWei.minus(5)

        await WETH.approve(exchange.address, lessThanTheTransferAmount.toFixed(0))
      })

      afterEach(async () => {
        await provider.send('evm_revert', [localSnapshotId])
      })

      it('should throw an error and not exchange anything', async () => {
        const tx = exchange.swapTokenForDai(
          MAINNET_ADDRESSES.ETH,
          amountInWei.toFixed(0),
          receiveAtLeastInWei.toFixed(0),
          to,
          data,
          {
            value: 0,
            gasLimit: 2500000,
          },
        )
        await expect(tx).to.be.revertedWith('Exchange / Not enought allowance')

        const wethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)

        expectToBeEqual(wethBalance, initialWethWalletBalance)
      })
    })
  })

  describe('DAI for Asset', async () => {
    let initialDaiWalletBalance: BigNumber
    let amountWithFeeInWei: BigNumber
    let receiveAtLeastInWei: BigNumber
    let to: string
    let data: string

    before(async () => {
      const amountInWei = amountToWei(1000)
      amountWithFeeInWei = amountInWei.div(new BigNumber(1).minus(fee.asDecimal))

      const response = await exchangeFromDAI(
        MAINNET_ADDRESSES.ETH,
        amountInWei.toFixed(0),
        slippage.value.toString(),
        exchange.address,
        ALLOWED_PROTOCOLS,
      )

      to = response.tx.to
      data = response.tx.data

      const receiveAtLeast = amountFromWei(response.toTokenAmount).times(
        new BigNumber(1).minus(slippage.asDecimal),
      )
      receiveAtLeastInWei = amountToWei(receiveAtLeast)
    })

    it('should not happen if it is triggered from unauthorized caller', async () => {
      const tx = exchange
        .connect(provider.getSigner(1))
        .swapDaiForToken(
          MAINNET_ADDRESSES.ETH,
          amountToWei(1).toFixed(0),
          amountFromWei(1).toFixed(0),
          AGGREGATOR_V3_ADDRESS,
          0,
        )

      await expect(tx).to.be.revertedWith('Exchange / Unauthorized Caller')
    })

    describe('when transferring an exact amount to the exchange', async () => {
      let localSnapshotId: string

      beforeEach(async () => {
        localSnapshotId = await provider.send('evm_snapshot', [])

        await swapTokens(
          MAINNET_ADDRESSES.ETH,
          MAINNET_ADDRESSES.MCD_DAI,
          amountToWei(10).toFixed(0),
          amountWithFeeInWei.toFixed(0),
          address,
          provider,
          signer,
        )

        initialDaiWalletBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, address)

        await DAI.approve(exchange.address, amountWithFeeInWei.toFixed(0))

        await exchange.swapDaiForToken(
          MAINNET_ADDRESSES.ETH,
          amountWithFeeInWei.toFixed(0),
          receiveAtLeastInWei.toFixed(0),
          to,
          data,
          {
            value: 0,
            gasLimit: 2500000,
          },
        )
      })

      afterEach(async () => {
        await provider.send('evm_revert', [localSnapshotId])
      })

      it(`should receive at least amount specified in receiveAtLeast`, async () => {
        const wethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)
        const daiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, address)

        expectToBeEqual(daiBalance, initialDaiWalletBalance.minus(amountWithFeeInWei), 0)
        expectToBe(wethBalance, 'gte', receiveAtLeastInWei)
      })

      it('should have collected fee', async () => {
        const beneficiaryDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, feeBeneficiary)

        const expectedCollectedFee = amountWithFeeInWei.times(fee.asDecimal)
        expectToBeEqual(beneficiaryDaiBalance, expectedCollectedFee, 0)
      })
    })

    describe('when transferring less amount to the exchange', async () => {
      let lessThanTheTransferAmount: BigNumber
      let deficitAmount: BigNumber
      let localSnapshotId: string

      beforeEach(async () => {
        localSnapshotId = await provider.send('evm_snapshot', [])

        await swapTokens(
          MAINNET_ADDRESSES.ETH,
          MAINNET_ADDRESSES.MCD_DAI,
          amountToWei(10).toFixed(0),
          amountWithFeeInWei.toFixed(0),
          address,
          provider,
          signer,
        )

        initialDaiWalletBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, address)
        deficitAmount = new BigNumber(10)
        lessThanTheTransferAmount = amountWithFeeInWei.minus(deficitAmount)

        await DAI.approve(exchange.address, lessThanTheTransferAmount.toFixed(0))
      })

      afterEach(async () => {
        await provider.send('evm_revert', [localSnapshotId])
      })

      it('should throw an error and not exchange anything', async () => {
        const tx = exchange.swapDaiForToken(
          MAINNET_ADDRESSES.ETH,
          amountWithFeeInWei.toFixed(0),
          receiveAtLeastInWei.toFixed(0),
          to,
          data,
          {
            value: 0,
            gasLimit: 2500000,
          },
        )
        await expect(tx).to.be.revertedWith('Exchange / Not enought allowance')
      })
    })
  })
})
