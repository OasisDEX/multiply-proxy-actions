// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity >=0.7.6;
pragma abicoder v2;
import "../interfaces/IERC20.sol";
import "./ExchangeData.sol";
import "../utils/SafeMath.sol";
import "../interfaces/mcd/IJoin.sol";
import "../interfaces/mcd/IManager.sol";
import "../interfaces/mcd/IVat.sol";
import "../interfaces/mcd/IJug.sol";
import "../interfaces/mcd/IDaiJoin.sol";
import "../interfaces/misc/IUniPool.sol";
import "../interfaces/misc/IGUNIRouter.sol";
import "../interfaces/misc/IGUNIResolver.sol";
import "../interfaces/misc/IGUNIToken.sol";
import "../interfaces/exchange/IExchange.sol";
import "./../flashMint/interface/IERC3156FlashBorrower.sol";
import "./../flashMint/interface/IERC3156FlashLender.sol";

struct CdpData {
  address gemJoin;
  address payable fundsReceiver;
  uint256 cdpId;
  bytes32 ilk;
  uint256 requiredDebt;
  uint256 borrowCollateral;
  uint256 withdrawCollateral;
  uint256 withdrawDai;
  uint256 depositDai;
  uint256 depositCollateral;
  bool skipFL;
  string methodName;
}

struct AddressRegistry {
  address jug;
  address manager;
  address multiplyProxyActions;
  address lender;
  address exchange;
}

struct GuniAddressRegistry {
  address guni;
  address router;
  address resolver;
  address guniProxyActions;
  address otherToken;
}

interface IMPA {
  function increaseMultipleDepositCollateral(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  ) external payable;
}

