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

    address immutable public manager ;
    function main(bytes calldata data) override external{
    (
      uint8 mode,
      ExchangeData memory exchangeData,
      CdpData memory cdpData,
      AddressRegistry memory addressRegistry
    ) = abi.decode(params, (uint8, ExchangeData, CdpData, AddressRegistry));

    require(msg.sender == address(addressRegistry.lender), "mpa-untrusted-lender");

    uint256 borrowedDaiAmount = amount.add(fee);
    emit FLData(IERC20(DAI).balanceOf(address(this)).sub(cdpData.depositDai), borrowedDaiAmount);

    require(
      cdpData.requiredDebt.add(cdpData.depositDai) <= IERC20(DAI).balanceOf(address(this)),
      "mpa-receive-requested-amount-mismatch"
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


  function beforeFlashLoan(bytes calldata data) override external returns(bytes){
        
        (
            ExchangeData memory exchangeData,
            CdpData memory cdpData
        ) = abi.decode(data, (ExchangeData, CdpData));

        cdpData.ilk = IJoin(cdpData.gemJoin).ilk();

        address urn = IManager(manager).urns(cdpData.cdpId);
        address vat = IManager(manager).vat();

        uint256 wadD = _getWipeAllWad(vat, urn, urn, cdpData.ilk);
        cdpData.requiredDebt = wadD;

        bytes memory paramsData = abi.encode(exchangeData, cdpData);

        return paramsData;
    }

    function afterFlashLoan(bytes calldata data) override external{

    }
    
    function isFlashLoanRequired() override external pure returns(bool){
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
