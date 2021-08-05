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

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// WARNING: These functions meant to be used as a a library for a DSProxy. Some are unsafe if you call them directly.
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

contract MultiplyProxyActionsIncrease is MultiplyProxyActionsBase {
  using SafeMath for uint256;

  function openMultiplyVault(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  )
    public
    payable
    logMethodName("openMultiplyVault", cdpData, addressRegistry.multiplyProxyActions)
  {
    cdpData.ilk = IJoin(cdpData.gemJoin).ilk();
    cdpData.cdpId = IManager(addressRegistry.manager).open(cdpData.ilk, address(this));
    increaseMultipleDepositCollateral(exchangeData, cdpData, addressRegistry);
  }

  function increaseMultipleDepositCollateral(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  )
    public
    payable
    logMethodName(
      "increaseMultipleDepositCollateral",
      cdpData,
      addressRegistry.multiplyProxyActions
    )
  {
    IGem gem = IJoin(cdpData.gemJoin).gem();

    if (address(gem) == WETH) {
      gem.deposit{value: msg.value}();
      if (cdpData.skipFL == false) {
        gem.transfer(addressRegistry.multiplyProxyActions, msg.value);
      }
    } else {
      if (cdpData.skipFL == false) {
        gem.transferFrom(
          msg.sender,
          addressRegistry.multiplyProxyActions,
          cdpData.depositCollateral
        );
      } else {
        gem.transferFrom(msg.sender, address(this), cdpData.depositCollateral);
      }
    }
    increaseMultipleInternal(exchangeData, cdpData, addressRegistry);
  }

  function increaseMultipleDepositDai(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  )
    public
    logMethodName("increaseMultipleDepositDai", cdpData, addressRegistry.multiplyProxyActions)
  {
    if (cdpData.skipFL) {
      IERC20(DAI).transferFrom(msg.sender, address(this), cdpData.depositDai);
    } else {
      IERC20(DAI).transferFrom(
        msg.sender,
        addressRegistry.multiplyProxyActions,
        cdpData.depositDai
      );
    }
    increaseMultipleInternal(exchangeData, cdpData, addressRegistry);
  }

  function increaseMultiple(
    ExchangeData calldata exchangeData,
    CdpData memory cdpData,
    AddressRegistry calldata addressRegistry
  ) public logMethodName("increaseMultiple", cdpData, addressRegistry.multiplyProxyActions) {
    increaseMultipleInternal(exchangeData, cdpData, addressRegistry);
  }

  function increaseMultipleInternal(
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

    bytes memory paramsData = abi.encode(1, exchangeData, cdpData, addressRegistry);

    if (cdpData.skipFL) {
      //we want to draw our own DAI and use them in the exchange to buy collateral
      IGem gem = IJoin(cdpData.gemJoin).gem();
      uint256 collBalance = IERC20(address(gem)).balanceOf(address(this));
      if (collBalance > 0) {
        //if someone provided some collateral during increase
        //add it to vault and draw DAI
        joinDrawDebt(cdpData, cdpData.requiredDebt, addressRegistry.manager, addressRegistry.jug);
      } else {
        //just draw DAI
        drawDaiDebt(cdpData, addressRegistry, cdpData.requiredDebt);
      }
      _increaseMP(exchangeData, cdpData, addressRegistry, 0);
      //   bool result = this.executeOperation(assets, amounts, premiums, address(this), paramsData);
    } else {
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
  }
  
  function _increaseMP(
    ExchangeData memory exchangeData,
    CdpData memory cdpData,
    AddressRegistry memory addressRegistry,
    uint256 premium
  ) private {
    IExchange exchange = IExchange(addressRegistry.exchange);
    uint256 borrowedDai = cdpData.requiredDebt.add(premium);
    if (cdpData.skipFL) {
      borrowedDai = 0; //this DAI are not borrowed and shal not stay after this method execution
    }
    require(
      IERC20(DAI).approve(address(exchange), exchangeData.fromTokenAmount.add(cdpData.depositDai)),
      "MPA / Could not approve Exchange for DAI"
    );
    exchange.swapDaiForToken(
      exchangeData.toTokenAddress,
      exchangeData.fromTokenAmount.add(cdpData.depositDai),
      exchangeData.minToTokenAmount,
      exchangeData.exchangeAddress,
      exchangeData._exchangeCalldata
    );
    //here we add collateral we got from exchange, if skipFL then borrowedDai = 0
    joinDrawDebt(cdpData, borrowedDai, addressRegistry.manager, addressRegistry.jug);
    //if some DAI are left after exchange return them to the user
    uint256 daiLeft = IERC20(DAI).balanceOf(address(this)).sub(borrowedDai);
    emit MultipleActionCalled(
      cdpData.methodName,
      cdpData.cdpId,
      exchangeData.minToTokenAmount,
      exchangeData.toTokenAmount,
      0,
      daiLeft
    );

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
    uint256 borrowedDaiAmount = amounts[0].add(premiums[0]);
    emit FLData(IERC20(DAI).balanceOf(address(this)), borrowedDaiAmount);

    if (mode == 0) {
      revert("incorrect MPA called, call MPA Decrease");
    }
    if (mode == 1) {
      _increaseMP(exchangeData, cdpData, addressRegistry, premiums[0]);
    }
    if (mode == 2) {
      revert("incorrect MPA called, call MPA Decrease");
    }
    if (mode == 3) {
      revert("incorrect MPA called, call MPA Decrease");
    }

    ILendingPoolV2 lendingPool = getAaveLendingPool(addressRegistry.aaveLendingPoolProvider);

    if (cdpData.skipFL == false) {
      IERC20(assets[0]).approve(address(lendingPool), borrowedDaiAmount);
    }

    return true;
  }

}
