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

import {IERC20} from "../interfaces/IERC20.sol";
import "../interfaces/aaveV2/ILendingPoolAddressesProviderV2.sol";
import "../interfaces/aaveV2/ILendingPoolV2.sol";
import "../utils/SafeMath.sol";
import "../interfaces/IWETH.sol";
import "../interfaces/mcd/IJoin.sol";
import "../interfaces/mcd/IManager.sol";
import "../interfaces/mcd/IVat.sol";
import "../interfaces/mcd/IJug.sol";
import "../interfaces/mcd/IDaiJoin.sol";
import "../interfaces/exchange/IExchange.sol";
import "./ExchangeData.sol";
import "./MultiplyProxyActionsBase.sol";

pragma solidity >=0.7.6;
pragma abicoder v2;

contract MultiplyProxyActionsDecrease is MultiplyProxyActionsBase {
  using SafeMath for uint256;

  function decreaseMultiple(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  ) public logMethodName("decreaseMultiple", cdpData, addressRegistry.multiplyProxyActions) {
    decreaseMultipleInternal(exchangeData, cdpData, addressRegistry);
  }

  function decreaseMultipleInternal(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  ) internal {
    cdpData.ilk = IJoin(cdpData.gemJoin).ilk();

    address[] memory assets = new address[](1);
    assets[0] = DAI;

    uint256[] memory amounts = new uint256[](1);
    amounts[0] = cdpData.requiredDebt;

    uint256[] memory modes = new uint256[](1);
    modes[0] = 0;

    if (cdpData.skipFL) {
      _decreaseMP(exchangeData, cdpData, addressRegistry, 0);
    } else {
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
  }

  function decreaseMultipleWithdrawCollateral(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  )
    public
    logMethodName(
      "decreaseMultipleWithdrawCollateral",
      cdpData,
      addressRegistry.multiplyProxyActions
    )
  {
    decreaseMultipleInternal(exchangeData, cdpData, addressRegistry);
  }

  function decreaseMultipleWithdrawDai(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  )
    public
    logMethodName("decreaseMultipleWithdrawDai", cdpData, addressRegistry.multiplyProxyActions)
  {
    decreaseMultipleInternal(exchangeData, cdpData, addressRegistry);
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
    if (cdpData.skipFL == false) {
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
    } else {
      if (mode == 2) {
        _closeWithdrawCollateralSkipFL(exchangeData, cdpData, addressRegistry);
      } else {
        require(false, "this code should be unreachable");
      }
    }
  }

  function closeVaultExitCollateral(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  )
    public
    logMethodName("closeVaultExitCollateral", cdpData, addressRegistry.multiplyProxyActions)
  {
    closeVaultExitGeneric(exchangeData, cdpData, addressRegistry, 2);
  }

  function closeVaultExitDai(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  ) public logMethodName("closeVaultExitDai", cdpData, addressRegistry.multiplyProxyActions) {
    require(cdpData.skipFL == false, "cannot close to DAI if FL not used");
    closeVaultExitGeneric(exchangeData, cdpData, addressRegistry, 3);
  }

  function _decreaseMP(
    ExchangeData memory exchangeData,
    CdpData memory cdpData,
    AddressRegistry memory addressRegistry,
    uint256 premium
  ) private {
    IExchange exchange = IExchange(addressRegistry.exchange);

    uint256 debtToBeWiped = cdpData.skipFL ? 0 : cdpData.requiredDebt.sub(cdpData.withdrawDai);

    wipeAndFreeGem(
      addressRegistry.manager,
      cdpData.gemJoin,
      cdpData.cdpId,
      debtToBeWiped,
      cdpData.borrowCollateral.add(cdpData.withdrawCollateral)
    );

    require(
      IERC20(exchangeData.fromTokenAddress).approve(
        address(exchange),
        exchangeData.fromTokenAmount
      ),
      "MPA / Could not approve Exchange for Token"
    );

    exchange.swapTokenForDai(
      exchangeData.fromTokenAddress,
      exchangeData.fromTokenAmount,
      cdpData.requiredDebt.add(premium),
      exchangeData.exchangeAddress,
      exchangeData._exchangeCalldata
    );

    uint256 collateralLeft = IERC20(exchangeData.fromTokenAddress).balanceOf(address(this));

    uint256 daiLeft = 0;
    if (cdpData.skipFL) {
      wipeAndFreeGem(
        addressRegistry.manager,
        cdpData.gemJoin,
        cdpData.cdpId,
        IERC20(DAI).balanceOf(address(this)).sub(cdpData.withdrawDai),
        0
      );
      daiLeft = cdpData.withdrawDai;
    } else {
      daiLeft = IERC20(DAI).balanceOf(address(this)).sub(cdpData.requiredDebt.add(premium));
    }
    emit MultipleActionCalled(
      cdpData.methodName,
      cdpData.cdpId,
      exchangeData.minToTokenAmount,
      exchangeData.toTokenAmount,
      collateralLeft,
      daiLeft
    );

    if (daiLeft > 0) {
      IERC20(DAI).transfer(cdpData.fundsReceiver, daiLeft);
    }
    if (collateralLeft > 0) {
      _withdrawGem(cdpData.gemJoin, cdpData.fundsReceiver, collateralLeft);
    }
  }

  function _closeWithdrawCollateralSkipFL(
    ExchangeData memory exchangeData,
    CdpData memory cdpData,
    AddressRegistry memory addressRegistry
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
      0,
      exchangeData.fromTokenAmount
    );
    require(
      IERC20(exchangeData.fromTokenAddress).approve(address(exchange), ink),
      "MPA / Could not approve Exchange for Token"
    );
    exchange.swapTokenForDai(
      exchangeData.fromTokenAddress,
      exchangeData.fromTokenAmount,
      exchangeData.minToTokenAmount,
      exchangeData.exchangeAddress,
      exchangeData._exchangeCalldata
    );

    uint256 daiLeft = IERC20(DAI).balanceOf(address(this));

    require(cdpData.requiredDebt <= daiLeft, "cannot repay all debt");
    cdpData.withdrawCollateral = convertTo18(cdpData.gemJoin, cdpData.withdrawCollateral);

    wipeAndFreeGem(
      addressRegistry.manager,
      cdpData.gemJoin,
      cdpData.cdpId,
      cdpData.requiredDebt,
      cdpData.withdrawCollateral
    );
    daiLeft = IERC20(DAI).balanceOf(address(this));

    uint256 collateralLeft = IERC20(gemAddress).balanceOf(address(this));

    if (daiLeft > 0) {
      IERC20(DAI).transfer(cdpData.fundsReceiver, daiLeft);
    }
    if (collateralLeft > 0) {
      _withdrawGem(cdpData.gemJoin, cdpData.fundsReceiver, collateralLeft);
    }
    emit MultipleActionCalled(
      cdpData.methodName,
      cdpData.cdpId,
      exchangeData.minToTokenAmount,
      exchangeData.toTokenAmount,
      collateralLeft,
      daiLeft
    );
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
      "MPA / Could not approve Exchange for Token"
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
    emit MultipleActionCalled(
      cdpData.methodName,
      cdpData.cdpId,
      exchangeData.minToTokenAmount,
      exchangeData.toTokenAmount,
      collateralLeft,
      daiLeft
    );
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
      "MPA / Could not approve Exchange for Token"
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
    uint256 collateralLeft = IERC20(gemAddress).balanceOf(address(this));
    /*
    if (collateralLeft > 0) {
      _withdrawGem(cdpData.gemJoin, cdpData.fundsReceiver, collateralLeft);
    }*/
    emit MultipleActionCalled(
      cdpData.methodName,
      cdpData.cdpId,
      exchangeData.minToTokenAmount,
      exchangeData.toTokenAmount,
      collateralLeft,
      daiLeft
    );
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
    uint256 borrowedDaiAmount = amounts[0].add(premiums[0]);
    emit FLData(IERC20(DAI).balanceOf(address(this)), borrowedDaiAmount);

    if (mode == 0) {
      _decreaseMP(exchangeData, cdpData, addressRegistry, premiums[0]);
    }
    if (mode == 1) {
      revert("incorrect MPA called call MPA increasse");
    }
    if (mode == 2) {
      _closeWithdrawCollateral(exchangeData, cdpData, addressRegistry, borrowedDaiAmount);
    }
    if (mode == 3) {
      _closeWithdrawDai(exchangeData, cdpData, addressRegistry, borrowedDaiAmount);
    }

    ILendingPoolV2 lendingPool = getAaveLendingPool(addressRegistry.aaveLendingPoolProvider);

    if (cdpData.skipFL == false) {
      IERC20(assets[0]).approve(address(lendingPool), borrowedDaiAmount);
    }

    return true;
  }
}
