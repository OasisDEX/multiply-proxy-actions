// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity >=0.7.6;
import "../interfaces/IERC20.sol";
import "../utils/SafeMath.sol";
import "../utils/SafeERC20.sol";
import "hardhat/console.sol";

contract Exchange {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  address constant DAI_ADDRESS = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
  address public feeBeneficiaryAddress;
  mapping(address => bool) public WHITELISTED_CALLERS;
  uint8 public fee;
  uint256 public constant feeBase = 10000;

  constructor(
    address authorisedCaller,
    address feeBeneficiary,
    uint8 _fee
  ) {
    WHITELISTED_CALLERS[authorisedCaller] = true;
    feeBeneficiaryAddress = feeBeneficiary;
    WHITELISTED_CALLERS[feeBeneficiary] = true;
    fee = _fee;
  }

  event AssetSwap(
    address indexed assetIn,
    address indexed assetOut,
    uint256 amountIn,
    uint256 amountOut
  );
  event FeePaid(address indexed beneficiary, uint256 amount);
  event SlippageSaved(uint256 minimumPossible, uint256 actualAmount);

  modifier onlyAuthorized() {
    require(WHITELISTED_CALLERS[msg.sender], "Exchange / Unauthorized Caller.");
    _;
  }

  function setFee(uint8 _fee) public onlyAuthorized {
    fee = _fee;
  }

  function _transferIn(
    address from,
    address asset,
    uint256 amount
  ) internal {
    require(
      IERC20(asset).allowance(from, address(this)) >= amount,
      "Exchange / Not enough allowance"
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
    IERC20(fromAsset).safeApprove(callee, amount);
    (bool success, ) = callee.call(withData);
    require(success, "Exchange / Could not swap");
    uint256 balance = IERC20(toAsset).balanceOf(address(this));
    emit SlippageSaved(receiveAtLeast, balance);
    require(balance >= receiveAtLeast, "Exchange / Received less");
    emit AssetSwap(fromAsset, toAsset, amount, balance);
    return balance;
  }

  function _collectFee(address asset, uint256 fromAmount) internal returns (uint256) {
    uint256 feeToTransfer = (fromAmount.mul(fee)).div(feeBase);
    IERC20(asset).safeTransfer(feeBeneficiaryAddress, feeToTransfer);
    emit FeePaid(feeBeneficiaryAddress, feeToTransfer);
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
  ) public {
    _transferIn(msg.sender, DAI_ADDRESS, amount);

    uint256 _amount = _collectFee(DAI_ADDRESS, amount);
    uint256 balance = _swap(DAI_ADDRESS, asset, _amount, receiveAtLeast, callee, withData);

    uint256 daiBalance = IERC20(DAI_ADDRESS).balanceOf(address(this));

    if (daiBalance > 0) {
      _transferOut(DAI_ADDRESS, msg.sender, daiBalance);
    }

    _transferOut(asset, msg.sender, balance);
  }

  function swapTokenForDai(
    address asset,
    uint256 amount,
    uint256 receiveAtLeast,
    address callee,
    bytes calldata withData
  ) public  {
    _transferIn(msg.sender, asset, amount);

    uint256 balance = _swap(asset, DAI_ADDRESS, amount, receiveAtLeast, callee, withData);
    uint256 _balance = _collectFee(DAI_ADDRESS, balance);

    uint256 assetBalance = IERC20(asset).balanceOf(address(this));

    if (assetBalance > 0) {
      _transferOut(asset, msg.sender, assetBalance);
    }

    _transferOut(DAI_ADDRESS, msg.sender, _balance);
  }
}
