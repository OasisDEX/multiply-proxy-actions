pragma solidity ^0.8.1;
import "./interfaces/ExternalInterfaces.sol";
import "./../flash-mint/interface/IERC3156FlashBorrower.sol";
import "./../flash-mint/interface/IERC3156FlashLender.sol";


struct FlashLoanData{
    address lendedTokenAddress;
    uint256 lendedTokenAmount;
}

struct FlashLoanExecutionData {
    address caller;
    address token;
    uint256 amount;
    uint256 fee;
}


abstract contract BaseAction {
    function main(bytes calldata data, FlashLoanExecutionData memory executionData) virtual external;

    function beforeFlashLoan(bytes calldata data) virtual external returns(bytes memory);

    function afterFlashLoan(bytes calldata data) virtual external;
    
    function isFlashLoanRequired() virtual external returns(bool);
}

contract FlashLoanProvider is IERC3156FlashBorrower{

    address public immutable lender;
    address public immutable self;

    constructor(address _lender){
        lender = _lender;
        self = address(this);
    }

  function onFlashLoan(
    address caller,
    address token,
    uint256 amount,
    uint256 fee,
    bytes calldata params
  ) public override returns (bytes32) {
      (
        address action,
        bytes memory mainData
      ) = abi.decode(params, (address,  bytes ));
      BaseAction(action).main(mainData, FlashLoanExecutionData(caller, token, amount, fee));//here we do not mind  change context since we changed it anyway
  }


  function execute(address action, bytes memory actionsData) public{
    (
      FlashLoanData memory flashLoanData,
      bytes memory mainData
    ) = abi.decode(actionsData, (FlashLoanData,  bytes ));
    
    bytes memory beforeCallData = abi.encodeWithSignature("beforeFlashLoan(bytes)", mainData);
    (bool status, bytes memory step2Data) = address(action).delegatecall(beforeCallData);
    require(status, "action/beforeFlashLoan-failed");

    IERC3156FlashLender(lender).flashLoan(
      IERC3156FlashBorrower(self),
      flashLoanData.lendedTokenAddress,
      flashLoanData.lendedTokenAmount,
      abi.encode(action,step2Data)
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

    /*
    actionName - key for stored in serviceRegistry address of action implementation, for example MCLOSE_TO_DAI, GCLOSE_TO_DAI
    actionData - abi.encode(flashLoanData, mainData)
      where flashLoanData are information for flash loan about asset and amount to borrow
      where mainData is action-specific bytes used in beforeFlashLoan, main, afterFlashLoan that then Adtion internally decodes to whatever it uses
    */
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