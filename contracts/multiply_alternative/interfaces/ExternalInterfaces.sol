pragma solidity ^0.8.1;

abstract contract ServiceRegistryLike {
  function isTrusted(address testedAddress) external view virtual returns (bool);

  function getRegisteredService(string memory serviceName) external view virtual returns (address);
}
