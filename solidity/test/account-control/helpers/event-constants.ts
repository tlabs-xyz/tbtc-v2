import { ethers } from "hardhat"

// Operation types for consolidated QCOperation events
export const QC_OPERATION_TYPES = {
  SYNC_SUCCESS: ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("SYNC_SUCCESS")
  ),
  SYNC_FAILED: ethers.utils.keccak256(ethers.utils.toUtf8Bytes("SYNC_FAILED")),
  ORACLE_FAILED: ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("ORACLE_FAILED")
  ),
  ORACLE_RECOVERED: ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("ORACLE_RECOVERED")
  ),
  FALLBACK_USED: ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("FALLBACK_USED")
  ),
  MINTING_DENIED_FALLBACK: ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("MINTING_DENIED_FALLBACK")
  ),
  STATUS_REQUEST: ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("STATUS_REQUEST")
  ),
  GRACEFUL_DEGRADATION: ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("GRACEFUL_DEGRADATION")
  ),
  ACCOUNT_CONTROL_UPDATE: ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("ACCOUNT_CONTROL_UPDATE")
  ),
}

// Balance update types
export const BALANCE_UPDATE_TYPES = {
  MINTED: ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTED")),
  RESERVE: ethers.utils.keccak256(ethers.utils.toUtf8Bytes("RESERVE")),
  CAP: ethers.utils.keccak256(ethers.utils.toUtf8Bytes("CAP")),
}

// Batch operation types
export const BATCH_OPERATION_TYPES = {
  BATCH_SYNC: ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BATCH_SYNC")),
  BATCH_HEALTH_CHECK: ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("BATCH_HEALTH_CHECK")
  ),
}

// Helper function to encode timestamp as bytes32
export function timestampToBytes32(timestamp: number): string {
  return ethers.utils.hexZeroPad(ethers.utils.hexlify(timestamp), 32)
}

// Helper function to encode address as bytes32
export function addressToBytes32(address: string): string {
  return ethers.utils.hexZeroPad(address, 32)
}

// Helper function to encode boolean as bytes32
export function booleanToBytes32(value: boolean): string {
  return ethers.utils.hexZeroPad(ethers.utils.hexlify(value ? 1 : 0), 32)
}
