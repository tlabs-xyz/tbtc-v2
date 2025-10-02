import { BigNumber } from "@ethersproject/bignumber"
import { ethers } from "hardhat"

/**
 * Math utilities for test environments
 * Provides common mathematical operations for blockchain testing
 */

/**
 * Convert a number to the specified precision (power of 10)
 * @param value The value to convert
 * @param precision The power of 10 (e.g., 18 for 1e18)
 * @returns BigNumber representation of value * 10^precision
 */
export function to1ePrecision(value: number, precision: number): BigNumber {
  return ethers.BigNumber.from(value).mul(
    ethers.BigNumber.from(10).pow(precision)
  )
}

/**
 * Convert number to 18 decimal precision (ETH/tBTC standard)
 */
export function to1e18(n: number): BigNumber {
  const decimalMultiplier = ethers.BigNumber.from(10).pow(18)
  return ethers.BigNumber.from(n).mul(decimalMultiplier)
}

/**
 * Convert BTC amount to satoshis (8 decimal precision)
 */
export function toSatoshis(amountInBtc: number): BigNumber {
  const decimalMultiplier = ethers.BigNumber.from(10).pow(8)
  return ethers.BigNumber.from(amountInBtc).mul(decimalMultiplier)
}

/**
 * Get timestamp for a specific block number
 */
export async function getBlockTime(blockNumber: number): Promise<number> {
  return (await ethers.provider.getBlock(blockNumber)).timestamp
}

/**
 * Remove 0x prefix from hex string
 */
export function strip0xPrefix(hexString: string): string {
  return hexString.substring(0, 2) === "0x" ? hexString.substring(2) : hexString
}

/**
 * Concatenate multiple hex strings with proper 0x prefix
 */
export function concatenateHexStrings(strs: Array<string>): string {
  let current = "0x"
  for (let i = 0; i < strs.length; i += 1) {
    current = `${current}${strip0xPrefix(strs[i])}`
  }
  return current
}
