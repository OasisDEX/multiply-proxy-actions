pragma solidity ^0.8.1;
import "./MakerCalculations.sol";
import "./interfaces/ExternalInterfaces.sol";
import "./../utils/SafeMath.sol";
import "./../interfaces/IERC20.sol";
import "./../interfaces/mcd/IVat.sol";
import "./../interfaces/mcd/IManager.sol";
import "./../interfaces/mcd/IDaiJoin.sol";
import "./../interfaces/mcd/IJoin.sol";
import "./../../contracts/interfaces/exchange/IExchange.sol";

//TODO:This eventually should be library not inheritance
contract MakerTools is MakerCalculations {
  address public immutable daijoin;
  IERC20 public immutable DAI;
  using SafeMath for uint256;

  constructor(address _daiJoin, address _dai) {
    daijoin = _daiJoin;
    DAI = IERC20(_dai);
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

    IERC20(DAI).approve(daijoin, borrowedDai);
    IDaiJoin(daijoin).join(urn, borrowedDai);

    uint256 wadC = convertTo18(gemJoin, collateralDraw);

    IManager(manager).frob(cdp, -toInt256(wadC), _getWipeDart(vat, IVat(vat).dai(urn), urn, ilk));

    IManager(manager).flux(cdp, address(this), wadC);
    IJoin(gemJoin).exit(address(this), collateralDraw);
  }

}
