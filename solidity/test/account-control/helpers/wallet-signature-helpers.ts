import { ethers } from "hardhat"
import * as secp256k1 from "secp256k1"
import { createHash } from "crypto"

/**
 * Bitcoin wallet signature helpers for testing wallet ownership verification
 * Provides real Bitcoin signature generation for testing the signature-based
 * wallet ownership verification system.
 */

export interface BitcoinKeyPair {
  privateKey: Buffer
  publicKey: Buffer
  compressedPublicKey: Buffer
  address: string
}

export interface WalletRegistrationData {
  btcAddress: string
  publicKey: Uint8Array
  signature: {
    v: number
    r: string
    s: string
  }
  challenge: string
}

/**
 * Generate a Bitcoin key pair for testing
 */
export function generateBitcoinKeyPair(): BitcoinKeyPair {
  // Generate a random 32-byte private key
  let privateKey: Buffer
  do {
    privateKey = Buffer.from(ethers.utils.randomBytes(32))
  } while (!secp256k1.privateKeyVerify(privateKey))

  // Generate the uncompressed public key (65 bytes with 0x04 prefix)
  const publicKeyFull = secp256k1.publicKeyCreate(privateKey, false)

  // Remove the 0x04 prefix to get 64 bytes (as expected by the contract)
  const publicKey = Buffer.from(publicKeyFull.slice(1))

  // Generate compressed public key for address derivation
  const compressedPublicKey = Buffer.from(
    secp256k1.publicKeyCreate(privateKey, true)
  )

  // Derive Bitcoin P2WPKH address (bech32)
  const address = deriveBitcoinAddress(compressedPublicKey)

  return {
    privateKey,
    publicKey,
    compressedPublicKey,
    address,
  }
}

/**
 * Derive Bitcoin P2WPKH (bech32) address from compressed public key
 * This matches the algorithm in QCManagerLib.sol
 */
function deriveBitcoinAddress(compressedPublicKey: Buffer): string {
  // Step 1: Hash the compressed public key (SHA256 then RIPEMD160)
  const sha256Hash = createHash("sha256").update(compressedPublicKey).digest()
  const pubKeyHash = createHash("ripemd160").update(sha256Hash).digest()

  // Step 2: Convert to bech32 format
  // This is a simplified version - in production, use a proper bech32 library
  const hrp = "bc"
  const witnessVersion = 0

  // Convert to 5-bit groups
  const values = [witnessVersion]
  const data = Array.from(pubKeyHash)

  let accumulator = 0
  let bits = 0

  for (const byte of data) {
    accumulator = (accumulator << 8) | byte
    bits += 8

    while (bits >= 5) {
      bits -= 5
      values.push((accumulator >> bits) & 0x1f)
    }
  }

  if (bits > 0) {
    values.push((accumulator << (5 - bits)) & 0x1f)
  }

  // Calculate checksum (simplified)
  const checksum = bech32Checksum(hrp, values)

  // Append checksum
  for (let i = 0; i < 6; i++) {
    values.push((checksum >> (5 * (5 - i))) & 0x1f)
  }

  // Encode
  const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
  let result = `${hrp}1`

  for (const value of values) {
    result += charset[value]
  }

  return result
}

/**
 * Simplified bech32 checksum calculation
 */
function bech32Checksum(hrp: string, values: number[]): number {
  let chk = 1

  // Process HRP
  for (let i = 0; i < hrp.length; i++) {
    chk = bech32Polymod(chk) ^ (hrp.charCodeAt(i) >> 5)
  }
  chk = bech32Polymod(chk)

  for (let i = 0; i < hrp.length; i++) {
    chk = bech32Polymod(chk) ^ (hrp.charCodeAt(i) & 0x1f)
  }

  // Process data
  for (const value of values) {
    chk = bech32Polymod(chk) ^ value
  }

  // Process 6 zeros for checksum
  for (let i = 0; i < 6; i++) {
    chk = bech32Polymod(chk)
  }

  return chk ^ 1
}

/**
 * Bech32 polymod function
 */
function bech32Polymod(pre: number): number {
  const b = pre >> 25
  let chk = (pre & 0x1ffffff) << 5

  if (b & 1) chk ^= 0x3b6a57b2
  if (b & 2) chk ^= 0x26508e6d
  if (b & 4) chk ^= 0x1ea119fa
  if (b & 8) chk ^= 0x3d4233dd
  if (b & 16) chk ^= 0x2a1462b3

  return chk
}

/**
 * Generate challenge message for direct wallet registration
 * This matches the challenge generation in QCManagerLib.sol
 */
export function generateDirectWalletChallenge(
  qcAddress: string,
  btcAddress: string,
  nonce: number
): string {
  // This matches the format in QCManagerLib.validateDirectWalletRegistration
  const challengeData = ethers.utils.solidityPack(
    ["string", "address", "string", "uint256"],
    ["TBTC_DIRECT:", qcAddress, btcAddress, nonce]
  )

  return ethers.utils.keccak256(challengeData)
}

