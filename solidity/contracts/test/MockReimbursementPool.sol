// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/// @title Minimal Mock ReimbursementPool for testing
contract MockReimbursementPool {
    mapping(address => bool) public isAuthorized;

    function authorize(address maintainer) external {
        isAuthorized[maintainer] = true;
    }

    function unauthorize(address maintainer) external {
        isAuthorized[maintainer] = false;
    }

    function refund(uint256, address) external pure {
        // no-op
    }
}