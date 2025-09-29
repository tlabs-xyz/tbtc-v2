#!/bin/bash

# Account Control Test Runner
# Runs all tests in the test/account-control directory

set -e  # Exit on any error

echo "🧪 Running Account Control Tests..."
echo "=================================="

# Set Node.js memory options for large test suites
export NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512"

# Set environment variables for proper test execution
export USE_EXTERNAL_DEPLOY=true
export TEST_USE_STUBS_TBTC=true

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
    "test/account-control/QCRedeemerWalletObligations.core.test.ts"
    "test/account-control/QCRedeemerWalletObligations.edge.test.ts"
    "test/account-control/ReserveOracle.test.ts"
    "test/account-control/SPVLibrariesIntegration.test.ts"
    "test/account-control/SystemState.test.ts"
    "test/account-control/WatchdogEnforcer.test.ts"
)

# Check if any arguments are provided for specific test filtering
if [ $# -gt 0 ]; then
    echo "Running with filter: $@"
    echo "Node memory: ${NODE_OPTIONS}"
    echo "Environment: USE_EXTERNAL_DEPLOY=${USE_EXTERNAL_DEPLOY}, TEST_USE_STUBS_TBTC=${TEST_USE_STUBS_TBTC}"
    echo ""
    
    # Run with timeout and error handling
    timeout 3600 npx hardhat test "${TEST_FILES[@]}" "$@" || {
        EXIT_CODE=$?
        echo ""
        echo "❌ Tests failed with exit code: $EXIT_CODE"
        if [ $EXIT_CODE -eq 124 ]; then
            echo "❌ Tests timed out after 1 hour"
        elif [ $EXIT_CODE -eq 50 ]; then
            echo "❌ Exit code 50 detected - likely compilation or library linking issue"
            echo "💡 Try running: npm run clean && npm run build"
        fi
        exit $EXIT_CODE
    }
else
    echo "Running all account-control tests..."
    echo "Node memory: ${NODE_OPTIONS}"
    echo "Environment: USE_EXTERNAL_DEPLOY=${USE_EXTERNAL_DEPLOY}, TEST_USE_STUBS_TBTC=${TEST_USE_STUBS_TBTC}"
    echo ""
    
    # Run with timeout and error handling
    timeout 3600 npx hardhat test "${TEST_FILES[@]}" || {
        EXIT_CODE=$?
        echo ""
        echo "❌ Tests failed with exit code: $EXIT_CODE"
        if [ $EXIT_CODE -eq 124 ]; then
            echo "❌ Tests timed out after 1 hour"
        elif [ $EXIT_CODE -eq 50 ]; then
            echo "❌ Exit code 50 detected - likely compilation or library linking issue"
            echo "💡 Try running: npm run clean && npm run build"
        fi
        exit $EXIT_CODE
    }
fi

echo ""
echo "✅ Account Control tests completed successfully!"