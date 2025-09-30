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

# Run tests in the organized directory structure
# Find all test files in subdirectories
TEST_FILES=$(find test/account-control -name "*.test.ts" -type f | tr '\n' ' ')

# Check if any arguments are provided for specific test filtering
if [ $# -gt 0 ]; then
    echo "Running with filter: $@"
    echo "Node memory: ${NODE_OPTIONS}"
    echo "Environment: USE_EXTERNAL_DEPLOY=${USE_EXTERNAL_DEPLOY}, TEST_USE_STUBS_TBTC=${TEST_USE_STUBS_TBTC}"
    echo ""
    
    # Run with timeout and error handling using test config for unlimited contract size
    timeout 3600 npx hardhat test $TEST_FILES --config hardhat.test.config.ts "$@" || {
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
    
    # Run with timeout and error handling using test config for unlimited contract size
    timeout 3600 npx hardhat test $TEST_FILES --config hardhat.test.config.ts || {
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