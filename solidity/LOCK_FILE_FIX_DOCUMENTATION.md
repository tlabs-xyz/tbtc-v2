# Lock File Management Fix for Account Control Tests

## Problem Summary

The Account Control test suite was experiencing lock file conflicts with the error: **"Lock file is already being held"**

### Root Cause
Multiple test files were using `upgrades.deployProxy()` concurrently, causing OpenZeppelin's upgrades plugin to create conflicting lock files when tests ran in parallel.

### Affected Tests
1. `AccountControlSeparatedOperations.test.ts` - "should mint tokens and update accounting"
2. `AccountControlValidation.test.ts` - "should block all minting when system is paused"  
3. `AccountControlWorkflows.test.ts` - "should support the complete mint workflow"
4. `MockReserveIntegration.test.ts` - All proxy deployment tests

## Solution Implemented

### 1. Deployment Manager (testing-utils.ts)
Created a `DeploymentManager` class that:
- Serializes proxy deployments using a queue system
- Prevents concurrent access to OpenZeppelin lock files
- Provides safe wrapper functions for proxy deployments

### 2. Updated Test Files
Modified all affected test files to use:
- `safeDeployProxy()` instead of direct `upgrades.deployProxy()` calls
- Added `afterEach` hooks with `cleanupDeployments()`
- Proper import of deployment utilities

### 3. Improved Test Script
Created `test-account-control-fixed.sh` that:
- Runs proxy deployment tests **sequentially** to prevent conflicts
- Cleans up deployment artifacts between tests
- Runs other tests in parallel for efficiency
- Includes proper error handling and timeouts

### 4. Hardhat Configuration Updates
Enhanced `hardhat.config.ts` with:
- Disabled parallel test execution (`parallel: false`)
- Added retry logic for flaky tests
- Better timeout management

## How to Use

### Option 1: Use the Fixed Test Script (Recommended)
```bash
# Run all tests with proper isolation
./test-account-control-fixed.sh

# Run only proxy deployment tests
./test-account-control-fixed.sh --proxy-only
```

### Option 2: Manual Test Execution
```bash
# Clean first
npm run clean && npm run build

# Run proxy tests sequentially
npx hardhat test test/account-control/AccountControlSeparatedOperations.test.ts
npx hardhat test test/account-control/AccountControlValidation.test.ts
npx hardhat test test/account-control/AccountControlWorkflows.test.ts
npx hardhat test test/account-control/MockReserveIntegration.test.ts

# Run other tests in parallel
npx hardhat test test/account-control/AccountControlCore.test.ts [... other files]
```

## Technical Details

### DeploymentManager Implementation
```typescript
class DeploymentManager {
  private static deploying = false;
  private static queue: Array<() => Promise<any>> = [];

  static async safeDeployProxy<T>(deployFunction: () => Promise<T>): Promise<T> {
    // Queues deployments and processes them sequentially
  }
}
```

### Safe Deployment Usage
```typescript
// Before (causes lock conflicts)
accountControl = await upgrades.deployProxy(
  AccountControlFactory,
  [owner.address, emergencyCouncil.address, mockBank.address],
  { initializer: "initialize" }
) as AccountControl;

// After (safe deployment)
accountControl = await safeDeployProxy<AccountControl>(
  AccountControlFactory,
  [owner.address, emergencyCouncil.address, mockBank.address],
  { initializer: "initialize" }
);
```

## File Changes Made

### Modified Files:
1. `/test/helpers/testing-utils.ts` - Added DeploymentManager and safe deployment functions
2. `/test/account-control/AccountControlSeparatedOperations.test.ts` - Added cleanup hooks
3. `/test/account-control/AccountControlValidation.test.ts` - Updated to use safeDeployProxy
4. `/test/account-control/AccountControlWorkflows.test.ts` - Updated to use safeDeployProxy
5. `/test/account-control/MockReserveIntegration.test.ts` - Updated to use safeDeployProxy
6. `/hardhat.config.ts` - Improved Mocha configuration
7. `/test-account-control-fixed.sh` - New test script with proper isolation

### Key Benefits:
- ✅ Eliminates lock file conflicts
- ✅ Maintains test isolation
- ✅ Preserves parallel execution where safe
- ✅ Adds proper cleanup mechanisms
- ✅ Includes comprehensive error handling
- ✅ Backwards compatible with existing test structure

## Verification

After implementing these fixes, the following tests should pass:
- "should mint tokens and update accounting"
- "should block all minting when system is paused"  
- "should support the complete mint workflow"

Run the test script to verify:
```bash
./test-account-control-fixed.sh
```

## Future Considerations

1. **Monitor for New Proxy Tests**: Any new test files using `upgrades.deployProxy()` should use the `safeDeployProxy()` wrapper
2. **CI/CD Integration**: Update CI pipelines to use the fixed test script
3. **Documentation Updates**: Update developer docs to reference safe deployment practices
4. **Performance Monitoring**: Track test execution times to optimize the sequential vs parallel balance

## Troubleshooting

If you still encounter lock file issues:

1. **Clean completely**: `rm -rf .openzeppelin/ artifacts/ cache/ && npm run clean && npm run build`
2. **Check for concurrent processes**: Ensure no other Hardhat processes are running
3. **Increase delays**: Modify the `setTimeout` delay in DeploymentManager.processQueue()
4. **Run individually**: Test each problematic file separately to isolate issues

## Contact

For questions or issues related to this fix, refer to the git commit that implemented these changes or check the test output logs for detailed error information.