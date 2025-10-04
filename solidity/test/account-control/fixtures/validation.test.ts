import { expect } from "chai"
import { ethers } from "hardhat"
import {
  ROLES,
  BTC_ADDRESSES,
  ETH_ADDRESSES,
  AMOUNTS,
  TIMEOUTS,
  BLOCKCHAIN,
  GAS_LIMITS,
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
      expect(ROLES.GOVERNANCE_ROLE).to.be.a("string")
      expect(ROLES.DISPUTE_ARBITER_ROLE).to.be.a("string")
      expect(ROLES.REGISTRAR_ROLE).to.be.a("string")
      expect(ROLES.ENFORCEMENT_ROLE).to.be.a("string")
      expect(ROLES.MONITOR_ROLE).to.be.a("string")
      expect(ROLES.EMERGENCY_ROLE).to.be.a("string")
      expect(ROLES.OPERATIONS_ROLE).to.be.a("string")
      expect(ROLES.MINTER_ROLE).to.be.a("string")
      expect(ROLES.QC_MANAGER_ROLE).to.be.a("string")
      expect(ROLES.ATTESTER_ROLE).to.be.a("string")
    })

    it("should have valid Bitcoin addresses", () => {
      expect(BTC_ADDRESSES.GENESIS_BLOCK).to.match(
        /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/
      )
      expect(BTC_ADDRESSES.P2SH_STANDARD).to.match(
        /^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/
      )
      expect(BTC_ADDRESSES.BECH32_STANDARD).to.match(
        /^bc1[a-z0-9]{39,59}$/
      )
      expect(BTC_ADDRESSES.BECH32_P2WSH).to.match(/^bc1[a-z0-9]{39,59}$/)
    })

    it("should have valid Ethereum addresses", () => {
      expect(ethers.utils.isAddress(ETH_ADDRESSES.QC_1)).to.be.true
      expect(ethers.utils.isAddress(ETH_ADDRESSES.QC_2)).to.be.true
      expect(ethers.utils.isAddress(ETH_ADDRESSES.QC_3)).to.be.true
      expect(ethers.utils.isAddress("0x0000000000000000000000000000000000000000")).to.be.true
    })

    it("should have properly formatted amount constants", () => {
      expect(AMOUNTS.ETH_0_001._isBigNumber).to.be.true
      expect(AMOUNTS.ETH_1._isBigNumber).to.be.true
      expect(AMOUNTS.REDEMPTION_5_ETH._isBigNumber).to.be.true
      expect(AMOUNTS.MINTING_CAP_100._isBigNumber).to.be.true
    })

    it("should have reasonable timing constants", () => {
      expect(TIMEOUTS.REDEMPTION_DEFAULT).to.equal(604800) // 7 days
      expect(TIMEOUTS.ORACLE_STALE_DEFAULT).to.equal(86400) // 24 hours
      expect(TIMEOUTS.ORACLE_ATTESTATION).to.equal(21600) // 6 hours
    })

    it("should have gas constants within reasonable ranges", () => {
      expect(GAS_LIMITS.DEPLOYMENT).to.be.greaterThan(1000000)
      expect(GAS_LIMITS.SPV_VALIDATION).to.be.greaterThan(500000)
      expect(GAS_LIMITS.SPV_MIN).to.be.lessThan(
        GAS_LIMITS.SPV_MAX
      )
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

  describe("Data Structure Validation", () => {
    it("should have well-formed TEST_CONSTANTS mapping", () => {
      expect(TEST_CONSTANTS.GOVERNANCE_ROLE).to.equal(
        ROLES.GOVERNANCE_ROLE
      )
      expect(TEST_CONSTANTS.VALID_LEGACY_BTC).to.equal(
        BTC_ADDRESSES.GENESIS_BLOCK
      )
      expect(TEST_CONSTANTS.VALID_BECH32_BTC).to.equal(
        BTC_ADDRESSES.BECH32_STANDARD
      )
      expect(TEST_CONSTANTS.SMALL_MINT).to.equal(
        AMOUNTS.ETH_0_1
      )
    })
  })

  describe("Data Consistency", () => {
    it("should have consistent role hash generation", () => {
      const expectedGovernanceRole = ethers.utils.id("GOVERNANCE_ROLE")
      expect(ROLES.GOVERNANCE_ROLE).to.equal(expectedGovernanceRole)

      const expectedArbitratorRole = ethers.utils.id("DISPUTE_ARBITER_ROLE")
      expect(ROLES.DISPUTE_ARBITER_ROLE).to.equal(
        expectedArbitratorRole
      )
    })

    it("should have amount constants in proper hierarchy", () => {
      expect(
        AMOUNTS.ETH_0_001.lt(AMOUNTS.ETH_0_1)
      ).to.be.true
      expect(
        AMOUNTS.ETH_0_1.lt(
          AMOUNTS.ETH_1
        )
      ).to.be.true
      expect(
        AMOUNTS.ETH_1.lt(
          AMOUNTS.ETH_100
        )
      ).to.be.true
    })

    it("should have timing constants in logical order", () => {
      expect(TIMEOUTS.ORACLE_STALE_SHORT).to.be.lessThan(
        TIMEOUTS.ORACLE_STALE_STANDARD
      )
      expect(TIMEOUTS.ORACLE_STALE_STANDARD).to.be.lessThan(
        TIMEOUTS.ORACLE_STALE_DEFAULT
      )
      expect(TIMEOUTS.REDEMPTION_SHORT).to.be.lessThan(
        TIMEOUTS.REDEMPTION_24H
      )
      expect(TIMEOUTS.REDEMPTION_24H).to.be.lessThan(
        TIMEOUTS.REDEMPTION_DEFAULT
      )
    })
  })
})
