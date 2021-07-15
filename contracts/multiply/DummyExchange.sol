// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity >=0.7.6;
import '../interfaces/IERC20.sol';
import '../utils/SafeMath.sol';
import '../utils/SafeERC20.sol';
import 'hardhat/console.sol';

contract DummyExchange {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  address DAI_ADDRESS = 0x6B175474E89094C44Da98b954EedeAC495271d0F;

  uint256 price;

  uint8 public fee = 0;
  uint256 public feeBase = 10000;

  address feeBeneficiaryAddress = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // second HH address

  function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y == 0 || (z = x * y) / y == x, 'mul-overflow');
  }

  function setPrice(uint256 p) public {
    price = p;
  }

  function setFee(uint8 f) public {
    fee = f;
  }

  function _transferIn(
    address from,
    address asset,
    uint256 amount
  ) internal {
    console.log('TRANSFER IN', asset, amount);
    require(
      IERC20(asset).allowance(from, address(this)) >= amount,
      'Exchange / Not enought allowance'
    );
    IERC20(asset).transferFrom(from, address(this), amount);
  }

  function _transferOut(
    address asset,
    address to,
    uint256 amount
  ) internal {
    IERC20(asset).safeTransfer(to, amount);
    console.log('TRANSFER OUT', asset, amount);
  }

  function _collectFee(address asset, uint256 fromAmount) public returns (uint256) {
    uint256 feeToTransfer = (fromAmount.mul(fee)).div(feeBase);
    IERC20(asset).transferFrom(address(this), feeBeneficiaryAddress, feeToTransfer);
    return fromAmount.sub(feeToTransfer);
  }

  // uses the same interface as default Exchange contract
  function swapDaiForToken(
    address asset,
    uint256 amount,
    uint256 receiveAtLeast,
    address callee,
    bytes calldata withData
  ) public {
    amount = _collectFee(DAI_ADDRESS, amount);
    uint256 amountOut = mul(amount, 10**18) / price;

    _transferIn(msg.sender, DAI_ADDRESS, amount);
    _transferOut(asset, msg.sender, amountOut);
  }

  // uses the same interface as default Exchange contract
  function swapTokenForDai(
    address asset,
    uint256 amount,
    uint256 receiveAtLeast,
    address callee,
    bytes calldata withData
  ) public {
    uint256 amountOut = mul(amount, price / 10**18);
    amountOut = _collectFee(DAI_ADDRESS, amountOut);

    _transferIn(msg.sender, asset, amount);
    _transferOut(DAI_ADDRESS, msg.sender, amountOut);
  }
}
