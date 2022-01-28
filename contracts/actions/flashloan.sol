// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity >=0.7.6;
pragma abicoder v2;

import "./ActionBase.sol";
import { IERC20 } from "../interfaces/IERC20.sol";
import "../flash-mint/interface/IERC3156FlashBorrower.sol";
import "../flash-mint/interface/IERC3156FlashLender.sol";
import "../ServiceRegistry.sol";
import "./OperationData.sol";
import "./OperationRunner.sol";

import "hardhat/console.sol";

contract FlashLoan is ActionBase, IERC3156FlashBorrower {
  address public constant serviceRegistryAddr = 0x2B0d36FACD61B71CC05ab8F3D2355ec3631C0dd5;
  bytes32 constant FLASH_LOAN = keccak256("FLASH_LOAN");
  bytes32 constant FLASH_LOAN_LENDER = keccak256("FLASH_LOAN_LENDER");
  bytes32 constant OPERATION_RUNNER = keccak256("OPERATION_RUNNER");

  address public constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;

  function actionType() public pure override returns (uint8) {
    return uint8(ActionType.FLASHLOAN);
  }

  // beforeFlashloan
  function executeAction(bytes[] memory _callData) public payable override returns (bytes32) {
    bytes memory operation = _callData[1];
    _beforeFlashLoan(1000000, operation);
    _afterFlashLoan();
    return bytes32(0);
  }

  function _beforeFlashLoan(uint256 amount, bytes memory operation) internal {
    address flashLoanLender = ServiceRegistry(serviceRegistryAddr).getServiceAddress(
      FLASH_LOAN_LENDER
    );
    address flashLoanAction = ServiceRegistry(serviceRegistryAddr).getServiceAddress(FLASH_LOAN);

    IERC3156FlashLender(flashLoanLender).flashLoan(
      IERC3156FlashBorrower(flashLoanAction),
      DAI,
      amount,
      operation
    );
  }

  function duringFlashLoan(
    Operation memory operation,
    uint256 _amount,
    uint256 _fee
  ) public payable {
    uint256 balance = IERC20(DAI).balanceOf(address(this));

    uint256 paybackAmount = _amount + _fee; // todo: safe math
    address operationRunnerAddr = ServiceRegistry(serviceRegistryAddr).getServiceAddress(
      OPERATION_RUNNER
    );

    OperationRunner(operationRunnerAddr)._executeActionsAfterFlashLoan(
      operation,
      bytes32(paybackAmount)
    );
  }

  function _afterFlashLoan() internal {
    //Todo: revoke cdpAllow
  }

  function onFlashLoan(
    address _initiator,
    address _token,
    uint256 _amount,
    uint256 _fee,
    bytes calldata params
  ) external override returns (bytes32) {
    Operation memory operation = abi.decode(params, (Operation));

    duringFlashLoan(operation, _amount, _fee);

    return keccak256("ERC3156FlashBorrower.onFlashLoan");
  }
}
