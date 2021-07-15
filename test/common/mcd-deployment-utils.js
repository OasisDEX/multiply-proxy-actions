const dsProxyRegistryAbi = require("../../abi/external/ds-proxy-registry.json");
const dsProxyAbi = require("../../abi/external/ds-proxy.json");
const { default: BigNumber } = require("bignumber.js");
const getCdpsAbi = require("../../abi/external/get-cdps.json");
const _ = require("lodash");

const { getVaultInfo } = require("../utils-mcd.js");

const FEE = 3;
const FEE_BASE = 10000;

let MAINNET_ADRESSES = require("../../addresses/mainnet.json");

const { WETH_ADDRESS, one, TEN, balanceOf } = require("../utils");

MAINNET_ADRESSES.WETH_ADDRESS = WETH_ADDRESS;

const dsproxyExecuteAction = async function (
    proxyActions,
    dsProxy,
    fromAddress,
    method,
    params,
    value = 0
) {
    const calldata = proxyActions.interface.encodeFunctionData(method, params);
    let retVal;
    try {
        var tx = await dsProxy["execute(address,bytes)"](proxyActions.address, calldata, {
            from: fromAddress,
            value: value,
            gasLimit: 2500000,
        });
        retVal = await tx.wait();
    } catch (error) {
        retVal = false;
    }
    return retVal;
};

const addressRegistryFactory = function (
    multiplyProxyActionsInstanceAddress,
    exchangeInstanceAddress
) {
    return {
        jug: MAINNET_ADRESSES.MCD_JUG,
        manager: MAINNET_ADRESSES.CDP_MANAGER,
        multiplyProxyActions: multiplyProxyActionsInstanceAddress,
        aaveLendingPoolProvider: "0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5",
        feeRecepient: "0x79d7176aE8F93A04bC73b9BC710d4b44f9e362Ce",
        exchange: exchangeInstanceAddress,
    };
};

const getOrCreateProxy = async function getOrCreateProxy(provider, signer) {
    const address = await signer.getAddress();
    const dsProxyRegistry = new ethers.Contract(
        MAINNET_ADRESSES.PROXY_REGISTRY,
        dsProxyRegistryAbi,
        provider
    ).connect(signer);
    let proxyAddress = await dsProxyRegistry.proxies(address);
    if (proxyAddress === ethers.constants.AddressZero) {
        await (await dsProxyRegistry["build()"]()).wait();
        proxyAddress = await dsProxyRegistry.proxies(address);
    }
    return proxyAddress;
};

const deploySystem = async function (provider, signer) {
    const userProxyAddress = await getOrCreateProxy(provider, signer);
    const dsProxy = new ethers.Contract(userProxyAddress, dsProxyAbi, provider).connect(signer);

    // const multiplyProxyActions = await deploy("MultiplyProxyActions");
    const MPActions = await ethers.getContractFactory("MultiplyProxyActions", signer);
    const multiplyProxyActions = await MPActions.deploy();
    await multiplyProxyActions.deployed();

    const incompleteRegistry = addressRegistryFactory(undefined, undefined);

    const Exchange = await ethers.getContractFactory("Exchange", signer);
    const exchange = await Exchange.deploy(
        multiplyProxyActions.address,
        incompleteRegistry.feeRecepient,
        FEE
    );
    await exchange.deployed();

    // const mcdView = await deploy("McdView");
    const McdView = await ethers.getContractFactory("McdView", signer);
    const mcdView = await McdView.deploy();
    await mcdView.deployed();

    return {
        userProxyAddress,
        dsProxy,
        exchange,
        multiplyProxyActions,
        mcdView,
    };
};

const ONE = one;

async function getOraclePrice(provider) {
    const storageHexToBigNumber = (uint256) => {
        const match = uint256.match(/^0x(\w+)$/);
        if (!match) {
            throw new Error(`invalid uint256: ${uint256}`);
        }
        return match[0].length <= 32
            ? [new BigNumber(0), new BigNumber(uint256)]
            : [
                  new BigNumber(`0x${match[0].substr(0, match[0].length - 32)}`),
                  new BigNumber(`0x${match[0].substr(match[0].length - 32, 32)}`),
              ];
    };
    const slotCurrent = 3;
    const priceHex = await provider.getStorageAt(MAINNET_ADRESSES.PIP_ETH, slotCurrent);
    const p = storageHexToBigNumber(priceHex);
    return p[1].shiftedBy(-18);
}

const getLastCDP = async function (provider, signer, proxyAddress) {
    const getCdps = new ethers.Contract(MAINNET_ADRESSES.GET_CDPS, getCdpsAbi, provider).connect(
        signer
    );
    const { ids, urns, ilks } = await getCdps.getCdpsAsc(
        MAINNET_ADRESSES.CDP_MANAGER,
        proxyAddress
    );
    const cdp = _.last(
        _.map(_.zip(ids, urns, ilks), (cdp) => ({
            id: cdp[0].toNumber(),
            urn: cdp[1],
            ilk: cdp[2],
        }))
    );
    if (_.isUndefined(cdp)) {
        throw new Error("No CDP available");
    }
    return cdp;
};

module.exports = {
    getOrCreateProxy,
    deploySystem,
    dsproxyExecuteAction,
    getOraclePrice,
    getLastCDP,
    getVaultInfo,
    balanceOf,
    addressRegistryFactory,
    ONE,
    TEN,
    FEE,
    FEE_BASE,
    MAINNET_ADRESSES,
};
