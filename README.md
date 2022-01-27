## Documentation
[Multiply Smart Contracts Documentation](https://docs.google.com/document/d/1hCYIiWDc_Zm4oJasRfSZqiTk2xXpt1k7OXa52Lqd45I/edit)
## To install
Run `npm install` or `yarn` in the repo folder.
You will also need to create a .env file and fill it in with appropriate api keys.

.env file minimal content:

`ALCHEMY_NODE=
PRIV_KEY_MAINNET=
`

where ALCHEMY_NODE is Alchemyapi.io api url with a valid key (e.g. https://eth-mainnet.alchemyapi.io/v2/{KEY})
PRIV_KEY_MAINNET is private key string for forking mainnet network purposes.
## How to run tests

All of the tests are ran from the forked state of the mainnet. In the hardhat config you can change the 
block number the fork starts from. If it starts from an old state some tests might not work.

1. You first need to start a hardhat node from the forked mainnet with the following command:

`npx hardhat node --max-memory 8192 --fork ALCHEMY_API_URL`

3. After that you can run the tests, for example:

`npx hardhat test --network local test/mocked-exchange-tests.js`
## Common commands

`npm run compile` -  compile all the contracts

`npm run deploy [network] [deploy-script]` - deploy to the specified network by calling the script from the `/scripts` folder

`npm run test [network] [test-file]` - run a test to the specified network by calling the script from the `/test` folder

`npm run verify [network] [contract-name]` - verify contract based on address and arguments from `/deployments` folder
