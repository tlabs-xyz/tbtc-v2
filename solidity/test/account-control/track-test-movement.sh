#!/bin/bash

# Script to track test movement during consolidation
# Usage: ./track-test-movement.sh <source-file> <target-file>

SOURCE_FILE=$1
TARGET_FILE=$2

if [ -z "$SOURCE_FILE" ] || [ -z "$TARGET_FILE" ]; then
    echo "Usage: $0 <source-file> <target-file>"
    echo "Example: $0 qc-redeemer-emergency-scenarios.test.ts qc-redeemer-edge-cases.test.ts"
    exit 1
fi

echo "Test Movement Tracker"
echo "===================="
echo "Source: $SOURCE_FILE"
echo "Target: $TARGET_FILE"
echo ""

# Extract test names from source
echo "Tests in source file:"
grep 'it(' "$SOURCE_FILE" 2>/dev/null | sed 's/.*it(//' | sed 's/,.*//' | nl

# Count tests
SOURCE_COUNT=$(grep -c 'it(' "$SOURCE_FILE" 2>/dev/null || echo 0)
echo ""
echo "Total tests in source: $SOURCE_COUNT"

# If target exists, show current state
if [ -f "$TARGET_FILE" ]; then
    TARGET_COUNT=$(grep -c 'it(' "$TARGET_FILE" 2>/dev/null || echo 0)
    echo "Current tests in target: $TARGET_COUNT"
    echo "Expected after merge: $((SOURCE_COUNT + TARGET_COUNT))"
fi

echo ""
echo "Describe blocks to migrate:"
grep 'describe(' "$SOURCE_FILE" 2>/dev/null | sed 's/.*describe(//' | sed 's/,.*//' | nl

# Create a migration template
echo ""
echo "Migration checklist:"
echo "-------------------"
grep 'it(' "$SOURCE_FILE" 2>/dev/null | sed 's/.*it(//' | sed 's/,.*//' | while read -r test; do
    echo "[ ] $test"
done