// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity >=0.7.6;
import '../interfaces/IERC20.sol';
import '../utils/SafeMath.sol';
import '../utils/SafeERC20.sol';

contract Exchange {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  address constant DAI_ADDRESS = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
  address public feeBeneficiaryAddress;
  mapping(address => bool) WHITELISTED_CALLERS;
  uint8 public fee;
  uint256 public feeBase = 10000;

  constructor(
    address authorisedCaller,
    address feeBeneficiary,
    uint8 _fee
  ) {
    WHITELISTED_CALLERS[authorisedCaller] = true;
    feeBeneficiaryAddress = feeBeneficiary;
    fee = _fee;
  }

  event AssetSwap(address assetIn, address assetOut, uint256 amountIn, uint256 amountOut);

  // Notes: So  I have to transfer the `amount` to the exchange contract, from the msg.sender
  // After that I have to setup allowance of the destination caller for fromAsset on the behalf of the exchange
  // Once I have the tokens transfers I call the aggregator with the call data
  // If the call is successful then I check if the balance for the Exchange in the toAsset has increased by the toAmount
  // If the amount has increased by `toAmount` I must send this to the msg.sender
  // In order to do that I have to call toAsset.transfer

  modifier onlyAuthorized {
    require(WHITELISTED_CALLERS[msg.sender], 'Exchange / Unauthorized Caller.'); // This will be changed to registry.isTrusty(msg.sender) or smth
    _;
  }

  function _transferIn(
    address from,
    address asset,
    uint256 amount
  ) internal {
    require(
      IERC20(asset).allowance(from, address(this)) >= amount,
      'Exchange / Not enought allowance'
    );
    IERC20(asset).safeTransferFrom(from, address(this), amount);
  }

  function _swap(
    address fromAsset,
    address toAsset,
    uint256 amount,
    uint256 receiveAtLeast,
    address callee,
    bytes calldata withData
  ) internal returns (uint256) {
    require(IERC20(fromAsset).approve(callee, amount), 'Exchange / Cannot Set Allowance to Callee');
    (bool success, ) = callee.call(withData);
    require(success, 'Exchange / Could not swap');
    uint256 balance = IERC20(toAsset).balanceOf(address(this));
    require(balance >= receiveAtLeast, 'Exchange / Received less');
    emit AssetSwap(fromAsset, toAsset, amount, balance);
    return balance;
  }

  function _collectFee(address asset, uint256 fromAmount) public returns (uint256) {
    uint256 feeToTransfer = (fromAmount.mul(fee)).div(feeBase);
    IERC20(asset).transferFrom(address(this), feeBeneficiaryAddress, feeToTransfer);
    emit FeePaid(feeToTransfer);
    return fromAmount.sub(feeToTransfer);
  }

  function _transferOut(
    address asset,
    address to,
    uint256 amount
  ) internal {
    IERC20(asset).safeTransfer(to, amount);
  }

  function swapDaiForToken(
    address asset,
    uint256 amount,
    uint256 receiveAtLeast,
    address callee,
    bytes calldata withData
  ) public onlyAuthorized {
    _transferIn(msg.sender, DAI_ADDRESS, amount);
    uint256 _amount = _collectFee(DAI_ADDRESS, amount);
    uint256 balance = _swap(DAI_ADDRESS, asset, _amount, receiveAtLeast, callee, withData);
    _transferOut(asset, msg.sender, balance);
  }

  function swapTokenForDai(
    address asset,
    uint256 amount,
    uint256 receiveAtLeast,
    address callee,
    bytes calldata withData
  ) public onlyAuthorized {
    _transferIn(msg.sender, asset, amount);
    uint256 balance = _swap(asset, DAI_ADDRESS, amount, receiveAtLeast, callee, withData);
    uint256 _balance = _collectFee(DAI_ADDRESS, balance);
    _transferOut(DAI_ADDRESS, msg.sender, _balance);
  }

  event FeePaid(uint256 amount);
}