/**
 * Generate challenge message for registrar wallet registration
 * This matches the challenge format expected by registerWallet
 */
export function generateRegistrarWalletChallenge(
  qcAddress: string,
  nonce: number
): string {
  // This matches the format in QCManager.requestWalletOwnershipVerification
  const challengeData = ethers.utils.solidityPack(
    ["string", "address", "uint256"],
    ["TBTC:", qcAddress, nonce]
  )

  return ethers.utils.keccak256(challengeData)
}

/**
 * Sign a challenge message with a Bitcoin private key
 * Returns ECDSA signature components compatible with the contract
 */
export function signChallenge(
  privateKey: Buffer,
  challengeHash: string
): { v: number; r: string; s: string } {
  // Convert challenge hash to Buffer
  const messageHash = Buffer.from(challengeHash.slice(2), "hex")

  // Sign with secp256k1
  const signature = secp256k1.ecdsaSign(messageHash, privateKey)

  // Convert to Ethereum format
  const r = `0x${Buffer.from(signature.signature.slice(0, 32)).toString("hex")}`

  const s = `0x${Buffer.from(signature.signature.slice(32, 64)).toString(
    "hex"
  )}`

  // Recovery ID (v) is typically 27 or 28 in Ethereum
  // Note: secp256k1 v4.x uses 'recid' instead of 'recovery'
  const recoveryId = signature.recid
  if (recoveryId === undefined) {
    throw new Error("Failed to get recovery ID from signature")
  }
  const v = recoveryId + 27

  return { v, r, s }
}

/**
 * Create complete wallet registration data for direct registration
 */
export function createDirectWalletRegistration(
  qcAddress: string,
  nonce: number,
  keyPair?: BitcoinKeyPair
): WalletRegistrationData {
  // Generate key pair if not provided
  if (!keyPair) {
    keyPair = generateBitcoinKeyPair()
  }

  // Generate challenge
  const challenge = generateDirectWalletChallenge(
    qcAddress,
    keyPair.address,
    nonce
  )

  // Sign challenge
  const signature = signChallenge(keyPair.privateKey, challenge)

  return {
    btcAddress: keyPair.address,
    publicKey: keyPair.publicKey,
    signature,
    challenge,
  }
}

/**
 * Create complete wallet registration data for registrar registration
 */
export function createRegistrarWalletRegistration(
  qcAddress: string,
  challengeHash: string,
  keyPair?: BitcoinKeyPair
): WalletRegistrationData {
  // Generate key pair if not provided
  if (!keyPair) {
    keyPair = generateBitcoinKeyPair()
  }

  // Sign the provided challenge
  const signature = signChallenge(keyPair.privateKey, challengeHash)

  return {
    btcAddress: keyPair.address,
    publicKey: keyPair.publicKey,
    signature,
    challenge: challengeHash,
  }
}

/**
 * Validate that a public key corresponds to a Bitcoin address
 * This can be used to verify our key generation is correct
 */
export function validateKeyPairAddress(
  publicKey: Buffer,
  expectedAddress: string
): boolean {
  // Compress the public key (add prefix based on Y coordinate parity)
  const compressed = Buffer.alloc(33)
  compressed[0] = publicKey[63] & 1 ? 0x03 : 0x02
  publicKey.slice(0, 32).copy(compressed, 1)

  // Derive address
  const derivedAddress = deriveBitcoinAddress(compressed)

  return derivedAddress === expectedAddress
}

/**
 * Pre-generated test key pairs for consistent testing
 * These can be used in tests where you need deterministic results
 */
export const TEST_KEY_PAIRS = {
  // Key pair 1
  PAIR_1: {
    privateKey: Buffer.from(
      "1111111111111111111111111111111111111111111111111111111111111111",
      "hex"
    ),
    get publicKey(): Buffer {
      return Buffer.from(
        secp256k1.publicKeyCreate(this.privateKey, false).slice(1)
      )
    },
    get compressedPublicKey(): Buffer {
      return Buffer.from(secp256k1.publicKeyCreate(this.privateKey, true))
    },
    get address(): string {
      return deriveBitcoinAddress(this.compressedPublicKey)
    },
  },

  // Key pair 2
  PAIR_2: {
    privateKey: Buffer.from(
      "2222222222222222222222222222222222222222222222222222222222222222",
      "hex"
    ),
    get publicKey(): Buffer {
      return Buffer.from(
        secp256k1.publicKeyCreate(this.privateKey, false).slice(1)
      )
    },
    get compressedPublicKey(): Buffer {
      return Buffer.from(secp256k1.publicKeyCreate(this.privateKey, true))
    },
    get address(): string {
      return deriveBitcoinAddress(this.compressedPublicKey)
    },
  },
}
