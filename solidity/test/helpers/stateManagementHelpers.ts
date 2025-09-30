import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

/**
 * State Management Helpers for Test Isolation
 *
 * These helpers address the state contamination issues identified in Phase 2 analysis:
 * - Oracle attestation states not reset between tests
 * - Reserve authorization states carrying over
 * - AccountControl proxy deployment state persistence
 * - Mock contract states accumulating
 */

/**
 * Reset AccountControl state for clean test isolation
 * This addresses ownership transfer and authorization state issues
 */
export async function resetAccountControlState(
  accountControl: any,
  owner: SignerWithAddress,
  emergencyCouncil: SignerWithAddress,
  mockBank: any
) {
  try {
    const currentOwner = await accountControl.owner();

    // Reset ownership to original owner if it was transferred
    if (currentOwner.toLowerCase() !== owner.address.toLowerCase()) {
      // Get the current owner signer to transfer back
      const currentOwnerSigner = await ethers.getSigner(currentOwner);
      await accountControl.connect(currentOwnerSigner).transferOwnership(owner.address);
      // console.log(`🔄 Reset AccountControl ownership from ${currentOwner} to ${owner.address}`);
    }

    // Clear all existing reserve authorizations to start fresh
    // NOTE: We can't easily get all authorized addresses, so we'll clear known test addresses
    const signers = await ethers.getSigners();
    for (let i = 0; i < Math.min(signers.length, 10); i++) {
      try {
        const isAuthorized = await accountControl.authorized(signers[i].address);
        if (isAuthorized) {
          await accountControl.connect(owner).deauthorizeReserve(signers[i].address);
          // console.log(`🔄 Deauthorized ${signers[i].address} in AccountControl`);
        }
      } catch (error) {
        // Ignore errors for reserves with outstanding balances
        if (!error.message?.includes("OutstandingBalance")) {
          // console.log(`⚠️ Could not deauthorize ${signers[i].address}:`, error.message);
        }
      }
    }

    // Reset emergency council if changed
    try {
      const currentEmergencyCouncil = await accountControl.emergencyCouncil();
      if (currentEmergencyCouncil.toLowerCase() !== emergencyCouncil.address.toLowerCase()) {
        await accountControl.connect(owner).updateEmergencyCouncil(emergencyCouncil.address);
        // console.log(`🔄 Reset emergency council to ${emergencyCouncil.address}`);
      }
    } catch (error) {
      // Method might not exist in all versions
      // console.log("⚠️ updateEmergencyCouncil not available");
    }

    // Reset system pause state
    try {
      const isPaused = await accountControl.systemPaused();
      if (isPaused) {
        await accountControl.connect(emergencyCouncil).unpauseSystem();
        // console.log("🔄 Unpaused AccountControl system");
      }
    } catch (error) {
      // console.log("⚠️ Could not reset pause state:", error.message);
    }

    // console.log("✅ AccountControl state reset completed");
  } catch (error) {
    // console.log("⚠️ AccountControl state reset failed:", error.message);
  }
}

/**
 * Reset QCData state for clean test isolation
 * Clears QC registrations and wallet associations
 */
export async function resetQCDataState(
  qcData: any,
  owner: SignerWithAddress
) {
  try {
    // We can't easily iterate through all QCs, so we'll reset known test QCs
    const signers = await ethers.getSigners();

    for (let i = 0; i < Math.min(signers.length, 10); i++) {
      try {
        const isRegistered = await qcData.isQCRegistered(signers[i].address);
        if (isRegistered) {
          // Set status to revoked to clean up the registration
          await qcData.connect(owner).setQCStatus(
            signers[i].address,
            4, // Revoked status
            ethers.utils.formatBytes32String("Test cleanup")
          );
          // console.log(`🔄 Revoked QC ${signers[i].address} in QCData`);
        }
      } catch (error) {
        // console.log(`⚠️ Could not reset QC ${signers[i].address}:`, error.message);
      }
    }

    // console.log("✅ QCData state reset completed");
  } catch (error) {
    // console.log("⚠️ QCData state reset failed:", error.message);
  }
}

/**
 * Reset Oracle attestation state for clean test isolation
 * Clears stale attestations that persist between tests
 */
export async function resetOracleState(
  reserveOracle: any,
  systemState: any,
  owner: SignerWithAddress
) {
  try {
    // Clear attestations for known test QCs
    const signers = await ethers.getSigners();

    for (let i = 0; i < Math.min(signers.length, 10); i++) {
      try {
        const attestation = await reserveOracle.getCurrentAttestation(signers[i].address);
        if (attestation.isValid && !attestation.timestamp.eq(0)) {
          // Submit a zero attestation to clear the state
          await reserveOracle.connect(owner).submitAttestation(
            signers[i].address,
            0, // Zero balance
            0, // Zero timestamp effectively invalidates
            ethers.utils.formatBytes32String("test-cleanup")
          );
          // console.log(`🔄 Cleared oracle attestation for ${signers[i].address}`);
        }
      } catch (error) {
        // console.log(`⚠️ Could not clear attestation for ${signers[i].address}:`, error.message);
      }
    }

    // console.log("✅ Oracle state reset completed");
  } catch (error) {
    // console.log("⚠️ Oracle state reset failed:", error.message);
  }
}

/**
 * Reset QCManager state for clean test isolation
 * Addresses role and permission contamination
 */
