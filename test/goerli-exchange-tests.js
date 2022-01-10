const {
  balanceOf,
  MAINNET_ADRESSES,
  FEE,
  FEE_BASE,
  init,
  loadDummyExchangeFixtures,
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
    console.log('Before init')
    let [_provider, _signer] = await init(undefined, provider, signer)
    console.log('After init')
    provider = _provider
    signer = _signer
    address = await signer.getAddress()

    feeBeneficiary = await (await _provider.getSigner(1)).getAddress()
    slippage = asPercentageValue(8, 100)
    fee = asPercentageValue(FEE, FEE_BASE)

    console.log('Fee and slippage', FEE, 8)

    const GoerliDummyExchange = await ethers.getContractFactory('GoerliDummyExchange', signer)
    exchange = await GoerliDummyExchange.deploy(
      feeBeneficiary,
      FEE,
      8,
      MAINNET_ADRESSES.MCD_DAI,
      address,
    )
    await exchange.deployed()

    await loadDummyExchangeFixtures(provider, signer, exchange, true)
    console.log('After deploy', address)

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

    it('should not happen if it is triggered from unauthorized caller', async () => {
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

        let tx = await WETH.deposit({
          value: amountToWei(amount.toNumber()).toFixed(0),
        })

        const intBal = await balanceOf(MAINNET_ADRESSES.ETH, address)

        initialWethWalletBalance = convertToBigNumber(intBal)

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

      it('should have collected fee', async function () {
        const beneficiaryDaiBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, feeBeneficiary),
        )

        const expectedCollectedFee = amountFromWei(receiveAtLeastInWei)
          .div(ONE.minus(slippage.asDecimal))
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
        lessThanTheTransferAmount = convertToBigNumber(amountInWei).minus(5)

        await WETH.approve(exchange.address, lessThanTheTransferAmount.toFixed(0))
      })

      this.afterEach(async function () {
        await provider.send('evm_revert', [localSnapshotId])
      })

      it('should throw an error and not exchange anything', async function () {
        let tx = exchange.swapTokenForDai(
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
        await expect(tx).to.revertedWith('Exchange / Not enought allowance')

        const wethBalance = convertToBigNumber(await balanceOf(MAINNET_ADRESSES.ETH, address))

        expect(wethBalance.toString()).to.equals(initialWethWalletBalance.toString())
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

    it('should not happen if it is triggered from unauthorized caller', async () => {
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

        expect(daiBalance.toString()).to.be.equal(
          initialDaiWalletBalance.minus(amountWithFeeInWei).toString(),
        )
        expect(wethBalance.gte(convertToBigNumber(receiveAtLeastInWei))).to.be.true
      })

      it('should have collected fee', async function () {
        const beneficiaryDaiBalance = convertToBigNumber(
          await balanceOf(MAINNET_ADRESSES.MCD_DAI, feeBeneficiary),
        )

        const expectedCollectedFee = convertToBigNumber(amountWithFeeInWei).times(fee.asDecimal)
        expect(beneficiaryDaiBalance.toFixed(0)).to.be.eq(expectedCollectedFee.toFixed(0))
      })
    })

    describe('when transferring less amount to the exchange', async function () {
      let lessThanTheTransferAmount, localSnapshotId, deficitAmount

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
          .minus(deficitAmount)
          .toFixed(0)

        await DAI.approve(exchange.address, lessThanTheTransferAmount)
      })

      this.afterEach(async function () {
        await provider.send('evm_revert', [localSnapshotId])
      })

      it('should throw an error and not exchange anything', async function () {
        let tx = exchange.swapDaiForToken(
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
        await expect(tx).to.be.revertedWith('Exchange / Not enought allowance')
      })
    })
  })
})
