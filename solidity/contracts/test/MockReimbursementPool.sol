// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title Minimal Mock ReimbursementPool for testing
contract MockReimbursementPool {
    mapping(address => bool) public isAuthorized;
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function authorize(address maintainer) external {
        require(msg.sender == owner, "Only owner can authorize");
        isAuthorized[maintainer] = true;
    }

    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "Only owner can transfer ownership");
        require(newOwner != address(0), "Cannot transfer to zero address");
        owner = newOwner;
    }

    function unauthorize(address maintainer) external {
        require(msg.sender == owner, "Only owner can unauthorize");
        isAuthorized[maintainer] = false;
    }

    function refund(uint256, address) external pure {
        // no-op
    }
}