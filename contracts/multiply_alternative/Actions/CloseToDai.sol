pragma solidity ^0.8.1;
import "./../interfaces/ExternalInterfaces.sol";
import "./../ActionsRunner.sol";

struct ExchangeData {
  address fromTokenAddress;
  address toTokenAddress;
  uint256 fromTokenAmount;
  uint256 toTokenAmount;
  uint256 minToTokenAmount;
  address exchangeAddress;
  bytes _exchangeCalldata;
}

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

contract CloseToDai is BaseAction {
  address public immutable manager;
  address public immutable exchange;
  ServiceRegistryLike public immutable registry;

  constructor(
    address _reg,
    address _manager,
    address _exchange
  ) {
    manager = _manager;
    exchange = _exchange;
    registry = _reg;
  }

  function main(bytes calldata) external override {
    (ExchangeData memory exchangeData, CdpData memory cdpData) = abi.decode(
      params,
      (ExchangeData, CdpData)
    );

    require(
      msg.sender == address(registry.getRegisteredService("MAKER_LENDER")),
      "mpa-untrusted-lender"
    );

    uint256 borrowedDaiAmount = amount.add(fee);
    emit FLData(IERC20(DAI).balanceOf(address(this)).sub(cdpData.depositDai), borrowedDaiAmount);

    _closeWithdrawDai(exchangeData, cdpData, borrowedDaiAmount, cdpData.borrowCollateral);

    require(
      cdpData.requiredDebt.add(cdpData.depositDai) <= IERC20(DAI).balanceOf(address(this)),
      "mpa-receive-requested-amount-mismatch"
    );
  }

  function _closeWithdrawDai(
    ExchangeData memory exchangeData,
    CdpData memory cdpData,
    AddressRegistry memory addressRegistry,
    uint256 borrowedDaiAmount,
    uint256 ink
  ) private {
    IExchange exchange = IExchange(exchange);
    address gemAddress = address(IJoin(cdpData.gemJoin).gem());

    wipeAndFreeGem(manager, cdpData.gemJoin, cdpData.cdpId, cdpData.requiredDebt, ink);

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

  uint256 constant RAY = 10**27;

  /**
  TODO: This is great candidate for operation or some library
   */
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

  function beforeFlashLoan(bytes calldata data) external override returns (bytes) {
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
