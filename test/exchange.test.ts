import { ethers } from 'hardhat'
import BigNumber from 'bignumber.js'
import { expect } from 'chai'
import { JsonRpcProvider } from '@ethersproject/providers'
import { Contract, Signer } from 'ethers'
import { init, FEE, FEE_BASE, ONE, swapTokens } from './common/mcd-deployment-utils'
import {
  addressRegistryFactory,
  amountFromWei,
  amountToWei,
} from './common/params-calculation-utils'
import { exchangeToDAI, exchangeFromDAI } from './common/http-apis'
import WETHABI from '../abi/IWETH.json'
import ERC20ABI from '../abi/IERC20.json'
import MAINNET_ADDRESSES from '../addresses/mainnet.json'
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
  // TODO:
  let slippage: ReturnType<typeof asPercentageValue>
  let fee: ReturnType<typeof asPercentageValue>
  let snapshotId: string

  before(async () => {
    ;[provider, signer] = await init({ provider, signer })
    address = await signer.getAddress()

    feeBeneficiary = addressRegistryFactory('', '').feeRecepient // TODO:
    slippage = asPercentageValue(8, 100)
    fee = asPercentageValue(FEE, FEE_BASE)

    const exchangeFactory = await ethers.getContractFactory('Exchange', signer)
    exchange = await exchangeFactory.deploy(address, feeBeneficiary, fee.value.toFixed())

    await exchange.deployed()

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
    expectToBeEqual(exchangeFee, fee.value)
  })

  it('should have fee beneficiary address set', async () => {
    const exchangeFeeBeneficiary = await exchange.feeBeneficiaryAddress()
    expectToBeEqual(exchangeFeeBeneficiary, feeBeneficiary)
  })

  it('should have a whitelisted caller set', async () => {
    expect(await exchange.WHITELISTED_CALLERS(address)).to.be.true
  })

  it('should have new fee set', async () => {
    const currentFee = await exchange.fee()
    expectToBeEqual(currentFee, fee.value)

    const newFee = '3'
    await exchange.setFee(newFee)
    const exchangeFee = await exchange.fee()
    expectToBeEqual(exchangeFee, newFee)
  })

  it('should not allow unauthorized caller to update the fee', async () => {
    const tx = exchange.connect(provider.getSigner(1)).setFee('3')
    await expect(tx).to.be.revertedWith('Exchange / Unauthorized Caller')
  })

  it('should allow beneficiary to update the fee', async () => {
    const toTransferAmount = '0x' + new BigNumber(1).shiftedBy(18).toString(16)
    const tx0 = await signer.populateTransaction({ to: feeBeneficiary, value: toTransferAmount })
    await signer.sendTransaction(tx0)
    await provider.send('hardhat_impersonateAccount', [feeBeneficiary])
    const beneficiary = ethers.provider.getSigner(feeBeneficiary)
    await exchange.connect(beneficiary).setFee('3') // TODO:
  })

  describe('Asset for DAI', async () => {
    const amount = 10
    const amountInWei = amountToWei(amount)
    // let initialDaiWalletBalance: BigNumber
    let receiveAtLeastInWei: BigNumber
    let to: string
    let data: string

    before(async () => {
      // initialDaiWalletBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)

      const response = await exchangeToDAI(
        MAINNET_ADDRESSES.ETH,
        amountInWei.toFixed(0),
        exchange.address,
        slippage.value.toFixed(),
        ALLOWED_PROTOCOLS,
      )
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

    describe('when transferring an exact amount to the exchange', async () => {
      let localSnapshotId: string
      let initialWethWalletBalance: BigNumber

      beforeEach(async () => {
        localSnapshotId = await provider.send('evm_snapshot', [])

        await WETH.deposit({
          value: amountToWei(1000).toFixed(0),
        })

        initialWethWalletBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)

        await WETH.approve(exchange.address, amountInWei.toFixed())

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

      it(`should receive at least amount specified in receiveAtLeast`, async () => {
        const [wethBalance, daiBalance] = await Promise.all([
          balanceOf(MAINNET_ADDRESSES.ETH, address),
          balanceOf(MAINNET_ADDRESSES.MCD_DAI, address),
        ])

        expectToBeEqual(wethBalance, initialWethWalletBalance.minus(amountToWei(amount)))
        expectToBe(daiBalance, 'gte', receiveAtLeastInWei)
      })

      it('should not have Asset amount left in the exchange', async () => {
        const exchangeWethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, exchange.address)
        const wethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)

        expectToBeEqual(wethBalance, initialWethWalletBalance.minus(amountToWei(amount)))
        expectToBeEqual(exchangeWethBalance, 0)
      })

      it('should not have DAI amount left in the exchange', async () => {
        const exchangeDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, exchange.address)
        expectToBeEqual(exchangeDaiBalance, 0)
      })

      it('should have collected fee', async () => {
        const walletDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, address)
        const beneficiaryDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, feeBeneficiary)

        // TODO:
        console.log('>>>>>>>> ', fee.asDecimal.toFixed(), (await exchange.fee()).toString())

        const expectedCollectedFee = amountFromWei(walletDaiBalance)
          .div(new BigNumber(1).minus(fee.asDecimal))
          .decimalPlaces(0)
          .times(fee.asDecimal)

        expectToBeEqual(amountFromWei(beneficiaryDaiBalance), expectedCollectedFee, 6)
      })
    })

    describe('when transferring more amount to the exchange', async () => {
      let initialWethWalletBalance: BigNumber
      let moreThanTheTransferAmount: BigNumber
      let localSnapshotId: string

      beforeEach(async () => {
        localSnapshotId = await provider.send('evm_snapshot', [])

        await WETH.deposit({
          value: amountToWei(1000).toFixed(0),
        })

        initialWethWalletBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)
        moreThanTheTransferAmount = amountInWei.plus(amountToWei(10))

        await WETH.approve(exchange.address, moreThanTheTransferAmount.toFixed(0))
        await exchange.swapTokenForDai(
          MAINNET_ADDRESSES.ETH,
          moreThanTheTransferAmount.toFixed(0),
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

        expectToBeEqual(wethBalance, initialWethWalletBalance.minus(amountInWei))
        expectToBe(daiBalance, 'gte', receiveAtLeastInWei)
      })

      it('should not have Asset amount left in the exchange', async () => {
        const exchangeWethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, exchange.address)
        const wethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)

        expectToBeEqual(exchangeWethBalance, 0)
        expectToBeEqual(wethBalance, initialWethWalletBalance.minus(amountInWei))
      })

      it('should not have DAI amount left in the exchange', async () => {
        const exchangeDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, exchange.address)
        expectToBeEqual(exchangeDaiBalance, 0)
      })

      it('should have collected fee', async () => {
        const walletDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, address)
        const beneficiaryDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, feeBeneficiary)

        const expectedCollectedFee = amountFromWei(walletDaiBalance)
          .div(ONE.minus(fee.asDecimal))
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
        lessThanTheTransferAmount = amountInWei.minus(amountToWei(5))

        await WETH.approve(exchange.address, lessThanTheTransferAmount.toFixed(0))
      })

      afterEach(async () => {
        await provider.send('evm_revert', [localSnapshotId])
      })

      it('should throw an error and not exchange anything', async () => {
        const tx = exchange.swapTokenForDai(
          MAINNET_ADDRESSES.ETH,
          lessThanTheTransferAmount.toFixed(0),
          receiveAtLeastInWei.toFixed(0),
          to,
          data,
          {
            value: 0,
            gasLimit: 2500000,
          },
        )

        console.log('BEFORE REVERT')
        await expect(tx).to.be.revertedWith('Exchange / Could not swap')
        console.log('AFTER REVERT')

        const wethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)
        const daiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, address)

        console.log('>>>>>', wethBalance.toFixed(0), initialWethWalletBalance.toFixed(0))
        console.log('>>>>>', daiBalance.toFixed(0))

        expectToBeEqual(wethBalance, initialWethWalletBalance)
        expectToBeEqual(daiBalance, 0)
      })

      it('should not have Asset amount left in the exchange', async () => {
        const exchangeWethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, exchange.address)
        const wethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)

        expectToBeEqual(exchangeWethBalance, 0)
        expectToBeEqual(wethBalance, initialWethWalletBalance)
      })

      it('should not have DAI amount left in the exchange', async () => {
        const exchangeDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, exchange.address)
        expectToBeEqual(exchangeDaiBalance, 0)
      })
    })

    describe('when sending some token amount in advance to the exchange', async () => {
      let localSnapshotId: string

      beforeEach(async () => {
        localSnapshotId = await provider.send('evm_snapshot', [])

        await WETH.deposit({
          value: amountToWei(1000).toFixed(0),
        })

        await WETH.approve(exchange.address, amountInWei.toFixed(0))
      })

      afterEach(async () => {
        await provider.send('evm_revert', [localSnapshotId])
      })

      it('should transfer everything to the caller if the surplus is the same as the fromToken', async () => {
        const otherWallet = provider.getSigner(1)
        const transferredAmount = amountToWei(1)
        const initialWethWalletBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)

        await WETH.connect(otherWallet).deposit({
          value: amountToWei(1).toFixed(0),
        })
        await WETH.connect(otherWallet).transfer(exchange.address, transferredAmount.toFixed(0))
        const exchangeWethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, exchange.address)
        expectToBeEqual(exchangeWethBalance, transferredAmount)

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

        const walletWethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)
        expectToBeEqual(
          walletWethBalance,
          initialWethWalletBalance.minus(amountInWei).plus(transferredAmount),
        )
      })

      it('should transfer everything to the caller if there is a surplus of DAI ', async () => {
        const otherWallet = provider.getSigner(1)
        const otherWalletAddress = await otherWallet.getAddress()
        const amount = amountToWei(1)

        await swapTokens(
          MAINNET_ADDRESSES.ETH,
          MAINNET_ADDRESSES.MCD_DAI,
          amount.toFixed(0), // swapping 1 ETH
          amount.toFixed(0), // expecting at least 1 DAI
          otherWalletAddress,
          provider,
          otherWallet,
        )

        const otherWalletDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, otherWalletAddress)
        expectToBe(amountFromWei(otherWalletDaiBalance), 'gte', 1)

        await DAI.connect(otherWallet).transfer(exchange.address, amount.toFixed(0))
        let exchangeDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, exchange.address)
        expectToBeEqual(exchangeDaiBalance, amount, 0)

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

        // This assertion basically asserts the funds that were pre-deposit are not left within the exchange
        // This DOES NOT test if the fund were actually sent to the caller. There is no way to do that with current design
        exchangeDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, exchange.address)
        expectToBeEqual(exchangeDaiBalance, 0)
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
        slippage.value.toFixed(),
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

      it('should not have Asset amount left in the exchange', async () => {
        const exchangeWethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, exchange.address)
        expectToBeEqual(exchangeWethBalance, 0)
      })

      it('should not have DAI amount left in the exchange', async () => {
        const exchangeDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, exchange.address)
        expectToBeEqual(exchangeDaiBalance, 0)
      })

      it('should have collected fee', async () => {
        const beneficiaryDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, feeBeneficiary)
        const expectedCollectedFee = amountWithFeeInWei.times(fee.asDecimal)
        expectToBeEqual(beneficiaryDaiBalance, expectedCollectedFee, 0)
      })
    })

    describe('when transferring more amount to the exchange', async () => {
      let initialDaiWalletBalance: BigNumber
      let moreThanTheTransferAmount: BigNumber
      let surplusAmount: BigNumber
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
        surplusAmount = new BigNumber(10)
        moreThanTheTransferAmount = amountWithFeeInWei.plus(amountToWei(surplusAmount))

        await DAI.approve(exchange.address, moreThanTheTransferAmount.toFixed(0))

        await exchange.swapDaiForToken(
          MAINNET_ADDRESSES.ETH,
          moreThanTheTransferAmount.toFixed(0),
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

      it('should exchange all needed amount and return the surplus', async () => {
        const wethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)
        const daiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, address)

        const surplusFee = amountToWei(surplusAmount.times(fee.asDecimal))

        expectToBeEqual(
          daiBalance,
          initialDaiWalletBalance.minus(amountWithFeeInWei).minus(surplusFee),
          0,
        )
        expectToBe(wethBalance, 'gte', receiveAtLeastInWei)
      })

      it('should not have Asset amount left in the exchange', async () => {
        const exchangeWethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, exchange.address)
        expectToBeEqual(exchangeWethBalance, 0)
      })

      it('should not have DAI amount left in the exchange', async () => {
        const exchangeDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, exchange.address)
        expectToBeEqual(exchangeDaiBalance, 0)
      })

      it('should have collected fee', async () => {
        const beneficiaryDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, feeBeneficiary)

        const surplusFee = amountToWei(surplusAmount.times(fee.asDecimal))
        const expectedCollectedFee = amountWithFeeInWei.times(fee.asDecimal)
        expectToBeEqual(beneficiaryDaiBalance, expectedCollectedFee.plus(surplusFee), 0)
      })
    })

    describe('when transferring less amount to the exchange', async () => {
      let initialDaiWalletBalance: BigNumber
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
        lessThanTheTransferAmount = new BigNumber(amountWithFeeInWei).minus(
          amountToWei(deficitAmount),
        )

        await DAI.approve(exchange.address, amountWithFeeInWei.toFixed(0))
      })

      afterEach(async () => {
        await provider.send('evm_revert', [localSnapshotId])
      })

      it('should throw an error and not exchange anything', async () => {
        const tx = exchange.swapDaiForToken(
          MAINNET_ADDRESSES.ETH,
          lessThanTheTransferAmount.toFixed(0),
          receiveAtLeastInWei.toFixed(0),
          to,
          data,
          {
            value: 0,
            gasLimit: 2500000,
          },
        )
        await expect(tx).to.be.revertedWith('Exchange / Could not swap')
        const wethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)
        const daiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, address)

        expectToBeEqual(daiBalance, initialDaiWalletBalance)
        expectToBeEqual(wethBalance, 0)
      })

      it('should not have Asset amount left in the exchange', async () => {
        const exchangeWethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, exchange.address)
        expectToBeEqual(exchangeWethBalance, 0)
      })

      it('should not have DAI amount left in the exchange', async () => {
        const exchangeDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, exchange.address)
        expectToBeEqual(exchangeDaiBalance, 0)
      })
    })

    describe('when sending some token amount in advance to the exchange', async () => {
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

        await DAI.approve(exchange.address, amountWithFeeInWei.toFixed(0))
      })

      afterEach(async () => {
        await provider.send('evm_revert', [localSnapshotId])
      })

      it('should transfer everything to the caller if the surplus is the same as the fromToken', async () => {
        const otherWallet = provider.getSigner(1)
        const transferredAmount = amountToWei(1)
        const initialWethWalletBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)
        const temporarySnapshot = await provider.send('evm_snapshot', [])

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

        const currentWethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)

        await provider.send('evm_revert', [temporarySnapshot])

        await WETH.connect(otherWallet).deposit({
          value: amountToWei(1).toFixed(0),
        })

        await WETH.connect(otherWallet).transfer(exchange.address, transferredAmount.toFixed(0))
        const exchangeWethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, exchange.address)
        expectToBeEqual(exchangeWethBalance, transferredAmount)

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

        const wethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)
        const expectedWethBalance = initialWethWalletBalance
          .plus(currentWethBalance)
          .plus(transferredAmount)
        expectToBeEqual(wethBalance, expectedWethBalance)
      })

      it('should transfer everything to the caller if there is a surplus of DAI ', async () => {
        const otherWallet = provider.getSigner(1)
        const otherWalletAddress = await otherWallet.getAddress()
        const amount = amountToWei(ONE)

        await swapTokens(
          MAINNET_ADDRESSES.ETH,
          MAINNET_ADDRESSES.MCD_DAI,
          amount.toFixed(0), // swapping 1 ETH
          amount.toFixed(0), // expecting at least 1 DAI
          otherWalletAddress,
          provider,
          otherWallet,
        )

        const walletDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, address)
        const otherWalletDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, otherWalletAddress)
        expectToBe(amountFromWei(otherWalletDaiBalance), 'gte', 1)

        await DAI.connect(otherWallet).transfer(exchange.address, amount.toFixed(0))
        const exchangeDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, exchange.address)
        expectToBeEqual(exchangeDaiBalance, amount, 0)

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

        const currentDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, address)
        const expectedDaiBalance = walletDaiBalance.minus(amountWithFeeInWei).plus(amountToWei(1))
        expectToBeEqual(currentDaiBalance, expectedDaiBalance, 0)
      })
    })
  })

  describe('Asset for DAI without proper call parameters', async () => {
    const balance = amountToWei(1000)
    let localSnapshotId: string

    beforeEach(async () => {
      localSnapshotId = await provider.send('evm_snapshot', [])

      await WETH.deposit({
        value: balance.toFixed(0),
      })
    })

    afterEach(async () => {
      const wethBalance = await balanceOf(MAINNET_ADDRESSES.ETH, address)
      expectToBeEqual(wethBalance, balance)
      await provider.send('evm_revert', [localSnapshotId])
    })

    it('should not have allowance set', async () => {
      const amountInWei = amountToWei(10)
      const receiveAtLeastInWeiAny = amountToWei(1)
      const data = 0

      const tx = exchange.swapTokenForDai(
        MAINNET_ADDRESSES.MCD_DAI,
        amountInWei.toFixed(0),
        receiveAtLeastInWeiAny.toFixed(0),
        AGGREGATOR_V3_ADDRESS,
        data,
        {
          value: 0,
          gasLimit: 2500000,
        },
      )
      await expect(tx).to.be.revertedWith('Exchange / Not enough allowance')
    })

    it('should not have received anything', async () => {
      const amountInWei = amountToWei(10)
      const receiveAtLeastInWeiAny = amountToWei(1)
      const randomAddress = '0xddD11F156bD353F110Ae11574Dc8f5E9f3cE9C7E'
      const data = 0

      await WETH.approve(exchange.address, amountInWei.toFixed(0))

      const tx = exchange.swapTokenForDai(
        MAINNET_ADDRESSES.ETH,
        amountInWei.toFixed(0),
        receiveAtLeastInWeiAny.toFixed(0),
        randomAddress,
        data,
        {
          value: 0,
          gasLimit: 2500000,
        },
      )

      await expect(tx).to.be.revertedWith('Exchange / Received less')
    })

    it('should end up with unsuccessful swap', async () => {
      const amountInWei = amountToWei(10)
      const receiveAtLeastInWeiAny = amountToWei(1)
      const data = 0

      await WETH.approve(exchange.address, amountInWei.toFixed(0))

      const tx = exchange.swapTokenForDai(
        MAINNET_ADDRESSES.ETH,
        amountInWei.toFixed(0),
        receiveAtLeastInWeiAny.toFixed(0),
        AGGREGATOR_V3_ADDRESS,
        data,
        {
          value: 0,
          gasLimit: 2500000,
        },
      )
      await expect(tx).to.be.revertedWith('Exchange / Could not swap')
    })

    it('should receive less', async () => {
      const amount = new BigNumber(10)
      const amountInWei = amountToWei(amount)
      const receiveAtLeast = amountToWei(100000)

      await WETH.approve(exchange.address, amountInWei.toFixed(0))

      const response = await exchangeToDAI(
        MAINNET_ADDRESSES.ETH,
        amountInWei.toFixed(0),
        exchange.address,
        slippage.value.toFixed(),
        ALLOWED_PROTOCOLS,
      )

      const tx = exchange.swapTokenForDai(
        MAINNET_ADDRESSES.ETH,
        amountInWei.toFixed(0),
        receiveAtLeast.toFixed(0),
        response.tx.to,
        response.tx.data,
      )
      await expect(tx).to.be.revertedWith('Exchange / Received less')
    })
  })

  describe('DAI for Asset without proper call parameters', async () => {
    let amountInWei: BigNumber
    let amountWithFeeInWei: BigNumber
    let daiBalance: BigNumber
    let localSnapshotId: string

    beforeEach(async () => {
      localSnapshotId = await provider.send('evm_snapshot', [])

      amountInWei = amountToWei(1000)
      amountWithFeeInWei = amountInWei.div(new BigNumber(1).minus(fee.asDecimal))

      await swapTokens(
        MAINNET_ADDRESSES.ETH,
        MAINNET_ADDRESSES.MCD_DAI,
        amountToWei(10).toFixed(0),
        amountWithFeeInWei.toFixed(0),
        address,
        provider,
        signer,
      )

      daiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, address)
    })

    afterEach(async () => {
      const currentDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, address)
      expectToBeEqual(currentDaiBalance, daiBalance)
      await provider.send('evm_revert', [localSnapshotId])
    })

    it('should not have allowance set', async () => {
      const receiveAtLeastInWeiAny = amountToWei(1)
      const data = 0

      const tx = exchange.swapDaiForToken(
        MAINNET_ADDRESSES.ETH,
        amountWithFeeInWei.toFixed(0),
        receiveAtLeastInWeiAny.toFixed(0),
        AGGREGATOR_V3_ADDRESS,
        data,
        {
          value: 0,
          gasLimit: 2500000,
        },
      )

      await expect(tx).to.be.revertedWith('Exchange / Not enough allowance')
    })

    it('should not have received anything', async () => {
      const receiveAtLeastInWeiAny = amountToWei(1)
      const randomAddress = '0xddD11F156bD353F110Ae11574Dc8f5E9f3cE9C7E'
      const data = 0

      await DAI.approve(exchange.address, amountWithFeeInWei.toFixed(0))

      const tx = exchange.swapDaiForToken(
        MAINNET_ADDRESSES.ETH,
        amountWithFeeInWei.toFixed(0),
        receiveAtLeastInWeiAny.toFixed(0),
        randomAddress,
        data,
        {
          value: 0,
          gasLimit: 2500000,
        },
      )

      await expect(tx).to.be.revertedWith('Exchange / Received less')
    })

    it('should end up with unsuccessful swap', async () => {
      const receiveAtLeastInWeiAny = amountToWei(1)
      const data = 0

      await DAI.approve(exchange.address, amountWithFeeInWei.toFixed(0))

      const tx = exchange.swapDaiForToken(
        MAINNET_ADDRESSES.ETH,
        amountWithFeeInWei.toFixed(0),
        receiveAtLeastInWeiAny.toFixed(0),
        AGGREGATOR_V3_ADDRESS,
        data,
        {
          value: 0,
          gasLimit: 2500000,
        },
      )
      await expect(tx).to.be.revertedWith('Exchange / Could not swap')
    })

    it('should receive less', async () => {
      const receiveAtLeast = amountToWei(100000)

      await DAI.approve(exchange.address, amountWithFeeInWei.toFixed(0))

      const response = await exchangeFromDAI(
        MAINNET_ADDRESSES.ETH,
        amountInWei.toFixed(0),
        slippage.value.toFixed(),
        exchange.address,
        ALLOWED_PROTOCOLS,
      )

      const tx = exchange.swapDaiForToken(
        MAINNET_ADDRESSES.ETH,
        amountWithFeeInWei.toFixed(0),
        receiveAtLeast.toFixed(0),
        response.tx.to,
        response.tx.data,
      )

      await expect(tx).to.be.revertedWith('Exchange / Received less')
    })
  })

  describe('Asset with different precision and no fully ERC20 compliant for DAI', () => {
    let initialUSDTBalanceInWei: BigNumber
    let receiveAtLeastInWei: BigNumber
    let to: string
    let data: string
    let localSnapshotId: string

    before(async () => {
      localSnapshotId = await provider.send('evm_snapshot', [])

      await swapTokens(
        MAINNET_ADDRESSES.ETH,
        MAINNET_ADDRESSES.USDT,
        amountToWei(1).toFixed(0),
        amountToWei(100, 6).toFixed(0),
        address,
        provider,
        signer,
      )

      initialUSDTBalanceInWei = await balanceOf(MAINNET_ADDRESSES.USDT, address)

      const USDT = new ethers.Contract(MAINNET_ADDRESSES.USDT, ERC20ABI, provider).connect(signer)
      await USDT.approve(exchange.address, initialUSDTBalanceInWei.toFixed(0))

      const response = await exchangeToDAI(
        MAINNET_ADDRESSES.USDT,
        initialUSDTBalanceInWei.toFixed(0),
        exchange.address,
        slippage.value.toFixed(),
        ['UNISWAP_V2'],
      )

      to = response.tx.to
      data = response.tx.data

      // TODO: fix shit like this
      const receiveAtLeast = amountFromWei(response.toTokenAmount).times(
        new BigNumber(1).minus(slippage.asDecimal),
      )
      receiveAtLeastInWei = amountToWei(receiveAtLeast)
    })

    after(async () => {
      await provider.send('evm_revert', [localSnapshotId])
    })

    it(`should exchange to at least amount specified in receiveAtLeast`, async () => {
      await exchange.swapTokenForDai(
        MAINNET_ADDRESSES.USDT,
        initialUSDTBalanceInWei.toFixed(0),
        receiveAtLeastInWei.toFixed(0),
        to,
        data,
        {
          value: 0,
          gasLimit: 2500000,
        },
      )

      const currentUSDTBalance = await balanceOf(MAINNET_ADDRESSES.USDT, address)
      const currentDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, address)

      expectToBeEqual(currentUSDTBalance, 0)
      expectToBe(currentDaiBalance, 'gte', receiveAtLeastInWei)
    })
  })

  describe('DAI for Asset with different precision and no fully ERC20 compliant', () => {
    let daiBalanceInWei: BigNumber
    let amountWithFeeInWei: BigNumber
    let receiveAtLeastInWei: BigNumber
    let to: string
    let data: string
    let localSnapshotId: string

    before(async () => {
      localSnapshotId = await provider.send('evm_snapshot', [])
      const amountInWei = amountToWei(1000)
      amountWithFeeInWei = amountInWei.div(new BigNumber(1).minus(fee.asDecimal))

      await swapTokens(
        MAINNET_ADDRESSES.ETH,
        MAINNET_ADDRESSES.MCD_DAI,
        amountToWei(10).toFixed(0),
        amountWithFeeInWei.toFixed(0),
        address,
        provider,
        signer,
      )

      daiBalanceInWei = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, address)

      const response = await exchangeFromDAI(
        MAINNET_ADDRESSES.USDT,
        amountInWei.toFixed(0),
        slippage.value.toFixed(),
        exchange.address,
        ['UNISWAP_V2'],
      )

      to = response.tx.to
      data = response.tx.data

      const receiveAtLeast = amountFromWei(response.toTokenAmount, 6).times(
        new BigNumber(1).minus(slippage.asDecimal),
      )
      receiveAtLeastInWei = amountToWei(receiveAtLeast, 6)
    })

    after(async () => {
      await provider.send('evm_revert', [localSnapshotId])
    })

    it(`should exchange to at least amount specified in receiveAtLeast`, async () => {
      await DAI.approve(exchange.address, amountWithFeeInWei.toFixed(0))
      await exchange.swapDaiForToken(
        MAINNET_ADDRESSES.USDT,
        amountWithFeeInWei.toFixed(0),
        receiveAtLeastInWei.toFixed(0),
        to,
        data,
        {
          value: 0,
          gasLimit: 2500000,
        },
      )

      const currentUSDTBalance = amountFromWei(await balanceOf(MAINNET_ADDRESSES.USDT, address), 6)
      const currentDaiBalance = await balanceOf(MAINNET_ADDRESSES.MCD_DAI, address)

      expectToBeEqual(currentDaiBalance, daiBalanceInWei.minus(amountWithFeeInWei), 0)
      expectToBe(currentUSDTBalance, 'gte', amountFromWei(receiveAtLeastInWei, 6))
    })
  })
})
