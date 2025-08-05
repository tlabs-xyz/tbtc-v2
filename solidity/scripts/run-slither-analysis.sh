#!/bin/bash

# Slither Static Analysis Script for V1.1/V1.2 Contracts
# Run from solidity directory

echo "=== Slither Static Analysis for Account Control Contracts ==="
echo "Date: $(date)"
echo ""

# Create output directory
mkdir -p docs/slither-reports

# List of contracts to analyze
CONTRACTS=(
    "contracts/account-control/SystemState.sol"
    "contracts/account-control/QCManager.sol"
    "contracts/account-control/QCWatchdog.sol"
    "contracts/account-control/WatchdogConsensusManager.sol"
    "contracts/account-control/WatchdogMonitor.sol"
    "contracts/account-control/QCReserveLedger.sol"
    "contracts/account-control/QCRedeemer.sol"
    "contracts/account-control/BasicMintingPolicy.sol"
    "contracts/account-control/BasicRedemptionPolicy.sol"
    "contracts/account-control/WatchdogAutomatedEnforcement.sol"
    "contracts/account-control/WatchdogThresholdActions.sol"
    "contracts/account-control/WatchdogDAOEscalation.sol"
)

# Run analysis on each contract
for contract in "${CONTRACTS[@]}"; do
    echo "Analyzing $contract..."
    contract_name=$(basename "$contract" .sol)
    
    # Run slither with different detectors
    echo "Running detectors..."
    slither "$contract" \
        --solc-remaps "@openzeppelin=node_modules/@openzeppelin" \
        --exclude naming-convention,external-function,low-level-calls \
        --print human-summary \
        > "docs/slither-reports/${contract_name}_analysis.txt" 2>&1
    
    # Check for high/medium severity issues
    echo "Checking for critical issues..."
    slither "$contract" \
        --solc-remaps "@openzeppelin=node_modules/@openzeppelin" \
        --exclude naming-convention,external-function,low-level-calls \
        --checklist \
        > "docs/slither-reports/${contract_name}_checklist.md" 2>&1
    
    echo "Completed $contract_name"
    echo ""
done

# Generate summary report
echo "Generating summary report..."
cat > docs/slither-reports/SUMMARY.md << EOF
# Slither Analysis Summary

**Date**: $(date)  
**Scope**: V1.1/V1.2 Account Control Contracts

## Analysis Results

### High Severity Issues
EOF

# Extract high severity issues
grep -h "High" docs/slither-reports/*_analysis.txt >> docs/slither-reports/SUMMARY.md 2>/dev/null || echo "None found" >> docs/slither-reports/SUMMARY.md

cat >> docs/slither-reports/SUMMARY.md << EOF

### Medium Severity Issues
EOF

# Extract medium severity issues
grep -h "Medium" docs/slither-reports/*_analysis.txt >> docs/slither-reports/SUMMARY.md 2>/dev/null || echo "None found" >> docs/slither-reports/SUMMARY.md

cat >> docs/slither-reports/SUMMARY.md << EOF

### Low Severity Issues
EOF

# Extract low severity issues
grep -h "Low" docs/slither-reports/*_analysis.txt | head -20 >> docs/slither-reports/SUMMARY.md 2>/dev/null || echo "None found" >> docs/slither-reports/SUMMARY.md

echo "" >> docs/slither-reports/SUMMARY.md
echo "See individual reports for detailed findings." >> docs/slither-reports/SUMMARY.md

echo "=== Analysis Complete ==="
echo "Reports generated in docs/slither-reports/"