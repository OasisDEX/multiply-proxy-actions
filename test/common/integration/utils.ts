import { JsonRpcProvider } from '@ethersproject/providers'
import BigNumber from 'bignumber.js'
import retry from 'async-retry'
import { getPayload } from './1inch'

export async function createSnapshot(provider: JsonRpcProvider) {
  const id = await provider.send('evm_snapshot', [])
  // console.log('snapshot created', id, new Date())
  return id
}

// TODO:
export const restoreSnapshot = async function (provider: JsonRpcProvider, id: string) {
  if ((this as any).lock) {
    console.log('Skiping restore', (this as any).lock)
    // delete restoreSnapshot.lock
    return
  }

  await provider.send('evm_revert', [id])
  console.log('snapshot restored', id, new Date())
}
restoreSnapshot.lock = false

export async function fillExchangeData(
  _testParams,
  exchangeData,
  exchange,
  fee,
  protocols = [],
  precision = 18,
) {
  if (!_testParams.useMockExchange) {
    const oneInchPayload = await retry(
      async () =>
        await getPayload(
          exchangeData,
          exchange.address,
          _testParams.slippage,
          fee,
          protocols,
          // precision,
        ),
      {
        retries: 5,
      },
    )
    exchangeData._exchangeCalldata = oneInchPayload.data
    exchangeData.exchangeAddress = oneInchPayload.to
  }
}

export function getAddressesLabels(
  deployedContracts,
  addressRegistry,
  mainnet,
  primarySignerAddress,
) {
  const labels = {}
  let keys = Object.keys(addressRegistry)
  labels[primarySignerAddress.substr(2).toLowerCase()] = 'caller'
  keys.forEach(x => {
    const adr = addressRegistry[x].substr(2).toLowerCase() // no 0x prefix
    if (!labels[adr]) {
      labels[adr] = x.toString()
    }
  })
  keys = Object.keys(mainnet)
  keys.forEach(x => {
    const adr = mainnet[x].substr(2).toLowerCase() // no 0x prefix
    if (!labels[adr]) {
      labels[adr] = x.toString()
    }
  })
  keys = Object.keys(deployedContracts)
  keys.forEach(x => {
    if (deployedContracts[x].address) {
      const adr = deployedContracts[x].address.substr(2).toLowerCase() // no 0x prefix
      if (!labels[adr]) {
        // if address repeats in address_registry it is not taken
        labels[adr] = x.toString()
      }
    }
  })
  labels['0000000000000000000000000000000000000000'] = 'ZERO_ADDRESS'
  return labels
}

export function findExchangeTransferEvent(source, dest, txResult) {
  let events = txResult.events.filter(
    x => x.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  )

  events = events.filter(
    x =>
      x.topics[1].toLowerCase().indexOf(source.toLowerCase().substr(2)) !== -1 &&
      x.topics[2].toLowerCase().indexOf(dest.toLowerCase().substr(2)) !== -1,
  )
  return new BigNumber(events[0].data, 16)
}

export function printAllERC20Transfers(txResult, labels) {
  function tryUseLabels(value) {
    const toCheck = value.substr(26) // skip 24 leading 0 anx 0x
    if (labels[toCheck]) {
      return labels[toCheck]
    } else {
      return '0x' + toCheck
    }
  }

  let events = txResult.events.filter(
    x => x.topics[0] == '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  )
  const packedEvents = []
  for (let i = 0; i < events.length; i++) {
    packedEvents.push({
      AmountAsNumber: new BigNumber(events[i].data, 16)
        .dividedBy(new BigNumber(10).exponentiatedBy(18))
        .toFixed(5),
      Token:
        events[i].address == '0x6B175474E89094C44Da98b954EedeAC495271d0F'
          ? 'DAI'
          : events[i].address == '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
          ? 'WETH'
          : events[i].address,
      From: tryUseLabels(events[i].topics[1]),
      To: tryUseLabels(events[i].topics[2]),
    })
  }

  events = txResult.events.filter(
    // Deposit of WETH
    x => x.topics[0] == '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c',
  )

  for (let i = 0; i < events.length; i++) {
    packedEvents.push({
      AmountAsNumber: new BigNumber(events[i].data, 16)
        .dividedBy(new BigNumber(10).exponentiatedBy(18))
        .toFixed(5),
      Token: 'WETH',
      From: '0x0000000000000000000000000000000000000000',
      To: tryUseLabels(events[i].topics[1]),
    })
  }
  events = txResult.events.filter(
    // Withdraw of WETH
    x => x.topics[0] == '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65',
  )

  for (let i = 0; i < events.length; i++) {
    packedEvents.push({
      AmountAsNumber: new BigNumber(events[i].data, 16)
        .dividedBy(new BigNumber(10).exponentiatedBy(18))
        .toFixed(5),
      Token: 'WETH',
      From: tryUseLabels(events[i].topics[1]),
      To: '0x0000000000000000000000000000000000000000',
    })
  }
  console.log('All tx transfers:', packedEvents)
  return packedEvents
}

export async function resetNetworkToBlock(provider: JsonRpcProvider, blockNumber: number) {
  console.log('\x1b[33m Reseting network to:\x1b[0m', blockNumber, new Date())
  provider.send('hardhat_reset', [
    {
      forking: {
        jsonRpcUrl: process.env.ALCHEMY_NODE,
        blockNumber,
      },
    },
  ])
}
