pragma solidity ^0.8.1;
import "./interfaces/ServiceRegistryLike.sol";
import "./../flash-mint/interface/IERC3156FlashBorrower.sol";
import "./../flash-mint/interface/IERC3156FlashLender.sol";


abstract contract BaseAction {
    function main(bytes calldata data) virtual external;

    function beforeFlashLoan(bytes calldata data) virtual external;

    function afterFlashLoan(bytes calldata data) virtual external;
    
    function isFlashLoanRequired() virtual external returns(bool);
}


struct FlashLoanData{
    address lendedTokenAddress;
    uint256 lendedTokenAmount;
}

contract FlashLoanProvider is IERC3156FlashBorrower{

    address public immutable lender;
    address public immutable self;

    constructor(address _lender){
        lender = _lender;
        self = address(this);
    }

  function onFlashLoan(
    address,
    address token,
    uint256 amount,
    uint256 fee,
    bytes calldata params
  ) public override returns (bytes32) {
      (
        address action,
        bytes memory mainData
      ) = abi.decode(params, (address,  bytes ));
      BaseAction(action).main(mainData);//here we do not mind  change context since we changed it anyway
  }


  function execute(address action, bytes memory actionsData) public{
    (
      FlashLoanData memory flashLoanData,
      bytes memory mainData
    ) = abi.decode(actionsData, (FlashLoanData,  bytes ));
    
    bytes memory beforeCallData = abi.encodeWithSignature("beforeFlashLoan(bytes)", mainData);
    (bool status,) = address(action).delegatecall(beforeCallData);
    require(status, "action/beforeFlashLoan-failed");

    IERC3156FlashLender(lender).flashLoan(
      IERC3156FlashBorrower(self),
      flashLoanData.lendedTokenAddress,
      flashLoanData.lendedTokenAmount,
      abi.encode(action,mainData)
    );

    bytes memory afterCallData = abi.encodeWithSignature("afterFlashLoan(bytes)", mainData);
    (status,) = address(action).delegatecall(afterCallData);
    require(status, "action/afterFlashLoan-failed");

  }
}

contract Runner {

    ServiceRegistryLike public immutable registry;
    FlashLoanProvider public immutable flashLoanProvider;

    constructor(address _reg, address _flProvider){
        registry = ServiceRegistryLike(_reg);
        flashLoanProvider = FlashLoanProvider(_flProvider);
    }

    function executeAction(string calldata actionName, bytes calldata actionData) external{
        BaseAction action = BaseAction(registry.getRegisteredService(actionName));

        bool useFlashLoan = action.isFlashLoanRequired();
        if(useFlashLoan){
            bytes memory flashLoanCallData = abi.encodeWithSignature("execute(address,bytes)", abi.encode(address(action),actionData));
            (bool status,) = address(flashLoanProvider).delegatecall(flashLoanCallData);
            require(status, "runner/flashloan-failed");
        }else{
            bytes memory actionDelegateData = abi.encodeWithSignature("main(bytes)", actionData);
            (bool status,) = address(action).delegatecall(actionDelegateData);
            require(status, "runner/action-failed");
        }

    }

}