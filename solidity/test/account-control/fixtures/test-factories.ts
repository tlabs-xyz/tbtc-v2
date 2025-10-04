import { ethers } from "hardhat"
import type { BigNumber } from "ethers"
import {
  SPV_CONSTANTS,
  createMockBitcoinTxInfo,
  createMockBitcoinTxProof,
} from "./test-data"
import {
  ROLES,
  BTC_ADDRESSES,
  ETH_ADDRESSES,
  AMOUNTS,
  TIMEOUTS,
} from "../../fixtures/constants"

/**
 * Advanced factory functions for creating complex test scenarios
 * These functions create complete test setups with realistic data
 */

// =============================================================================
// CONTRACT SETUP FACTORIES
// =============================================================================

/**
 * Creates a complete QC registration scenario with all required data
 */
export function createQCRegistrationScenario(
  overrides: {
    qcAddress?: string
    capacity?: BigNumber
    btcAddress?: string
    roles?: {
      governance?: string
      arbiter?: string
      registrar?: string
    }
  } = {}
) {
  return {
    qc: {
      address: overrides.qcAddress || ETH_ADDRESSES.QC_1,
      capacity: overrides.capacity || AMOUNTS.MINTING_CAP_100,
      btcAddress: overrides.btcAddress || BTC_ADDRESSES.BECH32_STANDARD,
    },
    roles: {
      governance:
        overrides.roles?.governance || ETH_ADDRESSES.QC_2,
      arbiter: overrides.roles?.arbiter || ETH_ADDRESSES.QC_3,
      registrar: overrides.roles?.registrar || ETH_ADDRESSES.QC_4,
    },
    roleHashes: {
      GOVERNANCE_ROLE: ROLES.GOVERNANCE_ROLE,
      DISPUTE_ARBITER_ROLE: ROLES.DISPUTE_ARBITER_ROLE,
      REGISTRAR_ROLE: ROLES.REGISTRAR_ROLE,
    },
  }
}

/**
 * Creates a complete minting scenario with all necessary components
 */
export function createMintingScenario(
  overrides: {
    qcAddress?: string
    userAddress?: string
    amount?: BigNumber
    btcAddress?: string
    systemState?: {
      minMintAmount?: BigNumber
      maxMintAmount?: BigNumber
      isMintingPaused?: boolean
    }
  } = {}
) {
  const amount = overrides.amount || AMOUNTS.ETH_1

  return {
    qc: {
      address: overrides.qcAddress || ETH_ADDRESSES.QC_1,
      capacity: AMOUNTS.MINTING_CAP_100,
      availableCapacity: amount.mul(2), // Ensure sufficient capacity
    },
    user: {
      address: overrides.userAddress || ETH_ADDRESSES.QC_2,
      btcAddress: overrides.btcAddress || BTC_ADDRESSES.BECH32_STANDARD,
      balance: AMOUNTS.ETH_100,
    },
    mint: {
      amount,
      expectedFee: amount.div(1000), // 0.1% fee
    },
    systemState: {
      minMintAmount:
        overrides.systemState?.minMintAmount ||
        AMOUNTS.ETH_0_001,
      maxMintAmount:
        overrides.systemState?.maxMintAmount ||
        AMOUNTS.ETH_1000000,
      isMintingPaused: overrides.systemState?.isMintingPaused || false,
    },
  }
}

/**
 * Creates a complete redemption scenario
 */
export function createRedemptionScenario(
  overrides: {
    qcAddress?: string
    userAddress?: string
    btcAddress?: string
    amount?: BigNumber
    redemptionTimeout?: number
  } = {}
) {
  const amount = overrides.amount || AMOUNTS.REDEMPTION_AMOUNT
  const redemptionId = ethers.utils.id(`redemption_${Date.now()}`)

  const scenario = {
    qc: {
      address: overrides.qcAddress || ETH_ADDRESSES.QC_1,
      mintedAmount: amount.mul(2), // QC has minted more than redemption amount
    },
    user: {
      address: overrides.userAddress || ETH_ADDRESSES.QC_2,
      btcAddress: overrides.btcAddress || BTC_ADDRESSES.BECH32_STANDARD,
      tbtcBalance: amount.mul(3), // User has enough tBTC
    },
    redemption: {
      id: redemptionId,
      amount,
      timeout:
        overrides.redemptionTimeout ||
        TIMEOUTS.REDEMPTION_TIMEOUT_DEFAULT,
      createdAt: Math.floor(Date.now() / 1000),
    },
  }

  return scenario
}

/**
 * Creates an undercollateralization scenario for watchdog testing
 */
