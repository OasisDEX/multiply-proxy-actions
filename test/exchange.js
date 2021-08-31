const {
  init,
  balanceOf,
  MAINNET_ADRESSES,
  addressRegistryFactory,
  FEE,
  FEE_BASE,
  ONE,
  swapTokens,
} = require('./common/mcd-deployment-utils')
const { expect } = require('chai')
const {
  amountFromWei,
  amountToWei,
  convertToBigNumber,
} = require('./common/params-calculation-utils')
const { exchangeToDAI, exchangeFromDAI } = require('./common/http_apis')
const wethAbi = require('../abi/IWETH.json')
const erc20Abi = require('../abi/IERC20.json')
const BigNumber = require('bignumber.js')
const { zero } = require('./utils')
const _ = require('lodash')

const AGGREGATOR_V3_ADDRESS = '0x11111112542d85b3ef69ae05771c2dccff4faa26'

const ethers = hre.ethers
const ALLOWED_PROTOCOLS = ['UNISWAP_V2']

function asPercentageValue(value, base) {
  value = convertToBigNumber(value)

  return {
    get value() {
      return value
    },

    asDecimal: value.div(new BigNumber(base)),
  }
}

describe('Exchange', async function () {
  let provider, signer, address, exchange, WETH, DAI, feeBeneficiary, slippage, fee, snapshotId

  this.beforeAll(async function () {
    let [_provider, _signer] = await init(undefined, provider, signer)
    provider = _provider
    signer = _signer
    address = await signer.getAddress()

    feeBeneficiary = addressRegistryFactory(undefined, undefined).feeRecepient
    slippage = asPercentageValue(8, 100)
    fee = asPercentageValue(FEE, FEE_BASE)

    const Exchange = await ethers.getContractFactory('Exchange', signer)
    exchange = await Exchange.deploy(address, feeBeneficiary, fee.value.toString())
    await exchange.deployed()

    WETH = new ethers.Contract(MAINNET_ADRESSES.ETH, wethAbi, provider).connect(signer)
    DAI = new ethers.Contract(MAINNET_ADRESSES.MCD_DAI, erc20Abi, provider).connect(signer)
  })

  this.beforeEach(async function () {
    snapshotId = await provider.send('evm_snapshot', [])
  })

  this.afterEach(async function () {
    await provider.send('evm_revert', [snapshotId])
  })

  it('should have fee set', async function () {
    const exchangeFee = await exchange.fee()
    expect(exchangeFee.toString()).to.be.eq(fee.value.toString())
  })

  it('should have fee beneficiary address set', async function () {
    const exchangeFeeBeneficiary = await exchange.feeBeneficiaryAddress()
    expect(exchangeFeeBeneficiary).to.be.eq(feeBeneficiary)
  })

  it('should have a whitelisted caller set', async function () {
    expect(await exchange.WHITELISTED_CALLERS(address)).to.be.true
  })

  it('should have new fee set', async function () {
    let exchangeFee = await exchange.fee()
    expect(exchangeFee.toString()).to.be.eq(fee.value.toString())

    const newFee = '3'

    await exchange.setFee(newFee)
    exchangeFee = await exchange.fee()
    expect(exchangeFee.toString()).to.be.eq(newFee)
  })

  it('should not allow unauthorized caller to update the fee', async function () {
    let tx = exchange.connect(provider.getSigner(1)).setFee('3')
    await expect(tx).to.revertedWith('Exchange / Unauthorized Caller')
  })

  it('should allow beneficiary to update the fee', async function () {
    const toTransferAmount = '0x' + amountToWei(1, 18).toString(16)
    let tx0 = await signer.populateTransaction({ to: feeBeneficiary, value: toTransferAmount })
    await signer.sendTransaction(tx0)
    await provider.send('hardhat_impersonateAccount', [feeBeneficiary])
    const benef = await ethers.provider.getSigner(feeBeneficiary)
    let tx = await exchange.connect(benef).setFee('3')
  })

  describe('Asset for DAI', async function () {
    const amount = new BigNumber(10)
    const amountInWei = amountToWei(amount).toFixed(0)
    let receiveAtLeastInWei
    let to, data

    this.beforeAll(async function () {
      const response = await exchangeToDAI(
        MAINNET_ADRESSES.ETH,
        amountInWei,
        exchange.address,
        slippage.value.toString(),
        ALLOWED_PROTOCOLS,
      )
      initialDaiWalletBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address))

      const {
        toTokenAmount,
        tx: { to: _to, data: _data },
      } = response
      to = _to
      data = _data

      const receiveAtLeast = new BigNumber(amountFromWei(toTokenAmount)).times(
        ONE.minus(slippage.asDecimal),
      )
      receiveAtLeastInWei = amountToWei(receiveAtLeast).toFixed(0)
    })

    this.afterEach(async function () {
      await provider.send('evm_revert', [snapshotId])
    })

    //skip due to requirements change, removing isAuthorised from swaps
    it.skip('should not happen if it is triggered from unauthorized caller', async () => {
      let tx = exchange
        .connect(provider.getSigner(1))
        .swapTokenForDai(
          MAINNET_ADRESSES.ETH,
          amountToWei(1).toFixed(0),
          amountFromWei(1).toFixed(0),
          AGGREGATOR_V3_ADDRESS,
          0,
        )
      await expect(tx).to.revertedWith('Exchange / Unauthorized Caller')
    })

    describe('when transferring an exact amount to the exchange', async function () {
      let localSnapshotId, initialWethWalletBalance

      this.beforeEach(async function () {
        localSnapshotId = await provider.send('evm_snapshot', [])

        await WETH.deposit({
          value: amountToWei(1000).toFixed(0),
        })

        initialWethWalletBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.ETH, address),
        )

        await WETH.approve(exchange.address, amountInWei)

        await exchange.swapTokenForDai(
          MAINNET_ADRESSES.ETH,
          amountInWei,
          receiveAtLeastInWei,
          to,
          data,
          {
            value: 0,
            gasLimit: 2500000,
          },
        )
      })

      this.afterEach(async function () {
        await provider.send('evm_revert', [localSnapshotId])
      })

      it(`should receive at least amount specified in receiveAtLeast`, async function () {
        const wethBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address))
        const daiBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.MCD_DAI, address))

        expect(wethBalance.toString()).to.equals(
          initialWethWalletBalance.minus(amountToWei(amount)).toString(),
        )
        expect(daiBalance.gte(convertToBigNumber(receiveAtLeastInWei))).to.be.true
      })

      it('should not have Asset amount left in the exchange', async function () {
        const exchangeWethBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.ETH, exchange.address),
        )
        const wethBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address))

        expect(wethBalance.toString()).to.equals(
          initialWethWalletBalance.minus(amountToWei(amount)).toString(),
        )
        expect(exchangeWethBalance.toString()).to.equals(zero.toString())
      })

      it('should not have DAI amount left in the exchange', async function () {
        const exchangeDaiBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, exchange.address),
        )

        expect(exchangeDaiBalance.toString()).to.equals(zero.toString())
      })

      it('should have collected fee', async function () {
        const walletDaiBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, address),
        )
        const beneficiaryDaiBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, feeBeneficiary),
        )

        const expectedCollectedFee = amountFromWei(walletDaiBalance)
          .div(ONE.minus(fee.asDecimal))
          .times(fee.asDecimal)
        expect(amountFromWei(beneficiaryDaiBalance).toFixed(6)).to.be.eq(
          expectedCollectedFee.toFixed(6),
        )
      })
    })

    describe('when transferring more amount to the exchange', async function () {
      let initialWethWalletBalance, moreThanTheTransferAmount, localSnapshotId

      this.beforeEach(async function () {
        localSnapshotId = await provider.send('evm_snapshot', [])

        await WETH.deposit({
          value: amountToWei(1000).toFixed(0),
        })

        initialWethWalletBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.ETH, address),
        )
        moreThanTheTransferAmount = convertToBigNumber(amountInWei).plus(amountToWei(10)).toFixed(0)

        await WETH.approve(exchange.address, moreThanTheTransferAmount)
        await exchange.swapTokenForDai(
          MAINNET_ADRESSES.ETH,
          moreThanTheTransferAmount,
          receiveAtLeastInWei,
          to,
          data,
          {
            value: 0,
            gasLimit: 2500000,
          },
        )
      })

      this.afterEach(async function () {
        await provider.send('evm_revert', [localSnapshotId])
      })

      it(`should receive at least amount specified in receiveAtLeast`, async function () {
        const wethBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address))
        const daiBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.MCD_DAI, address))

        expect(wethBalance.toString()).to.equals(
          initialWethWalletBalance.minus(amountInWei).toString(),
        )
        expect(daiBalance.gte(convertToBigNumber(receiveAtLeastInWei))).to.be.true
      })

      it('should not have Asset amount left in the exchange', async function () {
        const exchangeWethBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.ETH, exchange.address),
        )
        const wethBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address))

        expect(exchangeWethBalance.toString()).to.equals(zero.toString())
        expect(wethBalance.toString()).to.equals(
          initialWethWalletBalance.minus(amountInWei).toString(),
        )
      })

      it('should not have DAI amount left in the exchange', async function () {
        const exchangeDaiBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, exchange.address),
        )

        expect(exchangeDaiBalance.toString()).to.equals(zero.toString())
      })

      it('should have collected fee', async function () {
        const walletDaiBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, address),
        )
        const beneficiaryDaiBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, feeBeneficiary),
        )

        const expectedCollectedFee = amountFromWei(walletDaiBalance)
          .div(ONE.minus(fee.asDecimal))
          .times(fee.asDecimal)
        expect(amountFromWei(beneficiaryDaiBalance).toFixed(6)).to.be.eq(
          expectedCollectedFee.toFixed(6),
        )
      })
    })

    describe('when transferring less amount to the exchange', async function () {
      let initialWethWalletBalance, lessThanTheTransferAmount, localSnapshotId

      this.beforeEach(async function () {
        localSnapshotId = await provider.send('evm_snapshot', [])

        await WETH.deposit({
          value: amountToWei(1000).toFixed(0),
        })

        initialWethWalletBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.ETH, address),
        )
        lessThanTheTransferAmount = convertToBigNumber(amountInWei).minus(amountToWei(5)).toFixed(0)

        await WETH.approve(exchange.address, lessThanTheTransferAmount)
      })

      this.afterEach(async function () {
        await provider.send('evm_revert', [localSnapshotId])
      })

      it('should throw an error and not exchange anything', async function () {
        let tx = exchange.swapTokenForDai(
          MAINNET_ADRESSES.ETH,
          lessThanTheTransferAmount,
          receiveAtLeastInWei,
          to,
          data,
          {
            value: 0,
            gasLimit: 2500000,
          },
        )
        await expect(tx).to.revertedWith('Exchange / Could not swap')

        const wethBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address))
        const daiBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.MCD_DAI, address))

        expect(wethBalance.toString()).to.equals(initialWethWalletBalance.toString())
        expect(daiBalance.toString()).to.be.eq('0')
      })

      it('should not have Asset amount left in the exchange', async function () {
        const exchangeWethBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.ETH, exchange.address),
        )
        const wethBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address))

        expect(exchangeWethBalance.toString()).to.equals(zero.toString())
        expect(wethBalance.toString()).to.equals(initialWethWalletBalance.toString())
      })

      it('should not have DAI amount left in the exchange', async function () {
        const exchangeDaiBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, exchange.address),
        )

        expect(exchangeDaiBalance.toString()).to.equals(zero.toString())
      })
    })

    describe('when sending some token amount in advance to the exchange', async function () {
      let localSnapshotId

      this.beforeEach(async function () {
        localSnapshotId = await provider.send('evm_snapshot', [])

        await WETH.deposit({
          value: amountToWei(1000).toFixed(0),
        })

        await WETH.approve(exchange.address, amountInWei)
      })

      this.afterEach(async function () {
        await provider.send('evm_revert', [localSnapshotId])
      })

      it('should transfer everything to the caller if the surplus is the same as the fromToken', async function () {
        const otherWallet = await provider.getSigner(1)
        const transferredAmount = amountToWei(ONE).toFixed(0)
        const initialWethWalletBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.ETH, address),
        )

        await WETH.connect(otherWallet).deposit({
          value: amountToWei(1).toFixed(0),
        })
        await WETH.connect(otherWallet).transfer(exchange.address, transferredAmount)
        const exchangeWethBalance = await balanceOf(MAINNET_ADRESSES.ETH, exchange.address)
        expect(exchangeWethBalance.toString()).to.be.equal(transferredAmount.toString())

        await exchange.swapTokenForDai(
          MAINNET_ADRESSES.ETH,
          amountInWei,
          receiveAtLeastInWei,
          to,
          data,
          {
            value: 0,
            gasLimit: 2500000,
          },
        )

        const walletWethBalance = await balanceOf(MAINNET_ADRESSES.ETH, address)
        expect(walletWethBalance.toString()).to.be.equal(
          initialWethWalletBalance.minus(amountInWei).plus(transferredAmount).toString(),
        )
      })

      it('should transfer everything to the caller if there is a surplus of DAI ', async function () {
        const otherWallet = await provider.getSigner(1)
        const otherWalletAddress = await otherWallet.getAddress()
        const amount = amountToWei(ONE).toFixed(0)

        await swapTokens(
          MAINNET_ADRESSES.ETH,
          MAINNET_ADRESSES.MCD_DAI,
          amount, // swapping 1 ETH
          amount, // expecting at least 1 DAI
          otherWalletAddress,
          provider,
          otherWallet,
        )

        const otherWalletDaiBalance = await balanceOf(MAINNET_ADRESSES.MCD_DAI, otherWalletAddress)
        expect(
          amountFromWei(convertToBigNumber(otherWalletDaiBalance)).toNumber(),
        ).to.be.greaterThanOrEqual(ONE.toNumber())

        await DAI.connect(otherWallet).transfer(exchange.address, amount)
        let exchangeDaiBalance = await balanceOf(MAINNET_ADRESSES.MCD_DAI, exchange.address)
        expect(exchangeDaiBalance.toString()).to.be.equal(amount.toString())

        await exchange.swapTokenForDai(
          MAINNET_ADRESSES.ETH,
          amountInWei,
          receiveAtLeastInWei,
          to,
          data,
          {
            value: 0,
            gasLimit: 2500000,
          },
        )

        // This assertion basically asserts the funds that were pre-deposit are not left within the exchange
        // This DOES NOT test if the fund were actually sent to the caller. There is no way to do that with current design
        exchangeDaiBalance = await balanceOf(MAINNET_ADRESSES.MCD_DAI, exchange.address)
        expect(exchangeDaiBalance.toString()).to.be.equal(zero.toString())
      })
    })
  })

  describe('DAI for Asset', async function () {
    let initialDaiWalletBalance, amountWithFeeInWei

    this.beforeAll(async function () {
      const amountInWei = amountToWei(new BigNumber(1000))
      amountWithFeeInWei = amountInWei.div(ONE.minus(fee.asDecimal)).toFixed(0)

      const response = await exchangeFromDAI(
        MAINNET_ADRESSES.ETH,
        amountInWei.toFixed(0),
        slippage.value.toString(),
        exchange.address,
        ALLOWED_PROTOCOLS,
      )

      const {
        toTokenAmount,
        tx: { to: _to, data: _data },
      } = response
      to = _to
      data = _data

      const receiveAtLeast = new BigNumber(amountFromWei(toTokenAmount)).times(
        ONE.minus(slippage.asDecimal),
      )
      receiveAtLeastInWei = amountToWei(receiveAtLeast).toFixed(0)
    })
    //skip due to requirements change, removing isAuthorised from swaps
    it.skip('should not happen if it is triggered from unauthorized caller', async () => {
      let tx = exchange
        .connect(provider.getSigner(1))
        .swapDaiForToken(
          MAINNET_ADRESSES.ETH,
          amountToWei(1).toFixed(0),
          amountFromWei(1).toFixed(0),
          AGGREGATOR_V3_ADDRESS,
          0,
        )

      await expect(tx).to.revertedWith('Exchange / Unauthorized Caller')
    })

    describe('when transferring an exact amount to the exchange', async function () {
      let localSnapshotId

      this.beforeEach(async function () {
        localSnapshotId = await provider.send('evm_snapshot', [])

        await swapTokens(
          MAINNET_ADRESSES.ETH,
          MAINNET_ADRESSES.MCD_DAI,
          amountToWei(new BigNumber(10), 18).toFixed(0),
          amountWithFeeInWei,
          address,
          provider,
          signer,
        )

        initialDaiWalletBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, address),
        )

        await DAI.approve(exchange.address, amountWithFeeInWei)

        await exchange.swapDaiForToken(
          MAINNET_ADRESSES.ETH,
          amountWithFeeInWei,
          receiveAtLeastInWei,
          to,
          data,
          {
            value: 0,
            gasLimit: 2500000,
          },
        )
      })

      this.afterEach(async function () {
        await provider.send('evm_revert', [localSnapshotId])
      })

      it(`should receive at least amount specified in receiveAtLeast`, async function () {
        const wethBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address))
        const daiBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.MCD_DAI, address))

        expect(daiBalance.toString()).to.equals(
          initialDaiWalletBalance.minus(amountWithFeeInWei).toString(),
        )
        expect(wethBalance.gte(convertToBigNumber(receiveAtLeastInWei))).to.be.true
      })

      it('should not have Asset amount left in the exchange', async function () {
        const exchangeWethBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.ETH, exchange.address),
        )

        expect(exchangeWethBalance.toString()).to.equals(zero.toString())
      })

      it('should not have DAI amount left in the exchange', async function () {
        const exchangeDaiBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, exchange.address),
        )

        expect(exchangeDaiBalance.toString()).to.equals(zero.toString())
      })

      it('should have collected fee', async function () {
        const beneficiaryDaiBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, feeBeneficiary),
        )

        const expectedCollectedFee = convertToBigNumber(amountWithFeeInWei).times(fee.asDecimal)
        expect(beneficiaryDaiBalance.toFixed(0)).to.be.eq(expectedCollectedFee.toFixed(0))
      })
    })

    describe('when transferring more amount to the exchange', async function () {
      let initialDaiWalletBalance, moreThanTheTransferAmount, localSnapshotId, surplusAmount

      this.beforeEach(async function () {
        localSnapshotId = await provider.send('evm_snapshot', [])

        await swapTokens(
          MAINNET_ADRESSES.ETH,
          MAINNET_ADRESSES.MCD_DAI,
          amountToWei(new BigNumber(10), 18).toFixed(0),
          amountWithFeeInWei,
          address,
          provider,
          signer,
        )

        initialDaiWalletBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, address),
        )
        surplusAmount = new BigNumber(10)
        moreThanTheTransferAmount = convertToBigNumber(amountWithFeeInWei)
          .plus(amountToWei(surplusAmount))
          .toFixed(0)

        await DAI.approve(exchange.address, moreThanTheTransferAmount)

        await exchange.swapDaiForToken(
          MAINNET_ADRESSES.ETH,
          moreThanTheTransferAmount,
          receiveAtLeastInWei,
          to,
          data,
          {
            value: 0,
            gasLimit: 2500000,
          },
        )
      })

      this.afterEach(async function () {
        await provider.send('evm_revert', [localSnapshotId])
      })

      it('should exchange all needed amount and return the surplus', async function () {
        const wethBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address))
        const daiBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.MCD_DAI, address))

        const surplusFee = amountToWei(surplusAmount.times(fee.asDecimal))

        expect(daiBalance.toFixed(0)).to.equals(
          initialDaiWalletBalance.minus(amountWithFeeInWei).minus(surplusFee).toFixed(0),
        )
        expect(wethBalance.gte(convertToBigNumber(receiveAtLeastInWei))).to.be.true
      })

      it('should not have Asset amount left in the exchange', async function () {
        const exchangeWethBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.ETH, exchange.address),
        )

        expect(exchangeWethBalance.toString()).to.equals(zero.toString())
      })

      it('should not have DAI amount left in the exchange', async function () {
        const exchangeDaiBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, exchange.address),
        )

        expect(exchangeDaiBalance.toString()).to.equals(zero.toString())
      })

      it('should have collected fee', async function () {
        const beneficiaryDaiBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, feeBeneficiary),
        )

        const surplusFee = amountToWei(surplusAmount.times(fee.asDecimal))

        const expectedCollectedFee = convertToBigNumber(amountWithFeeInWei).times(fee.asDecimal)
        expect(beneficiaryDaiBalance.toFixed(0)).to.be.eq(
          expectedCollectedFee.plus(surplusFee).toFixed(0),
        )
      })
    })

    describe('when transferring less amount to the exchange', async function () {
      let initialDaiWalletBalance, lessThanTheTransferAmount, localSnapshotId, deficitAmount

      this.beforeEach(async function () {
        localSnapshotId = await provider.send('evm_snapshot', [])

        await swapTokens(
          MAINNET_ADRESSES.ETH,
          MAINNET_ADRESSES.MCD_DAI,
          amountToWei(new BigNumber(10), 18).toFixed(0),
          amountWithFeeInWei,
          address,
          provider,
          signer,
        )

        initialDaiWalletBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, address),
        )
        deficitAmount = new BigNumber(10)
        lessThanTheTransferAmount = convertToBigNumber(amountWithFeeInWei)
          .minus(amountToWei(deficitAmount))
          .toFixed(0)

        await DAI.approve(exchange.address, amountWithFeeInWei)
      })

      this.afterEach(async function () {
        await provider.send('evm_revert', [localSnapshotId])
      })

      it('should throw an error and not exchange anything', async function () {
        let tx = exchange.swapDaiForToken(
          MAINNET_ADRESSES.ETH,
          lessThanTheTransferAmount,
          receiveAtLeastInWei,
          to,
          data,
          {
            value: 0,
            gasLimit: 2500000,
          },
        )
        await expect(tx).to.revertedWith('Exchange / Could not swap')
        const wethBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address))
        const daiBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.MCD_DAI, address))

        expect(daiBalance.toString()).to.equals(initialDaiWalletBalance.toString())
        expect(wethBalance.toString()).to.be.eq('0')
      })

      it('should not have Asset amount left in the exchange', async function () {
        const exchangeWethBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.ETH, exchange.address),
        )

        expect(exchangeWethBalance.toString()).to.equals(zero.toString())
      })

      it('should not have DAI amount left in the exchange', async function () {
        const exchangeDaiBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, exchange.address),
        )

        expect(exchangeDaiBalance.toString()).to.equals(zero.toString())
      })
    })

    describe('when sending some token amount in advance to the exchange', async function () {
      let localSnapshotId

      this.beforeEach(async function () {
        localSnapshotId = await provider.send('evm_snapshot', [])

        await swapTokens(
          MAINNET_ADRESSES.ETH,
          MAINNET_ADRESSES.MCD_DAI,
          amountToWei(new BigNumber(10), 18).toFixed(0),
          amountWithFeeInWei,
          address,
          provider,
          signer,
        )

        await DAI.approve(exchange.address, amountWithFeeInWei)
      })

      this.afterEach(async function () {
        await provider.send('evm_revert', [localSnapshotId])
      })

      it('should transfer everything to the caller if the surplus is the same as the fromToken', async function () {
        const otherWallet = await provider.getSigner(1)
        const transferredAmount = amountToWei(ONE).toFixed(0)
        const initialWethWalletBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.ETH, address),
        )
        const temporarySnapshot = await provider.send('evm_snapshot', [])

        await exchange.swapDaiForToken(
          MAINNET_ADRESSES.ETH,
          amountWithFeeInWei,
          receiveAtLeastInWei,
          to,
          data,
          {
            value: 0,
            gasLimit: 2500000,
          },
        )

        let currentWethBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address))

        await provider.send('evm_revert', [temporarySnapshot])

        await WETH.connect(otherWallet).deposit({
          value: amountToWei(1).toFixed(0),
        })

        await WETH.connect(otherWallet).transfer(exchange.address, transferredAmount)
        const exchangeWethBalance = await balanceOf(MAINNET_ADRESSES.ETH, exchange.address)
        expect(exchangeWethBalance.toString()).to.be.equal(transferredAmount.toString())

        await exchange.swapDaiForToken(
          MAINNET_ADRESSES.ETH,
          amountWithFeeInWei,
          receiveAtLeastInWei,
          to,
          data,
          {
            value: 0,
            gasLimit: 2500000,
          },
        )

        let wethBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address))
        let expectedWethBalance = initialWethWalletBalance
          .plus(currentWethBalance)
          .plus(transferredAmount)
        expect(wethBalance.toFixed(0)).to.be.equal(expectedWethBalance.toFixed(0))
      })

      it('should transfer everything to the caller if there is a surplus of DAI ', async function () {
        const otherWallet = await provider.getSigner(1)
        const otherWalletAddress = await otherWallet.getAddress()
        const amount = amountToWei(ONE).toFixed(0)

        await swapTokens(
          MAINNET_ADRESSES.ETH,
          MAINNET_ADRESSES.MCD_DAI,
          amount, // swapping 1 ETH
          amount, // expecting at least 1 DAI
          otherWalletAddress,
          provider,
          otherWallet,
        )

        const walletDaiBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, address),
        )
        const otherWalletDaiBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, otherWalletAddress),
        )
        expect(amountFromWei(otherWalletDaiBalance).toNumber()).to.be.greaterThanOrEqual(
          ONE.toNumber(),
        )

        await DAI.connect(otherWallet).transfer(exchange.address, amount)
        let exchangeDaiBalance = await balanceOf(MAINNET_ADRESSES.MCD_DAI, exchange.address)
        expect(exchangeDaiBalance.toString()).to.be.equal(amount.toString())

        await exchange.swapDaiForToken(
          MAINNET_ADRESSES.ETH,
          amountWithFeeInWei,
          receiveAtLeastInWei,
          to,
          data,
          {
            value: 0,
            gasLimit: 2500000,
          },
        )

        const currentDaiBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, address),
        )
        const expectedDaiBalance = walletDaiBalance
          .minus(convertToBigNumber(amountWithFeeInWei))
          .plus(amountToWei(ONE))
        expect(currentDaiBalance.toFixed(0)).to.be.equal(expectedDaiBalance.toFixed(0))
      })
    })
  })

  describe('Asset for DAI without proper call parameters', async function () {
    let localSnapshotId
    let balance = amountToWei(1000).toFixed(0)

    this.beforeEach(async function () {
      localSnapshotId = await provider.send('evm_snapshot', [])

      await WETH.deposit({
        value: balance,
      })
    })

    this.afterEach(async function () {
      const wethBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address))
      expect(amountFromWei(wethBalance).toString()).to.be.equal(amountFromWei(balance).toString())
      await provider.send('evm_revert', [localSnapshotId])
    })

    it('should not have allowance set', async function () {
      const amountInWei = amountToWei(new BigNumber(10)).toFixed(0)
      const receiveAtLeastInWeiAny = amountToWei(ONE).toFixed(0)
      const data = 0

      let tx = exchange.swapTokenForDai(
        MAINNET_ADRESSES.MCD_DAI,
        amountInWei,
        receiveAtLeastInWeiAny,
        AGGREGATOR_V3_ADDRESS,
        data,
        {
          value: 0,
          gasLimit: 2500000,
        },
      )
      await expect(tx).to.revertedWith('Exchange / Not enough allowance')
    })

    it('should not have received anything', async function () {
      const amountInWei = amountToWei(new BigNumber(10)).toFixed(0)
      const receiveAtLeastInWeiAny = amountToWei(ONE).toFixed(0)
      const randomAddress = '0xddD11F156bD353F110Ae11574Dc8f5E9f3cE9C7E'
      const data = 0

      await WETH.approve(exchange.address, amountInWei)

      let tx = exchange.swapTokenForDai(
        MAINNET_ADRESSES.ETH,
        amountInWei,
        receiveAtLeastInWeiAny,
        randomAddress,
        data,
        {
          value: 0,
          gasLimit: 2500000,
        },
      )

      await expect(tx).to.revertedWith('Exchange / Received less')
    })

    it('should end up with unsuccessful swap', async function () {
      const amountInWei = amountToWei(new BigNumber(10)).toFixed(0)
      const receiveAtLeastInWeiAny = amountToWei(ONE).toFixed(0)
      const data = 0

      await WETH.approve(exchange.address, amountInWei)

      let tx = exchange.swapTokenForDai(
        MAINNET_ADRESSES.ETH,
        amountInWei,
        receiveAtLeastInWeiAny,
        AGGREGATOR_V3_ADDRESS,
        data,
        {
          value: 0,
          gasLimit: 2500000,
        },
      )
      await expect(tx).to.revertedWith('Exchange / Could not swap')
    })

    it('should receive less', async function () {
      const amount = new BigNumber(10)
      const amountInWei = amountToWei(amount).toFixed(0)
      const receiveAtLeast = amountToWei(100000).toFixed(0)

      await WETH.approve(exchange.address, amountInWei)

      const response = await exchangeToDAI(
        MAINNET_ADRESSES.ETH,
        amountInWei,
        exchange.address,
        slippage.value.toString(),
        ALLOWED_PROTOCOLS,
      )

      const {
        tx: { to, data },
      } = response

      let tx = exchange.swapTokenForDai(MAINNET_ADRESSES.ETH, amountInWei, receiveAtLeast, to, data)
      await expect(tx).to.revertedWith('Exchange / Received less')
    })
  })

  describe('DAI for Asset without proper call parameters', async function () {
    let localSnapshotId, amountInWei, amountWithFeeInWei, daiBalance
    this.beforeEach(async function () {
      localSnapshotId = await provider.send('evm_snapshot', [])

      amountInWei = amountToWei(new BigNumber(1000))
      amountWithFeeInWei = amountInWei.div(ONE.minus(fee.asDecimal)).toFixed(0)

      await swapTokens(
        MAINNET_ADRESSES.ETH,
        MAINNET_ADRESSES.MCD_DAI,
        amountToWei(new BigNumber(10), 18).toFixed(0),
        amountWithFeeInWei,
        address,
        provider,
        signer,
      )

      daiBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.MCD_DAI, address))
    })

    this.afterEach(async function () {
      const currentDaiBalance = convertToBigNumber(
        await balanceOf(MAINNET_ADRESSES.MCD_DAI, address),
      )
      expect(amountFromWei(currentDaiBalance).toString()).to.be.equal(
        amountFromWei(daiBalance).toString(),
      )
      await provider.send('evm_revert', [localSnapshotId])
    })

    it('should not have allowance set', async function () {
      const receiveAtLeastInWeiAny = amountToWei(ONE).toFixed(0)
      const data = 0

      let tx = exchange.swapDaiForToken(
        MAINNET_ADRESSES.ETH,
        amountWithFeeInWei,
        receiveAtLeastInWeiAny,
        AGGREGATOR_V3_ADDRESS,
        data,
        {
          value: 0,
          gasLimit: 2500000,
        },
      )

      await expect(tx).to.revertedWith('Exchange / Not enough allowance')
    })

    it('should not have received anything', async function () {
      const receiveAtLeastInWeiAny = amountToWei(ONE).toFixed(0)
      const randomAddress = '0xddD11F156bD353F110Ae11574Dc8f5E9f3cE9C7E'
      const data = 0

      await DAI.approve(exchange.address, amountWithFeeInWei)

      let tx = exchange.swapDaiForToken(
        MAINNET_ADRESSES.ETH,
        amountWithFeeInWei,
        receiveAtLeastInWeiAny,
        randomAddress,
        data,
        {
          value: 0,
          gasLimit: 2500000,
        },
      )

      await expect(tx).to.revertedWith('Exchange / Received less')
    })

    it('should end up with unsuccessful swap', async function () {
      const receiveAtLeastInWeiAny = amountToWei(ONE).toFixed(0)
      const data = 0

      await DAI.approve(exchange.address, amountWithFeeInWei)

      let tx = exchange.swapDaiForToken(
        MAINNET_ADRESSES.ETH,
        amountWithFeeInWei,
        receiveAtLeastInWeiAny,
        AGGREGATOR_V3_ADDRESS,
        data,
        {
          value: 0,
          gasLimit: 2500000,
        },
      )
      await expect(tx).to.revertedWith('Exchange / Could not swap')
    })

    it('should receive less', async function () {
      const receiveAtLeast = amountToWei(100000).toFixed(0)

      await DAI.approve(exchange.address, amountWithFeeInWei)

      const response = await exchangeFromDAI(
        MAINNET_ADRESSES.ETH,
        amountInWei.toFixed(0),
        slippage.value.toString(),
        exchange.address,
        ALLOWED_PROTOCOLS,
      )

      const {
        tx: { to, data },
      } = response

      let tx = exchange.swapDaiForToken(
        MAINNET_ADRESSES.ETH,
        amountWithFeeInWei,
        receiveAtLeast,
        to,
        data,
      )

      await expect(tx).to.revertedWith('Exchange / Received less')
    })
  })

  describe('Asset with different precision and no fully ERC20 compliant for DAI', function () {
    let initialUSDTBalanceInWei, to, data, receiveAtLeastInWei, localSnapshotId

    this.beforeAll(async function () {
      localSnapshotId = await provider.send('evm_snapshot', [])

      await swapTokens(
        MAINNET_ADRESSES.ETH,
        MAINNET_ADRESSES.USDT,
        amountToWei(ONE, 18).toFixed(0),
        amountToWei(new BigNumber(100), 6).toFixed(0),
        address,
        provider,
        signer,
      )

      initialUSDTBalanceInWei = convertToBigNumber(
        await balanceOf(MAINNET_ADRESSES.USDT, address),
      ).toFixed(0)

      const USDT = new ethers.Contract(MAINNET_ADRESSES.USDT, erc20Abi, provider).connect(signer)
      await USDT.approve(exchange.address, initialUSDTBalanceInWei)

      const response = await exchangeToDAI(
        MAINNET_ADRESSES.USDT,
        initialUSDTBalanceInWei,
        exchange.address,
        slippage.value.toString(),
        ['UNISWAP_V2'],
      )

      const {
        toTokenAmount,
        tx: { to: _to, data: _data },
      } = response
      to = _to
      data = _data

      const receiveAtLeast = new BigNumber(amountFromWei(toTokenAmount)).times(
        ONE.minus(slippage.asDecimal),
      )
      receiveAtLeastInWei = amountToWei(receiveAtLeast).toFixed(0)
    })

    this.afterAll(async function () {
      await provider.send('evm_revert', [localSnapshotId])
    })

    it(`should exchange to at least amount specified in receiveAtLeast`, async function () {
      await exchange.swapTokenForDai(
        MAINNET_ADRESSES.USDT,
        initialUSDTBalanceInWei,
        receiveAtLeastInWei,
        to,
        data,
        {
          value: 0,
          gasLimit: 2500000,
        },
      )

      const currentUSDTBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.USDT, address))
      const currentDaiBalance = convertToBigNumber(
        await balanceOf(MAINNET_ADRESSES.MCD_DAI, address),
      )

      expect(currentUSDTBalance.toString()).to.be.eq('0')
      expect(amountFromWei(currentDaiBalance).toNumber()).to.be.greaterThanOrEqual(
        amountFromWei(receiveAtLeastInWei).toNumber(),
      )
    })
  })

  describe('DAI for Asset with different precision and no fully ERC20 compliant', function () {
    let daiBalanceInWei, amountWithFeeInWei, to, data, receiveAtLeastInWei, localSnapshotId

    this.beforeAll(async function () {
      localSnapshotId = await provider.send('evm_snapshot', [])
      const amountInWei = amountToWei(new BigNumber(1000))
      amountWithFeeInWei = amountInWei.div(ONE.minus(fee.asDecimal)).toFixed(0)

      await swapTokens(
        MAINNET_ADRESSES.ETH,
        MAINNET_ADRESSES.MCD_DAI,
        amountToWei(new BigNumber(10), 18).toFixed(0),
        amountWithFeeInWei,
        address,
        provider,
        signer,
      )

      daiBalanceInWei = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.MCD_DAI, address))

      const response = await exchangeFromDAI(
        MAINNET_ADRESSES.USDT,
        amountInWei.toFixed(0),
        slippage.value.toString(),
        exchange.address,
        ['UNISWAP_V2'],
      )

      const {
        toTokenAmount,
        tx: { to: _to, data: _data },
      } = response
      to = _to
      data = _data

      const receiveAtLeast = new BigNumber(amountFromWei(toTokenAmount, 6)).times(
        ONE.minus(slippage.asDecimal),
      )

      receiveAtLeastInWei = amountToWei(receiveAtLeast, 6).toFixed(0)
    })

    this.afterAll(async function () {
      await provider.send('evm_revert', [localSnapshotId])
    })

    it(`should exchange to at least amount specified in receiveAtLeast`, async function () {
      await DAI.approve(exchange.address, amountWithFeeInWei)
      await exchange.swapDaiForToken(
        MAINNET_ADRESSES.USDT,
        amountWithFeeInWei,
        receiveAtLeastInWei,
        to,
        data,
        {
          value: 0,
          gasLimit: 2500000,
        },
      )

      const currentUSDTBalance = amountFromWei(
        convertToBigNumber(await balanceOf(MAINNET_ADRESSES.USDT, address)),
        6,
      )
      const currentDaiBalance = convertToBigNumber(
        await balanceOf(MAINNET_ADRESSES.MCD_DAI, address),
      )

      expect(currentDaiBalance.toString()).to.be.eq(
        daiBalanceInWei.minus(amountWithFeeInWei).toString(),
      )
      expect(currentUSDTBalance.toNumber()).to.be.greaterThanOrEqual(
        amountFromWei(receiveAtLeastInWei, 6).toNumber(),
      )
    })
  })
})
