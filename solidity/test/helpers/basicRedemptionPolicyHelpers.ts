import { ethers } from "ethers"
import { BasicRedemptionPolicy } from "../../typechain"

/**
 * Test helper functions for BasicRedemptionPolicy
 * These replace the removed bulk operation function
 */

/**
 * Helper to perform bulk redemption operations using individual calls
 * Replaces the removed bulkHandleRedemptions() function
 */
export async function bulkHandleRedemptionsHelper(
  policy: BasicRedemptionPolicy,
  redemptionIds: string[],
  action: "FULFILL" | "DEFAULT",
  reason?: string
): Promise<void> {
  // Simulate the bulk operation using individual calls
  const reasonBytes32 = reason
    ? ethers.utils.id(reason)
    : ethers.constants.HashZero

  for (const redemptionId of redemptionIds) {
    try {
      if (action === "FULFILL") {
        // Note: This would require SPV proof data which isn't available in this helper
        // Individual recordFulfillment calls would be needed with proper proof data
        throw new Error(
          "Bulk fulfill requires individual recordFulfillment calls with SPV proofs"
        )
      } else if (action === "DEFAULT") {
        await policy.flagDefault(redemptionId, reasonBytes32)
      }
    } catch (error) {
      // Skip already processed redemptions (similar to original logic)
      console.log(`Skipping redemption ${redemptionId}: ${error}`)
    }
  }
}

/**
 * Helper to check if multiple redemptions are fulfilled
 */
export async function checkMultipleRedemptionsFulfilled(
  policy: BasicRedemptionPolicy,
  redemptionIds: string[]
): Promise<boolean[]> {
  const results: boolean[] = []

  for (const redemptionId of redemptionIds) {
    const isFulfilled = await policy.isRedemptionFulfilled(redemptionId)
    results.push(isFulfilled)
  }

  return results
}

/**
 * Helper to check if multiple redemptions are defaulted
 */
export async function checkMultipleRedemptionsDefaulted(
  policy: BasicRedemptionPolicy,
  redemptionIds: string[]
): Promise<Array<{ defaulted: boolean; reason: string }>> {
  const results: Array<{ defaulted: boolean; reason: string }> = []

  for (const redemptionId of redemptionIds) {
    const [defaulted, reason] = await policy.isRedemptionDefaulted(redemptionId)
    results.push({
      defaulted,
      reason: ethers.utils.parseBytes32String(reason),
    })
  }

  return results
}