export function createUndercollateralizationScenario(
  overrides: {
    qcAddress?: string
    reserveBalance?: BigNumber
    mintedAmount?: BigNumber
    collateralizationRatio?: number // Ratio as percentage (e.g., 90 for 90%)
  } = {}
) {
  const collateralizationRatio = overrides.collateralizationRatio || 90

  const mintedAmount =
    overrides.mintedAmount || AMOUNTS.LARGE_MINT_AMOUNT

  const reserveBalance =
    overrides.reserveBalance ||
    mintedAmount.mul(collateralizationRatio).div(100)

  return {
    qc: {
      address: overrides.qcAddress || ETH_ADDRESSES.QC_1,
      mintedAmount,
      reserveBalance,
      collateralizationRatio,
      isUndercollateralized: collateralizationRatio < 100,
    },
    watchdog: {
      address: ETH_ADDRESSES.QC_2,
      role: ROLES.ENFORCEMENT_ROLE,
    },
    action: {
      pauseRequired: collateralizationRatio < 95,
      liquidationRequired: collateralizationRatio < 80,
    },
  }
}

/**
 * Creates a reserve oracle attestation scenario
 */
export function createReserveOracleScenario(
  overrides: {
    qcAddress?: string
    attesters?: string[]
    balances?: BigNumber[]
    requiredAttestations?: number
    stalenessTimeout?: number
  } = {}
) {
  const attesters = overrides.attesters || [
    ETH_ADDRESSES.QC_1,
    ETH_ADDRESSES.QC_2,
    ETH_ADDRESSES.QC_3,
    ETH_ADDRESSES.QC_4,
  ]

  const balances = overrides.balances || [
    AMOUNTS.BALANCE_100,
    AMOUNTS.BALANCE_100,
    AMOUNTS.BALANCE_100,
    AMOUNTS.BALANCE_100,
  ]

  return {
    qc: {
      address: overrides.qcAddress || ETH_ADDRESSES.QC_5,
    },
    attesters: attesters.map((address, index) => ({
      address,
      role: ROLES.ATTESTER_ROLE,
      attestedBalance: balances[index] || AMOUNTS.BALANCE_100,
    })),
    oracle: {
      requiredAttestations: overrides.requiredAttestations || 3,
      stalenessTimeout:
        overrides.stalenessTimeout || TIMEOUTS.ATTESTATION_TIMEOUT,
    },
    expected: {
      consensusBalance: calculateMedianBalance(
        balances.slice(0, attesters.length)
      ),
      isStale: false,
    },
  }
}

/**
 * Creates a dispute scenario with arbiter resolution
 */
export function createDisputeScenario(
  overrides: {
    qcAddress?: string
    arbiterAddress?: string
    disputeReason?: string
    redemptionId?: string
    evidence?: {
      txHash?: string
      blockHeight?: number
      proof?: any
    }
  } = {}
) {
  return {
    qc: {
      address: overrides.qcAddress || ETH_ADDRESSES.QC_1,
      status: "UnderDispute",
    },
    arbiter: {
      address: overrides.arbiterAddress || ETH_ADDRESSES.QC_2,
      role: ROLES.DISPUTE_ARBITER_ROLE,
    },
    dispute: {
      reason: overrides.disputeReason || "Fraudulent redemption fulfillment",
      redemptionId:
        overrides.redemptionId || ethers.utils.id("disputed_redemption"),
      createdAt: Math.floor(Date.now() / 1000),
    },
    evidence: {
      txHash: overrides.evidence?.txHash || SPV_CONSTANTS.MOCK_TX_HASH,
      blockHeight:
        overrides.evidence?.blockHeight || SPV_CONSTANTS.TEST_BLOCK_HEIGHT,
      proof: overrides.evidence?.proof || createMockBitcoinTxProof(),
    },
  }
}

/**
 * Creates a wallet management scenario for testing wallet registration/deregistration
 */
export function createWalletManagementScenario(
  overrides: {
    qcAddress?: string
    wallets?: {
      btcAddress: string
      status?: "Active" | "Deregistered" | "Pending"
    }[]
    registrarAddress?: string
  } = {}
) {
  const defaultWallets = [
    {
      btcAddress: BTC_ADDRESSES.BECH32_STANDARD,
      status: "Active" as const,
    },
    {
      btcAddress: BTC_ADDRESSES.VALID_LEGACY_BTC,
      status: "Deregistered" as const,
    },
    {
      btcAddress: BTC_ADDRESSES.VALID_P2SH_BTC,
      status: "Pending" as const,
    },
  ]

  return {
    qc: {
      address: overrides.qcAddress || ETH_ADDRESSES.QC_1,
    },
    registrar: {
      address: overrides.registrarAddress || ETH_ADDRESSES.QC_2,
      role: ROLES.REGISTRAR_ROLE,
    },
    wallets: (overrides.wallets || defaultWallets).map((wallet) => ({
      ...wallet,
      registeredAt: Math.floor(Date.now() / 1000),
      owner: overrides.qcAddress || ETH_ADDRESSES.QC_1,
    })),
  }
}

/**
 * Creates a system state management scenario for testing pause/unpause functionality
 */
