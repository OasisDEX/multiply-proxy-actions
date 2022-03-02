// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity >=0.7.6;
import "../interfaces/IERC20.sol";
import "../utils/SafeMath.sol";
import "../utils/SafeERC20.sol";

contract GoerliDummyExchange {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  address DAI_ADDRESS = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
  mapping(address => bool) public WHITELISTED_CALLERS;

  uint8 slippage;

  uint8 public fee = 0;
  uint256 public feeBase = 10000;

  address public feeBeneficiaryAddress = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // second HH address

  event AssetSwap(
    address indexed assetIn,
    address indexed assetOut,
    uint256 amountIn,
    uint256 amountOut
  );

  modifier onlyAuthorized() {
    require(WHITELISTED_CALLERS[msg.sender], "Exchange / Unauthorized Caller.");
    _;
  }

  constructor(
    address _beneficiary,
    uint8 _fee,
    uint8 _slippage,
    address _dai,
    address authorisedCaller
  ) {
    feeBeneficiaryAddress = _beneficiary;
    fee = _fee;
    slippage = _slippage;
    DAI_ADDRESS = _dai;
    WHITELISTED_CALLERS[authorisedCaller] = true;
    WHITELISTED_CALLERS[_beneficiary] = true;
  }

  event FeePaid(address indexed beneficiary, uint256 amount);
  event SlippageSaved(uint256 minimumPossible, uint256 actualAmount);

  function _transferIn(
    address from,
    address asset,
    uint256 amount
  ) internal {
    require(
      IERC20(asset).allowance(from, address(this)) >= amount,
      "Exchange / Not enought allowance"
    );
    require(IERC20(asset).balanceOf(from) >= amount, "Exchange / Could not swap");
    IERC20(asset).transferFrom(from, address(this), amount);
  }

  function _transferOut(
    address asset,
    address to,
    uint256 amount
  ) internal {
    IERC20(asset).safeTransfer(to, amount);
    emit SlippageSaved(amount, amount);
  }

  function _collectFee(address asset, uint256 fromAmount) public returns (uint256) {
    uint256 feeToTransfer = fromAmount.mul(fee).div(feeBase);
    IERC20(asset).transferFrom(address(this), feeBeneficiaryAddress, feeToTransfer);
    emit FeePaid(feeBeneficiaryAddress, feeToTransfer);
    return fromAmount.sub(feeToTransfer);
  }

  // uses the same interface as default Exchange contract
  function swapDaiForToken(
    address asset,
    uint256 amount,
    uint256 receiveAtLeast,
    address, // callee
    bytes calldata // withData
  ) public onlyAuthorized {
    require(WHITELISTED_CALLERS[msg.sender], "caller-illegal");
    _transferIn(msg.sender, DAI_ADDRESS, amount);
    amount = _collectFee(DAI_ADDRESS, amount);
    uint256 amountOut = receiveAtLeast.mul(100).div(100 - slippage);
    emit AssetSwap(DAI_ADDRESS, asset, amount, amountOut);
    _transferOut(asset, msg.sender, amountOut);
  }

  // uses the same interface as default Exchange contract
  function swapTokenForDai(
    address asset,
    uint256 amount,
    uint256 receiveAtLeast,
    address, // callee
    bytes calldata // withData
  ) public onlyAuthorized {
    uint256 amountOut = receiveAtLeast.mul(100).div(100 - slippage);
    amountOut = _collectFee(DAI_ADDRESS, amountOut);
    _transferIn(msg.sender, asset, amount);
    emit AssetSwap(asset, DAI_ADDRESS, amount, amountOut);
    _transferOut(DAI_ADDRESS, msg.sender, amountOut);
  }

  //to be able to empty exchange if necessary
  function transferOut(address asset, uint256 amount) public {
    require(WHITELISTED_CALLERS[msg.sender], "caller-illegal");
    _transferOut(asset, msg.sender, amount);
  }
}
