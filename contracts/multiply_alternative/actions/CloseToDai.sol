pragma solidity ^0.8.1;
import "./../interfaces/ExternalInterfaces.sol";
import "./../ActionsRunner.sol";
import "./../MakerTools.sol";
import "../../multiply/ExchangeData.sol";
import "../../multiply/CdpData.sol";

contract CloseToDai is BaseAction, MakerTools  {/* MakerTools inheritance should be removed and functionality should be abstracted or as library or as operations  */
  address public immutable manager;
  address public immutable exchange;
  ServiceRegistryLike public immutable registry;
  using SafeMath for uint256;

  constructor(
    address _reg,
    address _manager,
    address _exchange,
    address _dai,
    address _dajJoin
  ) MakerTools(_dajJoin, _dai){
    manager = _manager;
    exchange = _exchange;
    registry = ServiceRegistryLike(_reg);
  }

  function main(bytes calldata params, FlashLoanExecutionData memory executionData) external override {
    (ExchangeData memory exchangeData, CdpData memory cdpData) = abi.decode(
      params,
      (ExchangeData, CdpData)
    );

    require(
      msg.sender == address(registry.getRegisteredService("MAKER_LENDER")),
      "mpa-untrusted-lender"
    );

    uint256 borrowedDaiAmount = executionData.amount.add(executionData.fee);
    emit FLData(DAI.balanceOf(address(this)).sub(cdpData.depositDai), borrowedDaiAmount);

    _closeWithdrawDai(exchangeData, cdpData, borrowedDaiAmount, cdpData.borrowCollateral);

    require(
      cdpData.requiredDebt.add(cdpData.depositDai) <= DAI.balanceOf(address(this)),
      "mpa-receive-requested-amount-mismatch"
    );
  }

  function _closeWithdrawDai(
    ExchangeData memory exchangeData,
    CdpData memory cdpData,
    uint256 borrowedDaiAmount,
    uint256 ink
  ) private {
    IExchange exchangeInstance = IExchange(exchange);
    address gemAddress = address(IJoin(cdpData.gemJoin).gem());

    wipeAndFreeGem(manager, cdpData.gemJoin, cdpData.cdpId, cdpData.requiredDebt, ink);

    require(
      IERC20(exchangeData.fromTokenAddress).approve(
        address(exchange),
        IERC20(gemAddress).balanceOf(address(this))
      ),
      "MPA / Could not approve Exchange for Token"
    );

    exchangeInstance.swapTokenForDai(
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

  function beforeFlashLoan(bytes calldata data) external override returns (bytes memory) {
    (ExchangeData memory exchangeData, CdpData memory cdpData) = abi.decode(
      data,
      (ExchangeData, CdpData)
    );

    cdpData.ilk = IJoin(cdpData.gemJoin).ilk();

    address urn = IManager(manager).urns(cdpData.cdpId);
    address vat = IManager(manager).vat();

    uint256 wadD = _getWipeAllWad(vat, urn, urn, cdpData.ilk);
    cdpData.requiredDebt = wadD;

    bytes memory paramsData = abi.encode(exchangeData, cdpData);

    return paramsData;
  }

  function afterFlashLoan(bytes calldata data) external override {
    (ExchangeData memory exchangeData, CdpData memory cdpData) = abi.decode(
      data,
      (ExchangeData, CdpData)
    );
    IManager(manager).cdpAllow(cdpData.cdpId, registry.getRegisteredService("ACTION_RUNNER"), 0);
  }

  function isFlashLoanRequired() external pure override returns (bool) {
    return true;
  }

  event FLData(uint256 borrowed, uint256 due);
  event MultipleActionCalled(
    string methodName,
    uint256 indexed cdpId,
    uint256 swapMinAmount,
    uint256 swapOptimistAmount,
    uint256 collateralLeft,
    uint256 daiLeft
  );
}