export function createSystemStateScenario(
  overrides: {
    emergencyCouncil?: string
    operationsTeam?: string
    governance?: string
    currentState?: {
      isMintingPaused?: boolean
      isRedemptionPaused?: boolean
      minMintAmount?: BigNumber
      maxMintAmount?: BigNumber
      redemptionTimeout?: number
      staleThreshold?: number
    }
    targetChanges?: {
      pauseMinting?: boolean
      pauseRedemption?: boolean
      newMinMintAmount?: BigNumber
      newMaxMintAmount?: BigNumber
      newRedemptionTimeout?: number
      newStaleThreshold?: number
    }
  } = {}
) {
  return {
    roles: {
      emergencyCouncil: {
        address: overrides.emergencyCouncil || ETH_ADDRESSES.QC_1,
        role: ROLES.EMERGENCY_ROLE,
      },
      operationsTeam: {
        address: overrides.operationsTeam || ETH_ADDRESSES.QC_2,
        role: ROLES.OPERATIONS_ROLE,
      },
      governance: {
        address: overrides.governance || ETH_ADDRESSES.QC_3,
        role: ROLES.GOVERNANCE_ROLE,
      },
    },
    currentState: {
      isMintingPaused: overrides.currentState?.isMintingPaused || false,
      isRedemptionPaused: overrides.currentState?.isRedemptionPaused || false,
      minMintAmount:
        overrides.currentState?.minMintAmount ||
        AMOUNTS.MIN_MINT_AMOUNT,
      maxMintAmount:
        overrides.currentState?.maxMintAmount ||
        AMOUNTS.MAX_MINT_AMOUNT,
      redemptionTimeout:
        overrides.currentState?.redemptionTimeout ||
        TIMEOUTS.REDEMPTION_TIMEOUT_DEFAULT,
      staleThreshold:
        overrides.currentState?.staleThreshold ||
        TIMEOUTS.STALE_THRESHOLD_DEFAULT,
    },
    targetChanges: overrides.targetChanges || {},
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculates the median balance from an array of balances
 */
function calculateMedianBalance(balances: BigNumber[]): BigNumber {
  if (balances.length === 0) return ethers.constants.Zero

  const sorted = [...balances].sort((a, b) => (a.lt(b) ? -1 : a.gt(b) ? 1 : 0))
  const mid = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 0) {
    return sorted[mid - 1].add(sorted[mid]).div(2)
  }
  return sorted[mid]
}

/**
 * Creates a batch of QC addresses for multi-QC testing scenarios
 */
export function createQCBatch(
  count: number,
  startingIndex = 1
): {
  address: string
  btcAddress: string
  capacity: BigNumber
}[] {
  const batch = []

  for (let i = 0; i < count; i++) {
    const index = startingIndex + i
    batch.push({
      address: ethers.utils.getAddress(
        `0x${index.toString().padStart(40, "0")}`
      ),
      btcAddress: `bc1qtest${index.toString().padStart(10, "0")}`,
      capacity: AMOUNTS.MINTING_CAP_100,
    })
  }

  return batch
}

/**
 * Creates time-based scenario for testing timeouts and staleness
 */
export function createTimeBasedScenario(
  overrides: {
    baseTimestamp?: number
    events?: {
      name: string
      offsetSeconds: number
      data?: any
    }[]
  } = {}
) {
  const baseTimestamp = overrides.baseTimestamp || Math.floor(Date.now() / 1000)

  const defaultEvents = [
    { name: "start", offsetSeconds: 0 },
    {
      name: "first_hour",
      offsetSeconds: TIMEOUTS.REDEMPTION_TIMEOUT_SHORT,
    },
    {
      name: "one_day",
      offsetSeconds: TIMEOUTS.REDEMPTION_TIMEOUT_TEST,
    },
    {
      name: "one_week",
      offsetSeconds: TIMEOUTS.REDEMPTION_TIMEOUT_DEFAULT,
    },
  ]

  const events = overrides.events || defaultEvents

  return {
    baseTimestamp,
    events: events.map((event) => ({
      ...event,
      timestamp: baseTimestamp + event.offsetSeconds,
    })),
    helpers: {
      advanceToEvent: (eventName: string) => {
        const event = events.find((e) => e.name === eventName)
        return event ? event.offsetSeconds : 0
      },
    },
  }
}

/**
 * Creates a comprehensive integration test scenario
 */
export function createIntegrationTestScenario(): {
  qcs: ReturnType<typeof createQCRegistrationScenario>[]
  minting: ReturnType<typeof createMintingScenario>
  redemption: ReturnType<typeof createRedemptionScenario>
  monitoring: ReturnType<typeof createUndercollateralizationScenario>
  oracle: ReturnType<typeof createReserveOracleScenario>
} {
  return {
    qcs: [
      createQCRegistrationScenario({
        qcAddress: ETH_ADDRESSES.QC_1,
      }),
      createQCRegistrationScenario({
        qcAddress: ETH_ADDRESSES.QC_2,
      }),
    ],
    minting: createMintingScenario(),
    redemption: createRedemptionScenario(),
    monitoring: createUndercollateralizationScenario(),
    oracle: createReserveOracleScenario(),
  }
}
