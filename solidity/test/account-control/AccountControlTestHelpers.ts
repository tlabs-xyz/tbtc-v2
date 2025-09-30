/**
 * Account Control Test Helpers
 *
 * COMPATIBILITY LAYER - This file now re-exports from the new modular structure
 * Import from ./helpers/ or ./fixtures/ directly for new code
 *
 * @deprecated Use modular imports instead:
 * - import { createMockSpvData } from "./helpers/spv-data-helpers"
 * - import { bitcoinTestAddresses } from "./fixtures/test-data"
 * - import { setupTestEnvironment } from "./fixtures/base-setup"
 */

// Re-export all helpers for backward compatibility
export * from "./helpers/spv-data-helpers"
export * from "./fixtures/test-data"

// Import specific items that were exported individually
import {
  BitcoinTxInfo as _BitcoinTxInfo,
  BitcoinTxProof as _BitcoinTxProof,
  createMockSpvData as _createMockSpvData,
  createRealSpvData as _createRealSpvData,
  createMockWalletControlProof as _createMockWalletControlProof,
  setupMockRelayForSpv as _setupMockRelayForSpv,
  createCompleteSpvTestData as _createCompleteSpvTestData,
  fulfillRedemptionForTest as _fulfillRedemptionForTest,
  createMockSpvValidationResult as _createMockSpvValidationResult,
  generateTestId as _generateTestId,
} from "./helpers/spv-data-helpers"

import {
  bitcoinTestAddresses as _bitcoinTestAddresses,
  validLegacyBtc as _validLegacyBtc,
} from "./fixtures/test-data"

// Export individual items for exact backward compatibility
export type BitcoinTxInfo = _BitcoinTxInfo
export type BitcoinTxProof = _BitcoinTxProof
export const createMockSpvData = _createMockSpvData
export const createRealSpvData = _createRealSpvData
export const createMockWalletControlProof = _createMockWalletControlProof
export const setupMockRelayForSpv = _setupMockRelayForSpv
export const createCompleteSpvTestData = _createCompleteSpvTestData
export const fulfillRedemptionForTest = _fulfillRedemptionForTest
export const createMockSpvValidationResult = _createMockSpvValidationResult
export const generateTestId = _generateTestId
export const bitcoinTestAddresses = _bitcoinTestAddresses
export const validLegacyBtc = _validLegacyBtc