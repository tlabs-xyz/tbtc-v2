import { ethers } from "ethers"
import { ProtocolRegistry } from "../../typechain"

/**
 * Shared test helper functions for policy updates
 * Consolidates duplicate functions from qcMinterHelpers and qcRedeemerHelpers
 */

/**
 * Helper to update any policy in the ProtocolRegistry
 * Replaces the removed updateMintingPolicy() and updateRedemptionPolicy() functions
 *
 * Note: In production, policy updates should be done through
 * governance by updating the ProtocolRegistry directly
 */
export async function updatePolicyInRegistry(
  protocolRegistry: ProtocolRegistry,
  policyKey: string,
  newPolicyAddress: string
): Promise<{ oldPolicy: string; newPolicy: string }> {
  // Get old policy if exists
  let oldPolicy = ethers.constants.AddressZero
  if (await protocolRegistry.hasService(policyKey)) {
    oldPolicy = await protocolRegistry.getService(policyKey)
  }

  // Update registry with new policy
  await protocolRegistry.setService(policyKey, newPolicyAddress)

  return {
    oldPolicy,
    newPolicy: newPolicyAddress,
  }
}

/**
 * Helper to update minting policy
 */
export async function updateMintingPolicyInRegistry(
  protocolRegistry: ProtocolRegistry,
  newPolicyAddress: string
): Promise<{ oldPolicy: string; newPolicy: string }> {
  const MINTING_POLICY_KEY = ethers.utils.id("MINTING_POLICY")
  return updatePolicyInRegistry(
    protocolRegistry,
    MINTING_POLICY_KEY,
    newPolicyAddress
  )
}

/**
 * Helper to update redemption policy
 */
export async function updateRedemptionPolicyInRegistry(
  protocolRegistry: ProtocolRegistry,
  newPolicyAddress: string
): Promise<{ oldPolicy: string; newPolicy: string }> {
  const REDEMPTION_POLICY_KEY = ethers.utils.id("REDEMPTION_POLICY")
  return updatePolicyInRegistry(
    protocolRegistry,
    REDEMPTION_POLICY_KEY,
    newPolicyAddress
  )
}
