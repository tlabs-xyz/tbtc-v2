import { Chains, DestinationChainInterfaces } from "../contracts"
import { SuiBitcoinDepositor } from "./bitcoin-depositor"
import { SuiTBTCToken } from "./tbtc-token"
import { SuiAddress } from "./chain-identifier"
import {
  SuiClient,
  Ed25519Keypair,
  SuiSignerWithAddress,
  SuiError,
} from "./types"

export * from "./bitcoin-depositor"
export * from "./tbtc-token"
export * from "./chain-identifier"
export * from "./extra-data-encoder"
export * from "./types"

/**
 * Loads SUI implementation of tBTC cross-chain contracts for the given SUI
 * chain ID and attaches the given signer there.
 * @param signer SUI signer (keypair or wallet adapter).
 * @param chainId SUI chain ID.
 * @returns Handle to the contracts.
 */
export async function loadSuiCrossChainInterfaces(
  signer: SuiSignerWithAddress | Ed25519Keypair,
  chainId: Chains.Sui
): Promise<DestinationChainInterfaces> {
  // Import SUI SDK with error handling
  let SuiClientClass: typeof SuiClient
  let Ed25519KeypairClass: typeof Ed25519Keypair

  try {
    const clientModule = await import("@mysten/sui/client")
    const keypairModule = await import("@mysten/sui/keypairs/ed25519")
    SuiClientClass = clientModule.SuiClient
    Ed25519KeypairClass = keypairModule.Ed25519Keypair
  } catch (error) {
    throw new SuiError(
      "Failed to load SUI SDK. Please ensure @mysten/sui is installed.",
      error
    )
  }

  // Determine network endpoint
  const networkUrl =
    chainId === Chains.Sui.Mainnet
      ? "https://fullnode.mainnet.sui.io:443"
      : chainId === Chains.Sui.Testnet
      ? "https://fullnode.testnet.sui.io:443"
      : "https://fullnode.devnet.sui.io:443"

  const client = new SuiClientClass({ url: networkUrl })

  // Warn about rate limits on public endpoints
  console.warn(
    `Using public SUI RPC endpoint (${networkUrl}). ` +
      "Public endpoints are rate-limited to 100 requests per 30 seconds. " +
      "Consider using a dedicated node or RPC service for production applications."
  )

  // Get signer address with error handling
  let signerAddress: string
  try {
    if (signer instanceof Ed25519KeypairClass) {
      signerAddress = signer.getPublicKey().toSuiAddress()
    } else if ("getAddress" in signer && signer.getAddress) {
      signerAddress = await signer.getAddress()
    } else if ("address" in signer && signer.address) {
      signerAddress = signer.address
    } else {
      throw new Error("Cannot determine signer address")
    }
  } catch (error) {
    throw new SuiError("Failed to get signer address", error)
  }

  // Ensure address is properly formatted
  if (!signerAddress.startsWith("0x")) {
    signerAddress = `0x${signerAddress}`
  }
  // Pad address to 64 characters if needed
  if (signerAddress.length < 66) {
    signerAddress = `0x${signerAddress.substring(2).padStart(64, "0")}`
  }

  // Load contract addresses from artifacts
  const artifacts = loadSuiArtifacts(chainId)

  const destinationChainBitcoinDepositor = new SuiBitcoinDepositor(
    client,
    signer as SuiSignerWithAddress,
    artifacts.packageId,
    chainId
  )
  destinationChainBitcoinDepositor.setDepositOwner(
    SuiAddress.from(signerAddress)
  )

  const destinationChainTbtcToken = new SuiTBTCToken(
    client,
    artifacts.tbtcCoinType,
    artifacts.packageId, // Use package ID as the token address
    chainId
  )

  return {
    destinationChainBitcoinDepositor,
    destinationChainTbtcToken,
  }
}

/**
 * SUI deployment artifacts.
 */
export interface SuiArtifacts {
  packageId: string
  tbtcCoinType: string
  receiverStateId: string
  gatewayStateId: string
  tokenStateId: string
}

/**
 * Loads SUI deployment artifacts for the given chain.
 * @param chainId The SUI chain ID.
 * @returns The deployment artifacts.
 */
function loadSuiArtifacts(chainId: Chains.Sui): SuiArtifacts {
  // Load from deployment details
  switch (chainId) {
    case Chains.Sui.Mainnet:
      // Check if mainnet is configured
      const {
        isMainnetConfigured,
        MAINNET_CONFIG,
      } = require("./mainnet-config")
      if (!isMainnetConfigured()) {
        throw new Error(
          "SUI mainnet configuration not available yet. " +
            "Please use testnet or wait for mainnet deployment."
        )
      }
      return MAINNET_CONFIG
    case Chains.Sui.Testnet:
      return {
        // From project deployment details
        packageId:
          "0x1db1fcdaada7c286d77f3347e593e06d8f33b8255e0861033a0a9f321f4eade7",
        tbtcCoinType:
          "0x1db1fcdaada7c286d77f3347e593e06d8f33b8255e0861033a0a9f321f4eade7::TBTC::TBTC",
        // Shared objects from deployment:
        receiverStateId:
          "0x53863ea35ecec8e66c78e389e3968ddd594d3071e94696d56685677e420e9de5",
        gatewayStateId:
          "0x4329bd8869d23c6b0e3020d74f3c1199aa7a34a45ee9d7aca496c70439220510",
        tokenStateId:
          "0x7c3ee5fb7f905dff8b70daadd953758c92b6f72ed121474c98c3129993d24e93",
      }
    case Chains.Sui.Devnet:
      // Use testnet artifacts for devnet (placeholder until devnet deployment)
      return {
        packageId:
          "0x1db1fcdaada7c286d77f3347e593e06d8f33b8255e0861033a0a9f321f4eade7",
        tbtcCoinType:
          "0x1db1fcdaada7c286d77f3347e593e06d8f33b8255e0861033a0a9f321f4eade7::TBTC::TBTC",
        receiverStateId:
          "0x53863ea35ecec8e66c78e389e3968ddd594d3071e94696d56685677e420e9de5",
        gatewayStateId:
          "0x4329bd8869d23c6b0e3020d74f3c1199aa7a34a45ee9d7aca496c70439220510",
        tokenStateId:
          "0x7c3ee5fb7f905dff8b70daadd953758c92b6f72ed121474c98c3129993d24e93",
      }
    default:
      throw new Error("Unsupported SUI network")
  }
}

// Backward compatibility alias
/**
 * @deprecated Use loadSuiCrossChainInterfaces instead
 */
export const loadSuiCrossChainContracts = loadSuiCrossChainInterfaces
