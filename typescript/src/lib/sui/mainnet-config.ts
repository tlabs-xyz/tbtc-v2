/**
 * Mainnet configuration for SUI tBTC integration.
 *
 * NOTE: This is a placeholder file. Actual mainnet configuration
 * will be added once the contracts are deployed on SUI mainnet.
 */

import { SuiArtifacts } from "./index"

/**
 * Placeholder mainnet configuration.
 * DO NOT USE IN PRODUCTION until official deployment.
 */
export const MAINNET_CONFIG: SuiArtifacts = {
  // Package ID will be provided after mainnet deployment
  packageId:
    "0x0000000000000000000000000000000000000000000000000000000000000000",

  // tBTC coin type on mainnet
  // Format: {package_id}::tbtc::TBTC
  tbtcCoinType:
    "0x0000000000000000000000000000000000000000000000000000000000000000::tbtc::TBTC",

  // Shared object IDs for mainnet
  receiverStateId:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  gatewayStateId:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  tokenStateId:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
}

/**
 * L1 Bitcoin Depositor configuration for mainnet.
 */
export const MAINNET_L1_CONFIG = {
  // Ethereum mainnet L1 Bitcoin Depositor for SUI
  // This will be deployed as BTCDepositorWormhole
  depositorAddress: "0x0000000000000000000000000000000000000000",

  // Wormhole configuration
  wormholeChainId: 21, // SUI chain ID in Wormhole
  wormholeCore: "0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B", // Mainnet Wormhole Core
  wormholeTokenBridge: "0x3ee18B2214AFF97000D974cf647E7C347E8fa585", // Mainnet Token Bridge
}

/**
 * Checks if mainnet configuration is ready for use.
 * @returns true if mainnet is configured, false otherwise
 */
export function isMainnetConfigured(): boolean {
  return (
    MAINNET_CONFIG.packageId !==
    "0x0000000000000000000000000000000000000000000000000000000000000000"
  )
}

/**
 * Configuration checklist for mainnet deployment:
 *
 * 1. Deploy Move contracts on SUI mainnet
 *    - BitcoinDepositor module
 *    - TBTC coin module
 *    - Gateway and receiver modules
 *
 * 2. Deploy L1 Bitcoin Depositor on Ethereum mainnet
 *    - BTCDepositorWormhole contract
 *    - Configure with SUI gateway address
 *    - Set Wormhole chain ID to 21
 *
 * 3. Update this file with:
 *    - Package ID from SUI deployment
 *    - Shared object IDs
 *    - L1 depositor address
 *
 * 4. Test the complete flow on mainnet
 *    - Generate deposit address
 *    - Initialize deposit on SUI
 *    - Verify relayer processing
 *    - Confirm tBTC delivery
 *
 * 5. Update documentation
 *    - Add mainnet addresses to README
 *    - Update integration guide
 *    - Add mainnet examples
 */