contract GuniMultiplyProxyActions is IERC3156FlashBorrower {
  using SafeMath for uint256;
  uint256 constant RAY = 10**27;
  address public constant DAIJOIN = 0x9759A6Ac90977b93B58547b4A71c78317f391A28;
  address public constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;

  IERC20 public immutable dai;

  constructor() {
    dai = IERC20(DAI);
  }

  function openMultiplyGuniVault(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry,
    GuniAddressRegistry calldata guniAddressRegistry,
    uint256 token0Amount
  ) public {
    cdpData.ilk = IJoin(cdpData.gemJoin).ilk();
    cdpData.cdpId = IManager(addressRegistry.manager).open(cdpData.ilk, address(this));

    increaseMultipleGuni(
      exchangeData,
      cdpData,
      addressRegistry,
      guniAddressRegistry,
      token0Amount
    );
  }

  function increaseMultipleGuni(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry,
    GuniAddressRegistry calldata guniAddressRegistry,
    uint256 token0Amount
  ) public {
    dai.transferFrom(msg.sender, guniAddressRegistry.guniProxyActions, token0Amount);

    takeAFlashLoan(exchangeData, cdpData, addressRegistry, guniAddressRegistry, 1);
  }

  function takeAFlashLoan(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry,
    GuniAddressRegistry calldata guniAddressRegistry,
    uint256 action
  ) internal {
    bytes memory paramsData = abi.encode(
      action,
      exchangeData,
      cdpData,
      addressRegistry,
      guniAddressRegistry
    );

    IManager(addressRegistry.manager).cdpAllow(
      cdpData.cdpId,
      addressRegistry.multiplyProxyActions,
      1
    );

    IManager(addressRegistry.manager).cdpAllow(
      cdpData.cdpId,
      guniAddressRegistry.guniProxyActions,
      1
    );

    IERC3156FlashLender(addressRegistry.lender).flashLoan(
      IERC3156FlashBorrower(guniAddressRegistry.guniProxyActions),
      DAI,
      cdpData.requiredDebt,
      paramsData
    );

    IManager(addressRegistry.manager).cdpAllow(
      cdpData.cdpId,
      addressRegistry.multiplyProxyActions,
      0
    );

    IManager(addressRegistry.manager).cdpAllow(
      cdpData.cdpId,
      guniAddressRegistry.guniProxyActions,
      0
    );
  }

  function closeGuniVaultExitDai(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry,
    GuniAddressRegistry calldata guniAddressRegistry
  ) public {
    cdpData.ilk = IJoin(cdpData.gemJoin).ilk();

    address urn = IManager(addressRegistry.manager).urns(cdpData.cdpId);
    address vat = IManager(addressRegistry.manager).vat();

    uint256 wadD = _getWipeAllWad(vat, urn, urn, cdpData.ilk);
    cdpData.requiredDebt = wadD;

    takeAFlashLoan(exchangeData, cdpData, addressRegistry, guniAddressRegistry, 0);
  }

  function _increaseMPGuni(
    ExchangeData memory exchangeData,
    CdpData memory cdpData,
    AddressRegistry memory addressRegistry,
    GuniAddressRegistry memory guniAddressRegistry,
    uint256 borrowedDaiAmount
  ) internal {
    IGUNIToken guni = IGUNIToken(guniAddressRegistry.guni);
    IERC20 otherToken = IERC20(guniAddressRegistry.otherToken);

    uint256 bal0 = dai.balanceOf(address(this));
    uint256 swapAmount;

    {
      uint256 otherTokenTo18Conversion = 10**(18 - otherToken.decimals());
      (uint256 sqrtPriceX96, , , , , , ) = IUniPool(guni.pool()).slot0();
      IGUNIResolver resolver = IGUNIResolver(guniAddressRegistry.resolver);
      (, swapAmount) = resolver.getRebalanceParams(
        address(guni),
        guni.token0() == address(dai) ? bal0 : 0,
        guni.token1() == address(dai) ? bal0 : 0,
        ((((sqrtPriceX96 * sqrtPriceX96) >> 96) * 1e18) >> 96) * otherTokenTo18Conversion
      );
    }
    {
      IExchange exchange = IExchange(addressRegistry.exchange);

      dai.approve(address(exchange), exchangeData.fromTokenAmount);

      exchange.swapDaiForToken(
        exchangeData.toTokenAddress,
        exchangeData.fromTokenAmount,
        exchangeData.minToTokenAmount,
        exchangeData.exchangeAddress,
        exchangeData._exchangeCalldata
      );
    }

    exchangeData.fromTokenAmount = 0;
    exchangeData.minToTokenAmount = 0;
    cdpData.requiredDebt = 0;

    uint256 guniBalance;
    uint256 bal1 = otherToken.balanceOf(address(this));

    {
      IGUNIRouter router = IGUNIRouter(guniAddressRegistry.router);
      dai.approve(address(router), bal0);
      otherToken.approve(address(router), bal1);

      (, , guniBalance) = router.addLiquidity(address(guni), bal0, bal1, 0, 0, address(this));
    }

    cdpData.depositCollateral = guniBalance;
    cdpData.borrowCollateral = 0;
    guni.approve(addressRegistry.multiplyProxyActions, cdpData.depositCollateral);
    IMPA(addressRegistry.multiplyProxyActions).increaseMultipleDepositCollateral(
      exchangeData,
      cdpData,
      addressRegistry
    );
    drawDaiDebt(cdpData, addressRegistry, borrowedDaiAmount);

    uint256 daiLeft = IERC20(DAI).balanceOf(address(this)).sub(borrowedDaiAmount);
    uint256 otherTokenLeft = otherToken.balanceOf(address(this));

    if (daiLeft > 0) {
      IERC20(DAI).transfer(cdpData.fundsReceiver, daiLeft);
    }
    if (otherTokenLeft > 0) {
      otherToken.transfer(cdpData.fundsReceiver, otherTokenLeft);
    }
  }

  function _closeToDaiMPGuni(
    ExchangeData memory exchangeData,
    CdpData memory cdpData,
    AddressRegistry memory addressRegistry,
    GuniAddressRegistry memory guniAddressRegistry,
    uint256 borrowedDaiAmount
  ) internal {
    IExchange exchange = IExchange(addressRegistry.exchange);
    IERC20 otherToken = IERC20(guniAddressRegistry.otherToken);
    uint256 ink = getInk(addressRegistry.manager, cdpData);

    wipeAndFreeGem(
      addressRegistry.manager,
      cdpData.gemJoin,
      cdpData.cdpId,
      cdpData.requiredDebt,
      ink
    );

    IGUNIToken guni = IGUNIToken(guniAddressRegistry.guni);

    uint256 guniBalance = guni.balanceOf(address(this));

    {
      IGUNIRouter router = IGUNIRouter(guniAddressRegistry.router);
      guni.approve(address(router), guniBalance);
      router.removeLiquidity(address(guni), guniBalance, 0, 0, address(this));
    }

    otherToken.approve(address(exchange), otherToken.balanceOf(address(this)));
    exchange.swapTokenForDai(
      exchangeData.toTokenAddress,
      otherToken.balanceOf(address(this)),
      exchangeData.minToTokenAmount,
      exchangeData.exchangeAddress,
      exchangeData._exchangeCalldata
    );

    uint256 daiLeft = IERC20(DAI).balanceOf(address(this)).sub(borrowedDaiAmount);
    uint256 otherTokenLeft = otherToken.balanceOf(address(this));

    if (daiLeft > 0) {
      IERC20(DAI).transfer(cdpData.fundsReceiver, daiLeft);
    }
    if (otherTokenLeft > 0) {
      otherToken.transfer(cdpData.fundsReceiver, otherTokenLeft);
    }
  }

  function onFlashLoan(
    address initiator,
    address token,
    uint256 amount,
    uint256 fee,
    bytes calldata params
  ) public override returns (bytes32) {
    (
      uint256 mode,
      ExchangeData memory exchangeData,
      CdpData memory cdpData,
      AddressRegistry memory addressRegistry,
      GuniAddressRegistry memory guniAddressRegistry
    ) = abi.decode(params, (uint256, ExchangeData, CdpData, AddressRegistry, GuniAddressRegistry));

    uint256 borrowedDaiAmount;
    {
      borrowedDaiAmount = amount.add(fee);
    }

    if (mode == 1) {
      _increaseMPGuni(
        exchangeData,
        cdpData,
        addressRegistry,
        guniAddressRegistry,
        borrowedDaiAmount
      );
    }
    if (mode == 0) {
      _closeToDaiMPGuni(
        exchangeData,
        cdpData,
        addressRegistry,
        guniAddressRegistry,
        borrowedDaiAmount
      );
    }

    IERC20(token).approve(addressRegistry.lender, borrowedDaiAmount);

    return keccak256("ERC3156FlashBorrower.onFlashLoan");
  }

  function getOtherTokenAmount(
    IGUNIToken guni,
    IGUNIResolver resolver,
    uint256 bal0,
    uint256 otherTokenDecimals
  ) public view returns (uint256 amount) {
    (uint256 sqrtPriceX96, , , , , , ) = IUniPool(guni.pool()).slot0();

    uint256 otherTokenTo18Conv = 10**(18 - otherTokenDecimals);

    (, amount) = resolver.getRebalanceParams(
      address(guni),
      guni.token0() == address(dai) ? bal0 : 0,
      guni.token1() == address(dai) ? bal0 : 0,
      ((((sqrtPriceX96 * sqrtPriceX96) >> 96) * 1e18) >> 96) * otherTokenTo18Conv
    );
  }

  function getInk(address manager, CdpData memory cdpData) internal view returns (uint256) {
    address urn = IManager(manager).urns(cdpData.cdpId);
    address vat = IManager(manager).vat();

    (uint256 ink, ) = IVat(vat).urns(cdpData.ilk, urn);
    return ink;
  }

  function wipeAndFreeGem(
    address manager,
    address gemJoin,
    uint256 cdp,
    uint256 borrowedDai,
    uint256 collateralDraw
  ) internal {
    address vat = IManager(manager).vat();
    address urn = IManager(manager).urns(cdp);
    bytes32 ilk = IManager(manager).ilks(cdp);

    IERC20(DAI).approve(DAIJOIN, borrowedDai);
    IDaiJoin(DAIJOIN).join(urn, borrowedDai);

    uint256 wadC = convertTo18(gemJoin, collateralDraw);

    IManager(manager).frob(cdp, -toInt256(wadC), _getWipeDart(vat, IVat(vat).dai(urn), urn, ilk));

    IManager(manager).flux(cdp, address(this), wadC);
    IJoin(gemJoin).exit(address(this), collateralDraw);
  }

  function convertTo18(address gemJoin, uint256 amt) internal returns (uint256 wad) {
    // For those collaterals that have less than 18 decimals precision we need to do the conversion before passing to frob function
    // Adapters will automatically handle the difference of precision
    wad = amt.mul(10**(18 - IJoin(gemJoin).dec()));
  }

  function _getWipeDart(
    address vat,
    uint256 dai,
    address urn,
    bytes32 ilk
  ) internal view returns (int256 dart) {
    // Gets actual rate from the vat
    (, uint256 rate, , , ) = IVat(vat).ilks(ilk);
    // Gets actual art value of the urn
    (, uint256 art) = IVat(vat).urns(ilk, urn);

    // Uses the whole dai balance in the vat to reduce the debt
    dart = toInt256(dai / rate);
    // Checks the calculated dart is not higher than urn.art (total debt), otherwise uses its value
    dart = uint256(dart) <= art ? -dart : -toInt256(art);
  }

  function drawDaiDebt(
    CdpData memory cdpData,
    AddressRegistry memory addressRegistry,
    uint256 amount
  ) internal {
    address urn = IManager(addressRegistry.manager).urns(cdpData.cdpId);
    address vat = IManager(addressRegistry.manager).vat();
    IManager(addressRegistry.manager).frob(
      cdpData.cdpId,
      0,
      _getDrawDart(vat, addressRegistry.jug, urn, cdpData.ilk, amount)
    );
    IManager(addressRegistry.manager).move(cdpData.cdpId, address(this), toRad(amount));
    if (IVat(vat).can(address(this), address(DAIJOIN)) == 0) {
      IVat(vat).hope(DAIJOIN);
    }

    IJoin(DAIJOIN).exit(address(this), amount);
  }

  function _getDrawDart(
    address vat,
    address jug,
    address urn,
    bytes32 ilk,
    uint256 wad
  ) internal returns (int256 dart) {
    // Updates stability fee rate
    uint256 rate = IJug(jug).drip(ilk);

    // Gets DAI balance of the urn in the vat
    uint256 dai = IVat(vat).dai(urn);

    // If there was already enough DAI in the vat balance, just exits it without adding more debt
    if (dai < wad.mul(RAY)) {
      // Calculates the needed dart so together with the existing dai in the vat is enough to exit wad amount of DAI tokens
      dart = toInt256(wad.mul(RAY).sub(dai) / rate);
      // This is neeeded due lack of precision. It might need to sum an extra dart wei (for the given DAI wad amount)
      dart = uint256(dart).mul(rate) < wad.mul(RAY) ? dart + 1 : dart;
    }
  }

  function toRad(uint256 wad) internal pure returns (uint256 rad) {
    rad = wad.mul(10**27);
  }

  function toInt256(uint256 x) internal pure returns (int256 y) {
    y = int256(x);
    require(y >= 0, "int256-overflow");
  }

  function _getWipeAllWad(
    address vat,
    address usr,
    address urn,
    bytes32 ilk
  ) internal view returns (uint256 wad) {
    // Gets actual rate from the vat
    (, uint256 rate, , , ) = IVat(vat).ilks(ilk);
    // Gets actual art value of the urn
    (, uint256 art) = IVat(vat).urns(ilk, urn);
    // Gets actual dai amount in the urn
    uint256 dai = IVat(vat).dai(usr);

    uint256 rad = art.mul(rate).sub(dai);
    wad = rad / RAY;

    // If the rad precision has some dust, it will need to request for 1 extra wad wei
    wad = wad.mul(RAY) < rad ? wad + 1 : wad;
  }
}