export async function resetQCManagerState(
  qcManager: any,
  owner: SignerWithAddress,
  defaultRoles: { [roleName: string]: string }
) {
  try {
    // Reset AccountControl reference if it was set
    try {
      const currentAccountControl = await qcManager.accountControl();
      if (currentAccountControl !== ethers.constants.AddressZero) {
        await qcManager.connect(owner).setAccountControl(ethers.constants.AddressZero);
        // console.log("🔄 Reset AccountControl reference in QCManager");
      }
    } catch (error) {
      // console.log("⚠️ Could not reset AccountControl reference:", error.message);
    }

    // Reset QCRedeemer reference if it was set
    try {
      await qcManager.connect(owner).setQCRedeemer(ethers.constants.AddressZero);
      // console.log("🔄 Reset QCRedeemer reference in QCManager");
    } catch (error) {
      // console.log("⚠️ Could not reset QCRedeemer reference:", error.message);
    }

    // console.log("✅ QCManager state reset completed");
  } catch (error) {
    // console.log("⚠️ QCManager state reset failed:", error.message);
  }
}

/**
 * Reset mock contract states to prevent cross-test contamination
 * Addresses accumulated mock expectations and return values
 */
export async function resetMockContractStates(mocks: { [name: string]: any }) {
  try {
    for (const [name, mock] of Object.entries(mocks)) {
      if (mock && typeof mock.reset === 'function') {
        mock.reset();
        // console.log(`🔄 Reset mock ${name}`);
      }
    }
    // console.log("✅ Mock contract states reset completed");
  } catch (error) {
    // console.log("⚠️ Mock state reset failed:", error.message);
  }
}

/**
 * Comprehensive state reset for test isolation
 * Use this in beforeEach hooks to ensure clean test state
 */
export async function resetAllTestState(
  contracts: {
    accountControl?: any;
    qcData?: any;
    qcManager?: any;
    reserveOracle?: any;
    systemState?: any;
  },
  signers: {
    owner: SignerWithAddress;
    emergencyCouncil: SignerWithAddress;
  },
  mocks: { [name: string]: any } = {},
  options: {
    resetAccountControl?: boolean;
    resetQCData?: boolean;
    resetOracle?: boolean;
    resetQCManager?: boolean;
    resetMocks?: boolean;
  } = {}
) {
  const {
    resetAccountControl = true,
    resetQCData = true,
    resetOracle = true,
    resetQCManager = true,
    resetMocks = true,
  } = options;

  // console.log("🔄 Starting comprehensive test state reset...");

  try {
    // Reset in dependency order (most dependent first)
    if (resetMocks && Object.keys(mocks).length > 0) {
      await resetMockContractStates(mocks);
    }

    if (resetQCManager && contracts.qcManager) {
      await resetQCManagerState(contracts.qcManager, signers.owner, {});
    }

    if (resetOracle && contracts.reserveOracle && contracts.systemState) {
      await resetOracleState(contracts.reserveOracle, contracts.systemState, signers.owner);
    }

    if (resetQCData && contracts.qcData) {
      await resetQCDataState(contracts.qcData, signers.owner);
    }

    if (resetAccountControl && contracts.accountControl) {
      await resetAccountControlState(
        contracts.accountControl,
        signers.owner,
        signers.emergencyCouncil,
        null // mockBank can be null for reset
      );
    }

    // console.log("✅ Comprehensive test state reset completed successfully");
  } catch (error) {
    // console.log("⚠️ Comprehensive test state reset encountered errors:", error.message);
  }
}

/**
 * Enhanced beforeEach helper that combines snapshots with state reset
 * Use this to replace standard beforeEach in tests with state issues
 */
export async function createEnhancedSnapshot(
  contracts: any,
  signers: any,
  mocks: any = {},
  useStateReset: boolean = true
) {
  // Create Hardhat snapshot first
  const { createSnapshot } = await import("hardhat").then(hh => hh.helpers.snapshot);
  await createSnapshot();

  // Optionally perform additional state reset
  if (useStateReset) {
    await resetAllTestState(contracts, signers, mocks);
  }
}

/**
 * Enhanced afterEach helper for state cleanup
 */
export async function restoreEnhancedSnapshot() {
  const { restoreSnapshot } = await import("hardhat").then(hh => hh.helpers.snapshot);
  await restoreSnapshot();
}

/**
 * Verify clean state helper - use to debug state contamination
 */
export async function verifyCleanTestState(contracts: any): Promise<boolean> {
  const issues: string[] = [];

  try {
    // Check AccountControl ownership
    if (contracts.accountControl) {
      const owner = await contracts.accountControl.owner();
      const signers = await ethers.getSigners();
      if (owner.toLowerCase() !== signers[0].address.toLowerCase()) {
        issues.push(`AccountControl owner is ${owner}, expected ${signers[0].address}`);
      }
    }

    // Check QCManager AccountControl reference
    if (contracts.qcManager) {
      const accountControl = await contracts.qcManager.accountControl();
      if (accountControl !== ethers.constants.AddressZero && !contracts.accountControl) {
        issues.push(`QCManager has AccountControl reference but test doesn't expect it`);
      }
    }

    if (issues.length > 0) {
      // console.log("🚨 State contamination detected:");
      issues.forEach(issue => // console.log(`  - ${issue}`));
      return false;
    }

    // console.log("✅ Test state is clean");
    return true;
  } catch (error) {
    // console.log("⚠️ Could not verify test state:", error.message);
    return false;
  }
}