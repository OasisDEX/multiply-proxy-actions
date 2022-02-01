pragma solidity ^0.8.1;

abstract contract IGem {
  function dec() public virtual returns (uint256);

  function gem() public virtual returns (IGem);

  function join(address, uint256) public payable virtual;

  function exit(address, uint256) public virtual;

  function approve(address, uint256) public virtual;

  function transfer(address, uint256) public virtual returns (bool);

  function transferFrom(
    address,
    address,
    uint256
  ) public virtual returns (bool);

  function deposit() public payable virtual;

  function withdraw(uint256) public virtual;

  function allowance(address, address) public virtual returns (uint256);
}

abstract contract IJoin {
  bytes32 public ilk;

  function dec() public view virtual returns (uint256);

  function gem() public view virtual returns (IGem);

  function join(address, uint256) public payable virtual;

  function exit(address, uint256) public virtual;
}

abstract contract IManager {
  function last(address) public virtual returns (uint256);

  function cdpCan(
    address,
    uint256,
    address
  ) public view virtual returns (uint256);

  function ilks(uint256) public view virtual returns (bytes32);

  function owns(uint256) public view virtual returns (address);

  function urns(uint256) public view virtual returns (address);

  function vat() public view virtual returns (address);

  function open(bytes32, address) public virtual returns (uint256);

  function give(uint256, address) public virtual;

  function cdpAllow(
    uint256,
    address,
    uint256
  ) public virtual;

  function urnAllow(address, uint256) public virtual;

  function frob(
    uint256,
    int256,
    int256
  ) public virtual;

  function flux(
    uint256,
    address,
    uint256
  ) public virtual;

  function move(
    uint256,
    address,
    uint256
  ) public virtual;

  function exit(
    address,
    uint256,
    address,
    uint256
  ) public virtual;

  function quit(uint256, address) public virtual;

  function enter(address, uint256) public virtual;

  function shift(uint256, uint256) public virtual;
}

abstract contract ServiceRegistryLike {
  function isTrusted(address testedAddress) external view virtual returns (bool);

  function getRegisteredService(string memory serviceName) external view virtual returns (address);
}

abstract contract IVat {
  struct Urn {
    uint256 ink; // Locked Collateral  [wad]
    uint256 art; // Normalised Debt    [wad]
  }

  struct Ilk {
    uint256 Art; // Total Normalised Debt     [wad]
    uint256 rate; // Accumulated Rates         [ray]
    uint256 spot; // Price with Safety Margin  [ray]
    uint256 line; // Debt Ceiling              [rad]
    uint256 dust; // Urn Debt Floor            [rad]
  }

  mapping(bytes32 => mapping(address => Urn)) public urns;
  mapping(bytes32 => Ilk) public ilks;
  mapping(bytes32 => mapping(address => uint256)) public gem; // [wad]

  function can(address, address) public view virtual returns (uint256);

  function dai(address) public view virtual returns (uint256);

  function frob(
    bytes32,
    address,
    address,
    address,
    int256,
    int256
  ) public virtual;

  function hope(address) public virtual;

  function move(
    address,
    address,
    uint256
  ) public virtual;

  function fork(
    bytes32,
    address,
    address,
    int256,
    int256
  ) public virtual;
}
