#!/bin/bash

# Account Control Test Runner
# Runs all tests in the test/account-control directory

set -e  # Exit on any error

echo "🧪 Running Account Control Tests..."
echo "=================================="

# List of all account-control test files
TEST_FILES=(
    "test/account-control/AccountControlCore.test.ts"
    "test/account-control/AccountControlFeatures.test.ts"
    "test/account-control/AccountControlIntegration.test.ts"
    "test/account-control/AccountControlMintTBTC.test.ts"
    "test/account-control/AccountControlOracleIntegration.test.ts"
    "test/account-control/AccountControlSeparatedOperations.test.ts"
    "test/account-control/AccountControlValidation.test.ts"
    "test/account-control/AccountControlWorkflows.test.ts"
    "test/account-control/BitcoinAddressUtils.test.ts"
    "test/account-control/BitcoinAddressValidation.test.ts"
    "test/account-control/MockReserveIntegration.test.ts"
    "test/account-control/QCData.test.ts"
    "test/account-control/QCManagerAccountControlIntegration.test.ts"
    "test/account-control/QCManagerLib.ExtractedFunctions.test.ts"
    "test/account-control/QCManagerLib.Integration.test.ts"
    "test/account-control/QCManagerLib.test.ts"
    "test/account-control/QCManager.test.ts"
    "test/account-control/QCManagerWalletDirect.test.ts"
    "test/account-control/QCMinter.test.ts"
    "test/account-control/QCRedeemerSPV.test.ts"
    "test/account-control/QCRedeemer.test.ts"
    "test/account-control/QCRedeemerWalletObligations.edge.test.ts"
    "test/account-control/QCRedeemerWalletObligations.test.ts"
    "test/account-control/ReserveOracle.test.ts"
    "test/account-control/SPVLibrariesIntegration.test.ts"
    "test/account-control/SystemState.test.ts"
    "test/account-control/WatchdogEnforcer.test.ts"
)

# Check if any arguments are provided for specific test filtering
if [ $# -gt 0 ]; then
    echo "Running with filter: $@"
    npx hardhat test "${TEST_FILES[@]}" "$@"
else
    echo "Running all account-control tests..."
    npx hardhat test "${TEST_FILES[@]}"
fi

echo ""
echo "✅ Account Control tests completed!"