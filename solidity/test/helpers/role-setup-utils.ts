import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

/**
 * Role and permission setup utilities for test environments
 * Consolidates all setup functionality for contract roles and permissions
 */

/**
 * Setup AccountControl authorization for test signers
 * This allows test signers to mint through AccountControl for testing purposes
 */
export async function setupAccountControlForTesting(
  accountControl: any,
  signers: SignerWithAddress[],
  owner?: SignerWithAddress
) {
  const ownerSigner = owner || signers[0]

  // Authorize first few test signers as reserves for testing
  for (let i = 0; i < Math.min(signers.length, 10); i++) {
    const signer = signers[i]
    try {
      // Check if already authorized to avoid double authorization
      const isAuthorized = await accountControl.authorized(signer.address)
      if (!isAuthorized) {
        await accountControl.connect(ownerSigner).authorizeReserve(
          signer.address,
          ethers.utils.parseUnits("1000", 8), // 1000 BTC cap
          1 // ReserveType.QC_PERMISSIONED
        )
        console.log(`✓ Authorized ${signer.address} in AccountControl`)
      }
    } catch (error) {
      // Ignore if already authorized or other setup issues
      if (!error.message?.includes("AlreadyAuthorized")) {
        console.log(
          `⚠️ Warning: Could not authorize ${signer.address}:`,
          error.message
        )
      }
    }
  }
}

/**
 * Setup QCManager with proper roles in QCData
 */
export async function setupQCManagerWithRoles(
  qcManager: any,
  qcData: any,
  owner: SignerWithAddress
) {
  try {
    // Grant QC_MANAGER_ROLE to QCManager in QCData
    const QC_MANAGER_ROLE = await qcData.QC_MANAGER_ROLE()
    const hasRole = await qcData.hasRole(QC_MANAGER_ROLE, qcManager.address)

    if (!hasRole) {
      await qcData.connect(owner).grantRole(QC_MANAGER_ROLE, qcManager.address)
      console.log("✓ QCManager granted QC_MANAGER_ROLE in QCData")
    }
  } catch (error) {
    console.log("⚠️ Warning: Could not setup QCManager roles:", error.message)
  }
}

/**
 * Setup QCWalletManager with proper roles
 */
export async function setupQCWalletManagerWithRoles(
  qcWalletManager: any,
  qcManager: any,
  owner: SignerWithAddress
) {
  try {
    // Grant QC_MANAGER_ROLE to QCManager in QCWalletManager
    const QC_MANAGER_ROLE = await qcWalletManager.QC_MANAGER_ROLE()

    const hasRole = await qcWalletManager.hasRole(
      QC_MANAGER_ROLE,
      qcManager.address
    )

    if (!hasRole) {
      await qcWalletManager
        .connect(owner)
        .grantRole(QC_MANAGER_ROLE, qcManager.address)
      console.log("✓ QCManager granted QC_MANAGER_ROLE in QCWalletManager")
    }
  } catch (error) {
    console.log(
      "⚠️ Warning: Could not setup QCWalletManager roles:",
      error.message
    )
  }
}

/**
 * Setup QCMinter with proper roles and permissions
 */
export async function setupQCMinterWithRoles(
  qcMinter: any,
  owner: SignerWithAddress,
  minters: SignerWithAddress[] = []
) {
  try {
    // Grant GOVERNANCE_ROLE for configuration
    const GOVERNANCE_ROLE = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("GOVERNANCE_ROLE")
    )

    const hasGovernanceRole = await qcMinter.hasRole(
      GOVERNANCE_ROLE,
      owner.address
    )

    if (!hasGovernanceRole) {
      await qcMinter.connect(owner).grantRole(GOVERNANCE_ROLE, owner.address)
      console.log("✓ GOVERNANCE_ROLE granted to owner in QCMinter")
    }

    // Grant MINTER_ROLE to designated minters
    if (minters.length > 0) {
      const MINTER_ROLE = await qcMinter.MINTER_ROLE()
      for (const minter of minters) {
        const hasMinterRole = await qcMinter.hasRole(
          MINTER_ROLE,
          minter.address
        )

        if (!hasMinterRole) {
          await qcMinter.connect(owner).grantRole(MINTER_ROLE, minter.address)
          console.log(`✓ MINTER_ROLE granted to ${minter.address} in QCMinter`)
        }
      }
    }
  } catch (error) {
    console.log("⚠️ Warning: Could not setup QCMinter roles:", error.message)
  }
}

/**
 * Setup Oracle integration with proper ownership
 */
export async function setupOracleIntegration(
  qcManager: any,
  accountControl: any,
  reserveOracle: any,
  owner: SignerWithAddress
) {
  try {
    // Set AccountControl in QCManager if not already set
    const currentAccountControl = await qcManager.accountControl()
    if (currentAccountControl === ethers.constants.AddressZero) {
      await qcManager.connect(owner).setAccountControl(accountControl.address)
      console.log("✓ AccountControl set in QCManager")
    }

    // Ensure QCManager has proper permissions on AccountControl
    const MINTER_ROLE = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("MINTER_ROLE")
    )

    const hasMinterRole = await accountControl.hasRole(
      MINTER_ROLE,
      qcManager.address
    )

    if (!hasMinterRole) {
      await accountControl
        .connect(owner)
        .grantRole(MINTER_ROLE, qcManager.address)
      console.log("✓ QCManager granted MINTER_ROLE in AccountControl")
    }
  } catch (error) {
    console.log(
      "⚠️ Warning: Could not setup Oracle integration:",
      error.message
    )
  }
}

