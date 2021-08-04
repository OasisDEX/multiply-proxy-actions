const { getPayload } = require('./_1inch')
const { getCurrentBlockNumber } = require('./../http_apis')
const { default: BigNumber } = require('bignumber.js')

const createSnapshot = async function (provider) {
  var id = await provider.send('evm_snapshot', [])
  //console.log('snapshot created', id, new Date())
  return id
}

const restoreSnapshot = async function (provider, id) {
  if (restoreSnapshot.lock) {
    //console.log('Skiping restore', restoreSnapshot.lock)
    delete restoreSnapshot.lock
  } else {
    await provider.send('evm_revert', [id])
    //console.log('snapshot restored', id, new Date())
  }
}

const backup = function (el) {
  if (!el.__backup) {
    el.__backup = []
  } else {
  }
  var tmp = JSON.stringify(el)
  tmp = JSON.parse(tmp) //to create a copy
  delete tmp.__backup // to not backup a backup
  el.__backup.push(JSON.stringify(tmp))
}

const restore = function (el) {
  // keeps same reference, eg. in a table
  if (el.__backup) {
    let tmp = el.__backup.pop()
    tmp = JSON.parse(tmp)
    let keys = Object.keys(tmp)

    for (var i = 0; i < keys.length; i++) {
      if (keys[i] != '__backup') {
        el[keys[i]] = tmp[keys[i]]
      }
    }
  } else {
    console.warn('trying to restore, without backup')
  }
}

const fillExchangeData = async function (
  _testParams,
  exchangeData,
  exchange,
  fee,
  protocols,
  precision = 18,
) {
  if (_testParams.useMockExchange == false) {
    if (_testParams.debug == true) {
    }
    var _1inchPayload = undefined
    var tries = 5
    while (_1inchPayload == undefined && tries > 0) {
      try {
        tries--
        _1inchPayload = await getPayload(
          exchangeData,
          exchange.address,
          _testParams.slippage,
          fee,
          protocols,
          precision,
        )
      } catch (ex) {
        if (tries == 0) {
          throw ex
        } else {
          await new Promise((res, rej) => {
            setTimeout(() => {
              res(true)
            }, 2000)
          })
        }
      }
    }
    exchangeData._exchangeCalldata = _1inchPayload.data
    exchangeData.exchangeAddress = _1inchPayload.to
  }
}

const getAddressesLabels = function (
  deployedContracts,
  address_registry,
  mainnet,
  primarySignerAddress,
) {
  labels = {}
  var keys = Object.keys(address_registry)
  labels[primarySignerAddress.substr(2).toLowerCase()] = 'caller'
  keys.forEach((x) => {
    var adr = address_registry[x].substr(2).toLowerCase() //no 0x prefix
    if (!labels[adr]) {
      labels[adr] = x.toString()
    }
  })
  keys = Object.keys(mainnet)
  keys.forEach((x) => {
    var adr = mainnet[x].substr(2).toLowerCase() //no 0x prefix
    if (!labels[adr]) {
      labels[adr] = x.toString()
    }
  })
  keys = Object.keys(deployedContracts)
  keys.forEach((x) => {
    if (deployedContracts[x].address) {
      var adr = deployedContracts[x].address.substr(2).toLowerCase() //no 0x prefix
      if (!labels[adr]) {
        // if address repeats in address_registry it is not taken
        labels[adr] = x.toString()
      }
    }
  })
  labels['0000000000000000000000000000000000000000'] = 'ZERO_ADDRESS'
  return labels
}

const findExchangeTransferEvent = function (source, dest, txResult) {
  var events = txResult.events.filter(
    (x) => x.topics[0] == '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  )

  events = events.filter(
    (x) =>
      x.topics[1].toLowerCase().indexOf(source.toLowerCase().substr(2)) != -1 &&
      x.topics[2].toLowerCase().indexOf(dest.toLowerCase().substr(2)) != -1,
  )
  return new BigNumber(events[0].data, 16)
}

const printAllERC20Transfers = function (txResult, labels) {
  function tryUseLabels(value) {
    var toCheck = value.substr(26) //skip 24 leading 0 anx 0x
    if (labels[toCheck]) {
      return labels[toCheck]
    } else {
      return '0x' + toCheck
    }
  }

  var events = txResult.events.filter(
    (x) => x.topics[0] == '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  )
  packedEvents = []
  for (var i = 0; i < events.length; i++) {
    var item = {
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
    }
    packedEvents.push(item)
  }

  events = txResult.events.filter(
    //Deposit of WETH
    (x) => x.topics[0] == '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c',
  )

  for (var i = 0; i < events.length; i++) {
    var item = {
      AmountAsNumber: new BigNumber(events[i].data, 16)
        .dividedBy(new BigNumber(10).exponentiatedBy(18))
        .toFixed(5),
      Token: 'WETH',
      From: '0x0000000000000000000000000000000000000000',
      To: tryUseLabels(events[i].topics[1]),
    }
    packedEvents.push(item)
  }
  events = txResult.events.filter(
    //Withdraw of WETH
    (x) => x.topics[0] == '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65',
  )

  for (var i = 0; i < events.length; i++) {
    var item = {
      AmountAsNumber: new BigNumber(events[i].data, 16)
        .dividedBy(new BigNumber(10).exponentiatedBy(18))
        .toFixed(5),
      Token: 'WETH',
      From: tryUseLabels(events[i].topics[1]),
      To: '0x0000000000000000000000000000000000000000',
    }
    packedEvents.push(item)
  }
  console.log('All tx transfers:', packedEvents)
  return packedEvents
}

const resetNetworkToBlock = async function (provider, blockNumber) {
  console.log('\x1b[33m Reseting network to:\x1b[0m', blockNumber, new Date())
  provider.send('hardhat_reset', [
    {
      forking: {
        jsonRpcUrl: process.env.ALCHEMY_NODE,
        blockNumber: blockNumber,
      },
    },
  ])
}

module.exports = {
  printAllERC20Transfers,
  findExchangeTransferEvent,
  getAddressesLabels,
  fillExchangeData,
  createSnapshot,
  restoreSnapshot,
  backup,
  restore,
  resetNetworkToBlock,
}
