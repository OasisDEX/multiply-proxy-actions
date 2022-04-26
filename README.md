## Documentation

[Multiply Smart Contracts Documentation](https://docs.google.com/document/d/1hCYIiWDc_Zm4oJasRfSZqiTk2xXpt1k7OXa52Lqd45I/edit)

## To install

Run `npm install` or `yarn` in the repo folder. You will also need to create a .env file and fill it in with appropriate
api keys.

.env file minimal content:

`ALCHEMY_NODE= PRIV_KEY_MAINNET=
`

where ALCHEMY_NODE is Alchemyapi.io api url with a valid key (e.g. https://eth-mainnet.alchemyapi.io/v2/{KEY})
PRIV_KEY_MAINNET is private key string for forking mainnet network purposes.

## How to run tests

All of the tests are ran from the forked state of the mainnet. In the hardhat config you can change the block number the
fork starts from. If it starts from an old state some tests might not work.

1. You first need to start a hardhat node from the forked mainnet with the following command:

`npx hardhat node --max-memory 8192 --fork ALCHEMY_API_URL`

3. After that you can run the tests, for example:

`npx hardhat test --network local test/mocked-exchange-tests.js`

## Common commands

`npm run compile` - compile all the contracts

`npm run deploy [network] [deploy-script]` - deploy to the specified network by calling the script from the `/scripts`
folder

`npm run test [network] [test-file]` - run a test to the specified network by calling the script from the `/test` folder

`npm run verify [network] [contract-name]` - verify contract based on address and arguments from `/deployments` folder

## Tasks

To run a task `npx hardhat <task name> <params> --network local`
Before running a task run fork blockchain in separate process. (`npx hardhat node ...` see above)

### `get-proxy`

#### params:

- `proxy` - a DsProxy that you want to transfer to your wallet
- `to` - [Optional] an address of a new owner for given proxy (default address zero from hardhat test accounts)

#### example

`npx hardhat --proxy 0x429D8e38DD28e81EB4eFEe97D33fd08fC333A58e --to 0x34314adbfBb5d239bb67f0265c9c45EB8b834412 --network local`

### `transfer-erc20`

This task will transfer all the entire balance of the ERC20 token from one address to another.

#### params:

- `from` - an address that has a balance of ERC20
- `to` - an address that wants to receive the ERC20
- `token` - The address of the token that we want to transfer. The entire token balance will be transferred.

#### example

The following will transfer all DAI from the first Hardhat test account to the second.

`npx hardhat transfer-erc20 --from 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --to 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --token 0x6b175474e89094c44da98b954eedeac495271d0f --network local`
