#!/bin/bash

# Account Control Test Runner with Lock File Management
# Runs tests with proper isolation to prevent lock file conflicts

set -e  # Exit on any error

echo "🔧 Running Account Control Tests (Fixed Version)..."
echo "=================================================="

# Set Node.js memory options for large test suites
export NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512"

# Set environment variables for proper test execution
export USE_EXTERNAL_DEPLOY=true
export TEST_USE_STUBS_TBTC=true

# Clean up any existing lock files before starting
echo "🧹 Cleaning up existing deployment locks..."
rm -rf .openzeppelin/
rm -rf artifacts/
rm -rf cache/

# Rebuild to ensure clean state
echo "🔄 Rebuilding contracts..."
npm run clean && npm run build

# Tests that use upgrades.deployProxy - run these sequentially to avoid lock conflicts
PROXY_DEPLOYMENT_TESTS=(
    "test/account-control/AccountControlSeparatedOperations.test.ts"
    "test/account-control/AccountControlValidation.test.ts"
    "test/account-control/AccountControlWorkflows.test.ts"
    "test/account-control/MockReserveIntegration.test.ts"
)

# Other tests that don't use upgrades.deployProxy - can run together
OTHER_TESTS=(
    "test/account-control/AccountControlCore.test.ts"
    "test/account-control/AccountControlFeatures.test.ts"
    "test/account-control/AccountControlIntegration.test.ts"
    "test/account-control/AccountControlMintTBTC.test.ts"
    "test/account-control/AccountControlOracleIntegration.test.ts"
    "test/account-control/BitcoinAddressUtils.test.ts"
    "test/account-control/BitcoinAddressValidation.test.ts"
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

echo "🔐 Running proxy deployment tests sequentially..."
echo "Node memory: ${NODE_OPTIONS}"
echo "Environment: USE_EXTERNAL_DEPLOY=${USE_EXTERNAL_DEPLOY}, TEST_USE_STUBS_TBTC=${TEST_USE_STUBS_TBTC}"
echo ""

# Run proxy deployment tests one by one to prevent lock conflicts
for test_file in "${PROXY_DEPLOYMENT_TESTS[@]}"; do
    echo "🧪 Running: $test_file"
    timeout 600 npx hardhat test "$test_file" || {
        EXIT_CODE=$?
        echo ""
        echo "❌ Test failed: $test_file (exit code: $EXIT_CODE)"
        if [ $EXIT_CODE -eq 124 ]; then
            echo "❌ Test timed out after 10 minutes"
        fi
        exit $EXIT_CODE
    }
    
    # Clean up deployment artifacts after each proxy test
    echo "🧹 Cleaning up deployment locks after $test_file..."
    rm -rf .openzeppelin/
    sleep 2  # Allow file system to settle
done

echo ""
echo "✅ Proxy deployment tests completed successfully!"
echo ""

# Check if we should run other tests (can run in parallel since they don't use upgrades)
if [ "$1" != "--proxy-only" ]; then
    echo "🚀 Running remaining tests (can run in parallel)..."
    timeout 1800 npx hardhat test "${OTHER_TESTS[@]}" || {
        EXIT_CODE=$?
        echo ""
        echo "❌ Other tests failed with exit code: $EXIT_CODE"
        if [ $EXIT_CODE -eq 124 ]; then
            echo "❌ Tests timed out after 30 minutes"
        fi
        exit $EXIT_CODE
    }
    
    echo ""
    echo "✅ All tests completed successfully!"
else
    echo "✅ Proxy-only tests completed successfully!"
fi

# Final cleanup
echo "🧹 Final cleanup..."
rm -rf .openzeppelin/

echo ""
echo "🎉 Account Control test suite completed!"
echo "==========================================="
echo ""
echo "Summary:"
echo "- Proxy deployment tests: ${#PROXY_DEPLOYMENT_TESTS[@]} (run sequentially)"
if [ "$1" != "--proxy-only" ]; then
    echo "- Other tests: ${#OTHER_TESTS[@]} (run in parallel)"
fi
echo "- Lock file conflicts: RESOLVED ✅"