/**
 * Setup non-SPV libraries for testing
 * Note: SPV libraries have been removed - QCRedeemer now uses trusted arbiter validation
 */
export async function setupLibrariesForTesting() {
  try {
    // Deploy BitcoinAddressUtils
    const BitcoinAddressUtilsFactory = await ethers.getContractFactory(
      "BitcoinAddressUtils"
    )

    const bitcoinAddressUtils = await BitcoinAddressUtilsFactory.deploy()
    await bitcoinAddressUtils.deployed()

    console.log("✓ Bitcoin address utilities deployed")

    return {
      bitcoinAddressUtils,
    }
  } catch (error) {
    console.log("⚠️ Error setting up libraries:", error.message)
    throw error
  }
}

/**
 * Setup AccountControl with proper ownership configuration
 */
export async function setupAccountControlWithOwnership(
  accountControl: any,
  deployer: SignerWithAddress,
  owner: SignerWithAddress,
  emergencyCouncil?: SignerWithAddress
) {
  try {
    // Check current owner
    const currentOwner = await accountControl.owner()

    // Transfer ownership from deployer to intended owner if needed
    if (
      currentOwner.toLowerCase() === deployer.address.toLowerCase() &&
      deployer.address.toLowerCase() !== owner.address.toLowerCase()
    ) {
      await accountControl.connect(deployer).transferOwnership(owner.address)
      console.log(`✓ AccountControl ownership transferred to ${owner.address}`)
    }

    // Setup emergency council if provided
    if (emergencyCouncil) {
      try {
        await accountControl
          .connect(owner)
          .updateEmergencyCouncil(emergencyCouncil.address)
        console.log(`✓ Emergency council set to ${emergencyCouncil.address}`)
      } catch (e) {
        // Method might not exist in all versions
        console.log("⚠️ updateEmergencyCouncil not available")
      }
    }
  } catch (error) {
    console.log(
      "⚠️ Warning: Could not setup AccountControl ownership:",
      error.message
    )
  }
}

/**
 * Setup SystemState with test-friendly defaults
 * This configures min/max mint amounts to prevent AmountOutsideAllowedRange errors
 */
export async function setupSystemStateDefaults(
  systemState: any,
  deployer: SignerWithAddress
) {
  try {
    // Grant OPERATIONS_ROLE to deployer for configuration
    const OPERATIONS_ROLE = await systemState.OPERATIONS_ROLE()
    const hasRole = await systemState.hasRole(OPERATIONS_ROLE, deployer.address)

    if (!hasRole) {
      await systemState.grantRole(OPERATIONS_ROLE, deployer.address)
      console.log(
        "✓ OPERATIONS_ROLE granted to deployer for SystemState configuration"
      )
    }

    // Set testing-friendly defaults for mint amounts (in wei/18 decimals for tBTC)
    await systemState
      .connect(deployer)
      .setMinMintAmount(ethers.utils.parseEther("0.001")) // 0.001 tBTC
    await systemState
      .connect(deployer)
      .setMaxMintAmount(ethers.utils.parseEther("1000")) // 1000 tBTC
    await systemState.connect(deployer).setRedemptionTimeout(48 * 60 * 60) // 48 hours

    console.log("✓ SystemState configured with test defaults")
  } catch (error) {
    console.log("⚠️ SystemState setup warning:", error.message)
  }
}

/**
 * Setup comprehensive test environment with all components
 */
export async function setupCompleteTestEnvironment(
  contracts: any,
  signers: SignerWithAddress[]
) {
  const owner = signers[0]

  try {
    // Setup SystemState configuration first
    if (contracts.systemState) {
      await setupSystemStateDefaults(contracts.systemState, owner)
    }

    // Setup AccountControl authorization
    if (contracts.accountControl) {
      await setupAccountControlForTesting(
        contracts.accountControl,
        signers,
        owner
      )
    }

    // Setup QCManager and QCData integration
    if (contracts.qcManager && contracts.qcData) {
      await setupQCManagerWithRoles(
        contracts.qcManager,
        contracts.qcData,
        owner
      )
    }

    // Setup QCWalletManager with QCManager integration
    if (contracts.qcWalletManager && contracts.qcManager) {
      await setupQCWalletManagerWithRoles(
        contracts.qcWalletManager,
        contracts.qcManager,
        owner
      )
    }

    // Setup QCMinter roles
    if (contracts.qcMinter) {
      await setupQCMinterWithRoles(
        contracts.qcMinter,
        owner,
        signers.slice(1, 4)
      )
    }

    // Setup Oracle integration
    if (
      contracts.qcManager &&
      contracts.accountControl &&
      contracts.reserveOracle
    ) {
      await setupOracleIntegration(
        contracts.qcManager,
        contracts.accountControl,
        contracts.reserveOracle,
        owner
      )
    }

    console.log("✓ Complete test environment setup completed")
  } catch (error) {
    console.log(
      "⚠️ Warning: Some test environment setup failed:",
      error.message
    )
  }
}
