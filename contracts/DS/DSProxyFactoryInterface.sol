// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

import "./DSProxy.sol";

abstract contract DSProxyFactoryInterface {
    function build(address owner) public virtual returns (DSProxy proxy);
}
