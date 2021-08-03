// SPDX-License-Identifier: AGPL-3.0-or-later

/// MultiplyProxyActions.sol

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import {IERC20} from '../interfaces/IERC20.sol';
import '../interfaces/aaveV2/ILendingPoolAddressesProviderV2.sol';
import '../interfaces/aaveV2/ILendingPoolV2.sol';
import '../utils/SafeMath.sol';
import '../interfaces/IWETH.sol';
import '../interfaces/mcd/IJoin.sol';
import '../interfaces/mcd/IManager.sol';
import '../interfaces/mcd/IVat.sol';
import '../interfaces/mcd/IJug.sol';
import '../interfaces/mcd/IDaiJoin.sol';
import '../interfaces/exchange/IExchange.sol';
import './ExchangeData.sol';
import 'hardhat/console.sol';

pragma solidity >=0.7.6;
pragma abicoder v2;

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
}

struct AddressRegistry {
  address jug;
  address manager;
  address multiplyProxyActions;
  address aaveLendingPoolProvider;
  address exchange;
}

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// WARNING: These functions meant to be used as a a library for a DSProxy. Some are unsafe if you call them directly.
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

contract MultiplyProxyActions {
  using SafeMath for uint256;

  uint256 constant RAY = 10**27;

  address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
  address public constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
  address public constant DAIJOIN = 0x9759A6Ac90977b93B58547b4A71c78317f391A28;
  address public constant ETH_ADDR = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

  function getAaveLendingPool(address lendingPoolProvider) private view returns (ILendingPoolV2) {
    ILendingPoolAddressesProviderV2 provider = ILendingPoolAddressesProviderV2(lendingPoolProvider);
    ILendingPoolV2 lendingPool = ILendingPoolV2(provider.getLendingPool());
    return lendingPool;
  }

  function toInt256(uint256 x) internal pure returns (int256 y) {
    y = int256(x);
    require(y >= 0, 'int256-overflow');
  }

  function convertTo18(address gemJoin, uint256 amt) internal returns (uint256 wad) {
    // For those collaterals that have less than 18 decimals precision we need to do the conversion before passing to frob function
    // Adapters will automatically handle the difference of precision
    wad = amt.mul(10**(18 - IJoin(gemJoin).dec()));
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

  function openMultiplyVault(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  ) public payable {
    cdpData.ilk = IJoin(cdpData.gemJoin).ilk();
    cdpData.cdpId = IManager(addressRegistry.manager).open(cdpData.ilk, address(this));
    console.log(cdpData.cdpId);
    console.logBytes32(cdpData.ilk);
    increaseMultipleDepositCollateral(exchangeData, cdpData, addressRegistry);
  }

  function increaseMultipleDepositCollateral(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  ) public payable {
    IGem gem = IJoin(cdpData.gemJoin).gem();

    if (address(gem) == WETH) {
      gem.deposit{value: msg.value}();
      gem.transfer(addressRegistry.multiplyProxyActions, msg.value);
    } else {
      gem.transferFrom(msg.sender, addressRegistry.multiplyProxyActions, cdpData.depositCollateral);
    }
    console.log('increase multiple');
    increaseMultiple(exchangeData, cdpData, addressRegistry);
  }

  function increaseMultipleDepositDai(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  ) public {
    IERC20(DAI).transferFrom(msg.sender, addressRegistry.multiplyProxyActions, cdpData.depositDai);

    increaseMultiple(exchangeData, cdpData, addressRegistry);
  }

  function increaseMultiple(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  ) public {
    cdpData.ilk = IJoin(cdpData.gemJoin).ilk();

    address[] memory assets = new address[](1);
    assets[0] = DAI;
    uint256[] memory amounts = new uint256[](1);
    amounts[0] = cdpData.requiredDebt;
    uint256[] memory modes = new uint256[](1);
    modes[0] = 0;

    IManager(addressRegistry.manager).cdpAllow(
      cdpData.cdpId,
      addressRegistry.multiplyProxyActions,
      1
    );
    bytes memory paramsData = abi.encode(1, exchangeData, cdpData, addressRegistry);

    ILendingPoolV2 lendingPool = getAaveLendingPool(addressRegistry.aaveLendingPoolProvider);
    console.log('before flashLoan');
    lendingPool.flashLoan(
      addressRegistry.multiplyProxyActions,
      assets,
      amounts,
      modes,
      address(this),
      paramsData,
      0
    );

    IManager(addressRegistry.manager).cdpAllow(
      cdpData.cdpId,
      addressRegistry.multiplyProxyActions,
      0
    );
  }

  function decreaseMultiple(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  ) public {
    cdpData.ilk = IJoin(cdpData.gemJoin).ilk();

    address[] memory assets = new address[](1);
    assets[0] = DAI;

    uint256[] memory amounts = new uint256[](1);
    amounts[0] = cdpData.requiredDebt;

    uint256[] memory modes = new uint256[](1);
    modes[0] = 0;

    IManager(addressRegistry.manager).cdpAllow(
      cdpData.cdpId,
      addressRegistry.multiplyProxyActions,
      1
    );

    bytes memory paramsData = abi.encode(0, exchangeData, cdpData, addressRegistry);
    ILendingPoolV2 lendingPool = getAaveLendingPool(addressRegistry.aaveLendingPoolProvider);
    lendingPool.flashLoan(
      addressRegistry.multiplyProxyActions,
      assets,
      amounts,
      modes,
      address(this),
      paramsData,
      0
    );

    IManager(addressRegistry.manager).cdpAllow(
      cdpData.cdpId,
      addressRegistry.multiplyProxyActions,
      0
    );
  }

  function decreaseMultipleWithdrawCollateral(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  ) public {
    cdpData.ilk = IJoin(cdpData.gemJoin).ilk();

    address[] memory assets = new address[](1);
    assets[0] = DAI;

    uint256[] memory amounts = new uint256[](1);
    amounts[0] = cdpData.requiredDebt;

    uint256[] memory modes = new uint256[](1);
    modes[0] = 0;

    IManager(addressRegistry.manager).cdpAllow(
      cdpData.cdpId,
      addressRegistry.multiplyProxyActions,
      1
    );

    bytes memory paramsData = abi.encode(0, exchangeData, cdpData, addressRegistry);

    ILendingPoolV2 lendingPool = getAaveLendingPool(addressRegistry.aaveLendingPoolProvider);
    lendingPool.flashLoan(
      addressRegistry.multiplyProxyActions,
      assets,
      amounts,
      modes,
      address(this),
      paramsData,
      0
    );

    IManager(addressRegistry.manager).cdpAllow(
      cdpData.cdpId,
      addressRegistry.multiplyProxyActions,
      0
    );
  }

  function decreaseMultipleWithdrawDai(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  ) public {
    cdpData.ilk = IJoin(cdpData.gemJoin).ilk();

    address[] memory assets = new address[](1);
    assets[0] = DAI;

    uint256[] memory amounts = new uint256[](1);
    amounts[0] = cdpData.requiredDebt;

    uint256[] memory modes = new uint256[](1);
    modes[0] = 0;

    IManager(addressRegistry.manager).cdpAllow(
      cdpData.cdpId,
      addressRegistry.multiplyProxyActions,
      1
    );

    bytes memory paramsData = abi.encode(0, exchangeData, cdpData, addressRegistry);

    ILendingPoolV2 lendingPool = getAaveLendingPool(addressRegistry.aaveLendingPoolProvider);
    lendingPool.flashLoan(
      addressRegistry.multiplyProxyActions,
      assets,
      amounts,
      modes,
      address(this),
      paramsData,
      0
    );

    IManager(addressRegistry.manager).cdpAllow(
      cdpData.cdpId,
      addressRegistry.multiplyProxyActions,
      0
    );
  }

  function closeVaultExitGeneric(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry,
    uint8 mode
  ) private {
    cdpData.ilk = IJoin(cdpData.gemJoin).ilk();
    address urn = IManager(addressRegistry.manager).urns(cdpData.cdpId);
    address vat = IManager(addressRegistry.manager).vat();

    uint256 wadD = _getWipeAllWad(vat, urn, urn, cdpData.ilk);
    cdpData.requiredDebt = wadD;

    address[] memory assets = new address[](1);
    assets[0] = DAI;

    uint256[] memory amounts = new uint256[](1);
    amounts[0] = wadD;

    uint256[] memory modes = new uint256[](1);
    modes[0] = 0;

    bytes memory paramsData = abi.encode(mode, exchangeData, cdpData, addressRegistry);

    IManager(addressRegistry.manager).cdpAllow(
      cdpData.cdpId,
      addressRegistry.multiplyProxyActions,
      1
    );

    ILendingPoolV2 lendingPool = getAaveLendingPool(addressRegistry.aaveLendingPoolProvider);
    lendingPool.flashLoan(
      addressRegistry.multiplyProxyActions,
      assets,
      amounts,
      modes,
      address(this),
      paramsData,
      0
    );

    IManager(addressRegistry.manager).cdpAllow(
      cdpData.cdpId,
      addressRegistry.multiplyProxyActions,
      0
    );
  }

  function closeVaultExitCollateral(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  ) public {
    closeVaultExitGeneric(exchangeData, cdpData, addressRegistry, 2);
  }

  function closeVaultExitDai(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  ) public {
    closeVaultExitGeneric(exchangeData, cdpData, addressRegistry, 3);
  }

  function joinDrawDebt(
    CdpData memory cdpData,
    uint256 borrowedDai,
    address manager,
    address jug
  ) private {
    IGem gem = IJoin(cdpData.gemJoin).gem();

    uint256 balance = IERC20(address(gem)).balanceOf(address(this));
    gem.approve(address(cdpData.gemJoin), balance);
    IJoin(cdpData.gemJoin).join(IManager(manager).urns(cdpData.cdpId), balance);

    address urn = IManager(manager).urns(cdpData.cdpId);
    address vat = IManager(manager).vat();

    IManager(manager).frob(
      cdpData.cdpId,
      toInt256(convertTo18(cdpData.gemJoin, balance)),
      _getDrawDart(vat, jug, urn, cdpData.ilk, borrowedDai)
    );
    IManager(manager).move(cdpData.cdpId, address(this), borrowedDai.mul(RAY));

    IVat(vat).hope(DAIJOIN);

    IJoin(DAIJOIN).exit(address(this), borrowedDai);
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

    IDaiJoin(DAIJOIN).dai().approve(DAIJOIN, borrowedDai);
    IDaiJoin(DAIJOIN).join(urn, borrowedDai);

    uint256 wadC = convertTo18(gemJoin, collateralDraw);

    IManager(manager).frob(cdp, -toInt256(wadC), _getWipeDart(vat, IVat(vat).dai(urn), urn, ilk));

    IManager(manager).flux(cdp, address(this), wadC);
    IJoin(gemJoin).exit(address(this), collateralDraw);
  }

  function _withdrawGem(
    address gemJoin,
    address payable destination,
    uint256 amount
  ) private {
    IGem gem = IJoin(gemJoin).gem();

    if (address(gem) == WETH) {
      gem.withdraw(amount);
      destination.transfer(amount);
    } else {
      IERC20(address(gem)).transfer(destination, amount);
    }
  }

  function _increaseMP(
    ExchangeData memory exchangeData,
    CdpData memory cdpData,
    AddressRegistry memory addressRegistry,
    uint256 premium
  ) private {
    IExchange exchange = IExchange(addressRegistry.exchange);
    uint256 borrowedDai = cdpData.requiredDebt.add(premium);

    require(
      IERC20(DAI).approve(address(exchange), exchangeData.fromTokenAmount.add(cdpData.depositDai)),
      'MPA / Could not approve Exchange for DAI'
    );

    console.log('before swapDaiForToken');
    console.log('exchangeData.toTokenAddress', exchangeData.toTokenAddress);
    console.log('exchangeData.fromTokenAmount', exchangeData.fromTokenAmount);
    console.log('exchangeData.minToTokenAmount', exchangeData.minToTokenAmount);
    console.log('exchangeData.exchangeAddress', exchangeData.exchangeAddress);
    console.logBytes(exchangeData._exchangeCalldata);
    console.log('cdpData.depositDai', cdpData.depositDai);
    exchange.swapDaiForToken(
      exchangeData.toTokenAddress,
      exchangeData.fromTokenAmount.add(cdpData.depositDai),
      exchangeData.minToTokenAmount,
      exchangeData.exchangeAddress,
      exchangeData._exchangeCalldata
    );
    console.log('after swapDaiForToken');

    joinDrawDebt(cdpData, borrowedDai, addressRegistry.manager, addressRegistry.jug);

    uint256 daiLeft = IERC20(DAI).balanceOf(address(this)).sub(borrowedDai);

    if (daiLeft > 0) {
      IERC20(DAI).transfer(cdpData.fundsReceiver, daiLeft);
    }
  }

  function _decreaseMP(
    ExchangeData memory exchangeData,
    CdpData memory cdpData,
    AddressRegistry memory addressRegistry,
    uint256 premium
  ) private {
    IExchange exchange = IExchange(addressRegistry.exchange);

    wipeAndFreeGem(
      addressRegistry.manager,
      cdpData.gemJoin,
      cdpData.cdpId,
      cdpData.requiredDebt.sub(cdpData.withdrawDai),
      cdpData.borrowCollateral.add(cdpData.withdrawCollateral)
    );

    require(
      IERC20(exchangeData.fromTokenAddress).approve(
        address(exchange),
        exchangeData.fromTokenAmount
      ),
      'MPA / Could not approve Exchange for Token'
    );

    exchange.swapTokenForDai(
      exchangeData.fromTokenAddress,
      exchangeData.fromTokenAmount,
      cdpData.requiredDebt.add(premium),
      exchangeData.exchangeAddress,
      exchangeData._exchangeCalldata
    );

    uint256 daiLeft = IERC20(DAI).balanceOf(address(this)).sub(cdpData.requiredDebt.add(premium));
    uint256 collateralLeft = IERC20(exchangeData.fromTokenAddress).balanceOf(address(this));

    if (daiLeft > 0) {
      IERC20(DAI).transfer(cdpData.fundsReceiver, daiLeft);
    }
    if (collateralLeft > 0) {
      _withdrawGem(cdpData.gemJoin, cdpData.fundsReceiver, collateralLeft);
    }
  }

  function _closeWithdrawCollateral(
    ExchangeData memory exchangeData,
    CdpData memory cdpData,
    AddressRegistry memory addressRegistry,
    uint256 borrowedDaiAmount
  ) private {
    IExchange exchange = IExchange(addressRegistry.exchange);
    address gemAddress = address(IJoin(cdpData.gemJoin).gem());
    address urn = IManager(addressRegistry.manager).urns(cdpData.cdpId);
    address vat = IManager(addressRegistry.manager).vat();
    (uint256 ink, ) = IVat(vat).urns(cdpData.ilk, urn);

    wipeAndFreeGem(
      addressRegistry.manager,
      cdpData.gemJoin,
      cdpData.cdpId,
      cdpData.requiredDebt,
      ink
    );

    require(
      IERC20(exchangeData.fromTokenAddress).approve(address(exchange), ink),
      'MPA / Could not approve Exchange for Token'
    );
    exchange.swapTokenForDai(
      exchangeData.fromTokenAddress,
      exchangeData.fromTokenAmount,
      exchangeData.minToTokenAmount,
      exchangeData.exchangeAddress,
      exchangeData._exchangeCalldata
    );

    uint256 daiLeft = IERC20(DAI).balanceOf(address(this)).sub(borrowedDaiAmount);
    uint256 collateralLeft = IERC20(gemAddress).balanceOf(address(this));

    if (daiLeft > 0) {
      IERC20(DAI).transfer(cdpData.fundsReceiver, daiLeft);
    }
    if (collateralLeft > 0) {
      _withdrawGem(cdpData.gemJoin, cdpData.fundsReceiver, collateralLeft);
    }
  }

  function _closeWithdrawDai(
    ExchangeData memory exchangeData,
    CdpData memory cdpData,
    AddressRegistry memory addressRegistry,
    uint256 borrowedDaiAmount
  ) private {
    IExchange exchange = IExchange(addressRegistry.exchange);
    address gemAddress = address(IJoin(cdpData.gemJoin).gem());
    address urn = IManager(addressRegistry.manager).urns(cdpData.cdpId);
    address vat = IManager(addressRegistry.manager).vat();
    (uint256 ink, ) = IVat(vat).urns(cdpData.ilk, urn);

    wipeAndFreeGem(
      addressRegistry.manager,
      cdpData.gemJoin,
      cdpData.cdpId,
      cdpData.requiredDebt,
      ink
    );

    require(
      IERC20(exchangeData.fromTokenAddress).approve(
        address(exchange),
        IERC20(gemAddress).balanceOf(address(this))
      ),
      'MPA / Could not approve Exchange for Token'
    );
    exchange.swapTokenForDai(
      exchangeData.fromTokenAddress,
      ink,
      exchangeData.minToTokenAmount,
      exchangeData.exchangeAddress,
      exchangeData._exchangeCalldata
    );

    uint256 daiLeft = IERC20(DAI).balanceOf(address(this)).sub(borrowedDaiAmount);

    if (daiLeft > 0) {
      IERC20(DAI).transfer(cdpData.fundsReceiver, daiLeft);
    }
  }

  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
  ) external returns (bool) {
    (
      uint8 mode,
      ExchangeData memory exchangeData,
      CdpData memory cdpData,
      AddressRegistry memory addressRegistry
    ) = abi.decode(params, (uint8, ExchangeData, CdpData, AddressRegistry));
    console.log('inside flashLoan');
    uint256 borrowedDaiAmount = amounts[0].add(premiums[0]);
    emit FLData(IERC20(DAI).balanceOf(address(this)), borrowedDaiAmount);

    if (mode == 0) {
      _decreaseMP(exchangeData, cdpData, addressRegistry, premiums[0]);
    }
    if (mode == 1) {
      _increaseMP(exchangeData, cdpData, addressRegistry, premiums[0]);
    }
    if (mode == 2) {
      _closeWithdrawCollateral(exchangeData, cdpData, addressRegistry, borrowedDaiAmount);
    }
    if (mode == 3) {
      _closeWithdrawDai(exchangeData, cdpData, addressRegistry, borrowedDaiAmount);
    }

    ILendingPoolV2 lendingPool = getAaveLendingPool(addressRegistry.aaveLendingPoolProvider);

    IERC20(assets[0]).approve(address(lendingPool), borrowedDaiAmount);

    return true;
  }

  event FLData(uint256 indexed borrowed, uint256 indexed due);

  fallback() external payable {}
}
