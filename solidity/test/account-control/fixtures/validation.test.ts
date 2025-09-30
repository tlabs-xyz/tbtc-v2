import { expect } from "chai"
import { ethers } from "hardhat"
import {
  ROLE_CONSTANTS,
  BITCOIN_ADDRESSES,
  ETHEREUM_ADDRESSES,
  AMOUNT_CONSTANTS,
  TIMING_CONSTANTS,
  SPV_CONSTANTS,
  GAS_CONSTANTS,
  createTestWalletRegistration,
  createTestRedemptionScenario,
  createMockBitcoinTxInfo,
  createMockBitcoinTxProof,
  createQCRegistrationScenario,
  createMintingScenario,
  TEST_CONSTANTS,
} from "./index"

/**
 * Validation tests for the consolidated test data structure
 * These tests ensure all constants and factory functions work correctly
 */
describe("Account Control Test Data Validation", () => {
  describe("Constants", () => {
    it("should have all role constants defined", () => {
      expect(ROLE_CONSTANTS.GOVERNANCE_ROLE).to.be.a("string")
      expect(ROLE_CONSTANTS.DISPUTE_ARBITER_ROLE).to.be.a("string")
      expect(ROLE_CONSTANTS.REGISTRAR_ROLE).to.be.a("string")
      expect(ROLE_CONSTANTS.ENFORCEMENT_ROLE).to.be.a("string")
      expect(ROLE_CONSTANTS.MONITOR_ROLE).to.be.a("string")
      expect(ROLE_CONSTANTS.EMERGENCY_ROLE).to.be.a("string")
      expect(ROLE_CONSTANTS.OPERATIONS_ROLE).to.be.a("string")
      expect(ROLE_CONSTANTS.MINTER_ROLE).to.be.a("string")
      expect(ROLE_CONSTANTS.QC_MANAGER_ROLE).to.be.a("string")
      expect(ROLE_CONSTANTS.ATTESTER_ROLE).to.be.a("string")
    })

    it("should have valid Bitcoin addresses", () => {
      expect(BITCOIN_ADDRESSES.VALID_LEGACY_BTC).to.match(/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/)
      expect(BITCOIN_ADDRESSES.VALID_P2SH_BTC).to.match(/^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/)
      expect(BITCOIN_ADDRESSES.VALID_BECH32_BTC).to.match(/^bc1[a-z0-9]{39,59}$/)
      expect(BITCOIN_ADDRESSES.VALID_P2WSH_BTC).to.match(/^bc1[a-z0-9]{39,59}$/)
    })

    it("should have valid Ethereum addresses", () => {
      expect(ethers.utils.isAddress(ETHEREUM_ADDRESSES.QC_ADDRESS_1)).to.be.true
      expect(ethers.utils.isAddress(ETHEREUM_ADDRESSES.QC_ADDRESS_2)).to.be.true
      expect(ethers.utils.isAddress(ETHEREUM_ADDRESSES.QC_ADDRESS_3)).to.be.true
      expect(ethers.utils.isAddress(ETHEREUM_ADDRESSES.ZERO_ADDRESS)).to.be.true
    })

    it("should have properly formatted amount constants", () => {
      expect(AMOUNT_CONSTANTS.MIN_MINT_AMOUNT._isBigNumber).to.be.true
      expect(AMOUNT_CONSTANTS.STANDARD_MINT_AMOUNT._isBigNumber).to.be.true
      expect(AMOUNT_CONSTANTS.REDEMPTION_AMOUNT._isBigNumber).to.be.true
      expect(AMOUNT_CONSTANTS.INITIAL_MINTING_CAPACITY._isBigNumber).to.be.true
    })

    it("should have reasonable timing constants", () => {
      expect(TIMING_CONSTANTS.REDEMPTION_TIMEOUT_DEFAULT).to.equal(604800) // 7 days
      expect(TIMING_CONSTANTS.STALE_THRESHOLD_DEFAULT).to.equal(86400) // 24 hours
      expect(TIMING_CONSTANTS.ATTESTATION_TIMEOUT).to.equal(21600) // 6 hours
    })

    it("should have valid SPV constants", () => {
      expect(SPV_CONSTANTS.DEFAULT_CHAIN_DIFFICULTY).to.be.a("number")
      expect(SPV_CONSTANTS.MOCK_TX_HASH).to.match(/^0x[a-f0-9]{64}$/)
      expect(SPV_CONSTANTS.TEST_BLOCK_HEIGHT).to.be.a("number")
    })

    it("should have gas constants within reasonable ranges", () => {
      expect(GAS_CONSTANTS.DEPLOYMENT_GAS).to.be.greaterThan(1000000)
      expect(GAS_CONSTANTS.SPV_VALIDATION_GAS).to.be.greaterThan(500000)
      expect(GAS_CONSTANTS.SPV_GAS_RANGE.min).to.be.lessThan(GAS_CONSTANTS.SPV_GAS_RANGE.max)
    })
  })

  describe("Factory Functions", () => {
    it("should create test wallet registration data", () => {
      const registration = createTestWalletRegistration()

      expect(ethers.utils.isAddress(registration.qcAddress)).to.be.true
      expect(registration.btcAddress).to.be.a("string")
      expect(registration.capacity._isBigNumber).to.be.true
    })

    it("should create test redemption scenario", () => {
      const scenario = createTestRedemptionScenario()

      expect(ethers.utils.isAddress(scenario.qcAddress)).to.be.true
      expect(ethers.utils.isAddress(scenario.userAddress)).to.be.true
      expect(scenario.btcAddress).to.be.a("string")
      expect(scenario.amount._isBigNumber).to.be.true
      expect(scenario.redemptionId).to.match(/^0x[a-f0-9]{64}$/)
    })

    it("should create mock Bitcoin transaction info", () => {
      const txInfo = createMockBitcoinTxInfo()

      expect(txInfo.version).to.match(/^0x[a-f0-9]+$/)
      expect(txInfo.inputVector).to.match(/^0x[a-f0-9]+$/)
      expect(txInfo.outputVector).to.match(/^0x[a-f0-9]+$/)
      expect(txInfo.locktime).to.match(/^0x[a-f0-9]+$/)
    })

    it("should create mock Bitcoin transaction proof", () => {
      const proof = createMockBitcoinTxProof()

      expect(proof.merkleProof).to.match(/^0x[a-f0-9]+$/)
      expect(proof.txIndexInBlock).to.be.a("number")
      expect(proof.bitcoinHeaders).to.match(/^0x[a-f0-9]+$/)
      expect(proof.coinbasePreimage).to.match(/^0x[a-f0-9]+$/)
      expect(proof.coinbaseProof).to.match(/^0x[a-f0-9]+$/)
    })

    it("should create QC registration scenario", () => {
      const scenario = createQCRegistrationScenario()

      expect(ethers.utils.isAddress(scenario.qc.address)).to.be.true
      expect(scenario.qc.capacity._isBigNumber).to.be.true
      expect(scenario.qc.btcAddress).to.be.a("string")
      expect(ethers.utils.isAddress(scenario.roles.governance)).to.be.true
      expect(scenario.roleHashes.GOVERNANCE_ROLE).to.be.a("string")
    })

    it("should create minting scenario", () => {
      const scenario = createMintingScenario()

      expect(ethers.utils.isAddress(scenario.qc.address)).to.be.true
      expect(ethers.utils.isAddress(scenario.user.address)).to.be.true
      expect(scenario.mint.amount._isBigNumber).to.be.true
      expect(scenario.systemState.minMintAmount._isBigNumber).to.be.true
    })
  })

  describe("Legacy Compatibility", () => {
    it("should maintain backward compatibility with TEST_CONSTANTS", () => {
      expect(TEST_CONSTANTS.GOVERNANCE_ROLE).to.equal(ROLE_CONSTANTS.GOVERNANCE_ROLE)
      expect(TEST_CONSTANTS.VALID_LEGACY_BTC).to.equal(BITCOIN_ADDRESSES.VALID_LEGACY_BTC)
      expect(TEST_CONSTANTS.VALID_BECH32_BTC).to.equal(BITCOIN_ADDRESSES.VALID_BECH32_BTC)
      expect(TEST_CONSTANTS.SMALL_MINT).to.equal(AMOUNT_CONSTANTS.SMALL_MINT_AMOUNT)
    })
  })

  describe("Data Consistency", () => {
    it("should have consistent role hash generation", () => {
      const expectedGovernanceRole = ethers.utils.id("GOVERNANCE_ROLE")
      expect(ROLE_CONSTANTS.GOVERNANCE_ROLE).to.equal(expectedGovernanceRole)

      const expectedArbitratorRole = ethers.utils.id("DISPUTE_ARBITER_ROLE")
      expect(ROLE_CONSTANTS.DISPUTE_ARBITER_ROLE).to.equal(expectedArbitratorRole)
    })

    it("should have amount constants in proper hierarchy", () => {
      expect(AMOUNT_CONSTANTS.MIN_MINT_AMOUNT.lt(AMOUNT_CONSTANTS.SMALL_MINT_AMOUNT)).to.be.true
      expect(AMOUNT_CONSTANTS.SMALL_MINT_AMOUNT.lt(AMOUNT_CONSTANTS.STANDARD_MINT_AMOUNT)).to.be.true
      expect(AMOUNT_CONSTANTS.STANDARD_MINT_AMOUNT.lt(AMOUNT_CONSTANTS.LARGE_MINT_AMOUNT)).to.be.true
    })

    it("should have timing constants in logical order", () => {
      expect(TIMING_CONSTANTS.STALE_THRESHOLD_SHORT).to.be.lessThan(TIMING_CONSTANTS.STALE_THRESHOLD_TEST)
      expect(TIMING_CONSTANTS.STALE_THRESHOLD_TEST).to.be.lessThan(TIMING_CONSTANTS.STALE_THRESHOLD_DEFAULT)
      expect(TIMING_CONSTANTS.REDEMPTION_TIMEOUT_SHORT).to.be.lessThan(TIMING_CONSTANTS.REDEMPTION_TIMEOUT_TEST)
      expect(TIMING_CONSTANTS.REDEMPTION_TIMEOUT_TEST).to.be.lessThan(TIMING_CONSTANTS.REDEMPTION_TIMEOUT_DEFAULT)
    })
  })
})