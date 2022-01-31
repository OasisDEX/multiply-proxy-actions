pragma solidity ^0.8.1;

abstract contract ServiceRegistryLike {
    function isTrusted(address testedAddress) external virtual view returns (bool);
    function getRegisteredService(string memory serviceName) external virtual view returns (address) ;
}