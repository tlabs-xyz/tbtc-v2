import { expect } from "chai"
import { ethers, helpers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { ProtocolRegistry } from "../../typechain"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

describe("ProtocolRegistry", () => {
  let deployer: SignerWithAddress
  let governance: SignerWithAddress
  let thirdParty: SignerWithAddress
  let mockService: SignerWithAddress

  let protocolRegistry: ProtocolRegistry

  // Roles
  let PARAMETER_ADMIN_ROLE: string

  // Test service keys
  let TEST_SERVICE_KEY: string
  let ANOTHER_SERVICE_KEY: string

  before(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;[deployer, governance, thirdParty, mockService] = await ethers.getSigners()

    // Generate role hashes
    PARAMETER_ADMIN_ROLE = ethers.utils.id("PARAMETER_ADMIN_ROLE")

    // Generate test service keys
    TEST_SERVICE_KEY = ethers.utils.id("TEST_SERVICE")
    ANOTHER_SERVICE_KEY = ethers.utils.id("ANOTHER_SERVICE")
  })

  beforeEach(async () => {
    await createSnapshot()

    // Deploy ProtocolRegistry
    const ProtocolRegistryFactory = await ethers.getContractFactory(
      "ProtocolRegistry"
    )
    protocolRegistry = await ProtocolRegistryFactory.deploy()
    await protocolRegistry.deployed()
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("Deployment", () => {
    it("should grant deployer admin and parameter admin roles", async () => {
      const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
      expect(
        await protocolRegistry.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)
      ).to.be.true
      expect(
        await protocolRegistry.hasRole(PARAMETER_ADMIN_ROLE, deployer.address)
      ).to.be.true
    })
  })

  describe("Role Constants", () => {
    it("should have correct role constants", async () => {
      expect(await protocolRegistry.PARAMETER_ADMIN_ROLE()).to.equal(
        PARAMETER_ADMIN_ROLE
      )
    })
  })

  describe("setService", () => {
    context("when called by admin with valid parameters", () => {
      let tx: any

      beforeEach(async () => {
        tx = await protocolRegistry.setService(
          TEST_SERVICE_KEY,
          mockService.address
        )
      })

      it("should set the service address", async () => {
        expect(await protocolRegistry.services(TEST_SERVICE_KEY)).to.equal(
          mockService.address
        )
      })

      it("should emit ServiceUpdated event", async () => {
        await expect(tx)
          .to.emit(protocolRegistry, "ServiceUpdated")
          .withArgs(
            TEST_SERVICE_KEY,
            ethers.constants.AddressZero,
            mockService.address
          )
      })

      it("should make hasService return true", async () => {
        expect(await protocolRegistry.hasService(TEST_SERVICE_KEY)).to.be.true
      })

      it("should allow getService to return the address", async () => {
        expect(await protocolRegistry.getService(TEST_SERVICE_KEY)).to.equal(
          mockService.address
        )
      })
    })

    context("when updating existing service", () => {
      let oldAddress: string
      let newAddress: string
      let tx: any

      beforeEach(async () => {
        oldAddress = mockService.address
        newAddress = governance.address

        // Set initial service
        await protocolRegistry.setService(TEST_SERVICE_KEY, oldAddress)

        // Update service
        tx = await protocolRegistry.setService(TEST_SERVICE_KEY, newAddress)
      })

      it("should update the service address", async () => {
        expect(await protocolRegistry.services(TEST_SERVICE_KEY)).to.equal(
          newAddress
        )
      })

      it("should emit ServiceUpdated event with old and new addresses", async () => {
        await expect(tx)
          .to.emit(protocolRegistry, "ServiceUpdated")
          .withArgs(TEST_SERVICE_KEY, oldAddress, newAddress)
      })

      it("should return updated address from getService", async () => {
        expect(await protocolRegistry.getService(TEST_SERVICE_KEY)).to.equal(
          newAddress
        )
      })
    })

    context("when called with invalid parameters", () => {
      it("should revert with zero address", async () => {
        await expect(
          protocolRegistry.setService(
            TEST_SERVICE_KEY,
            ethers.constants.AddressZero
          )
        ).to.be.revertedWith("Invalid service address")
      })
    })

    context("when called by non-admin", () => {
      it("should revert", async () => {
        const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
        await expect(
          protocolRegistry
            .connect(thirdParty)
            .setService(TEST_SERVICE_KEY, mockService.address)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
        )
      })
    })
  })

  describe("getService", () => {
    context("when service is registered", () => {
      beforeEach(async () => {
        await protocolRegistry.setService(TEST_SERVICE_KEY, mockService.address)
      })

      it("should return the correct service address", async () => {
        expect(await protocolRegistry.getService(TEST_SERVICE_KEY)).to.equal(
          mockService.address
        )
      })
    })

    context("when service is not registered", () => {
      it("should revert", async () => {
        await expect(
          protocolRegistry.getService(TEST_SERVICE_KEY)
        ).to.be.revertedWith("Service not registered")
      })
    })
  })

  describe("hasService", () => {
    context("when service is registered", () => {
      beforeEach(async () => {
        await protocolRegistry.setService(TEST_SERVICE_KEY, mockService.address)
      })

      it("should return true", async () => {
        expect(await protocolRegistry.hasService(TEST_SERVICE_KEY)).to.be.true
      })
    })

    context("when service is not registered", () => {
      it("should return false", async () => {
        expect(await protocolRegistry.hasService(TEST_SERVICE_KEY)).to.be.false
      })
    })

    context("when service was registered then removed", () => {
      beforeEach(async () => {
        await protocolRegistry.setService(TEST_SERVICE_KEY, mockService.address)
        // Note: ProtocolRegistry doesn't have a remove function,
        // but this tests the behavior if it did or if we set to zero
      })

      it("should return true for existing service", async () => {
        expect(await protocolRegistry.hasService(TEST_SERVICE_KEY)).to.be.true
      })
    })
  })

  describe("Multiple Services", () => {
    beforeEach(async () => {
      await protocolRegistry.setService(TEST_SERVICE_KEY, mockService.address)
      await protocolRegistry.setService(ANOTHER_SERVICE_KEY, governance.address)
    })

    it("should handle multiple services independently", async () => {
      expect(await protocolRegistry.getService(TEST_SERVICE_KEY)).to.equal(
        mockService.address
      )
      expect(await protocolRegistry.getService(ANOTHER_SERVICE_KEY)).to.equal(
        governance.address
      )
    })

    it("should report hasService correctly for all services", async () => {
      expect(await protocolRegistry.hasService(TEST_SERVICE_KEY)).to.be.true
      expect(await protocolRegistry.hasService(ANOTHER_SERVICE_KEY)).to.be.true
      expect(await protocolRegistry.hasService(ethers.utils.id("NONEXISTENT")))
        .to.be.false
    })
  })

  describe("Access Control", () => {
    context("DEFAULT_ADMIN_ROLE functions", () => {
      it("should allow admin to set services", async () => {
        await expect(
          protocolRegistry.setService(TEST_SERVICE_KEY, mockService.address)
        ).to.not.be.reverted
      })

      it("should prevent non-admin from setting services", async () => {
        const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
        await expect(
          protocolRegistry
            .connect(thirdParty)
            .setService(TEST_SERVICE_KEY, mockService.address)
        ).to.be.revertedWith(
          `AccessControl: account ${thirdParty.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
        )
      })
    })

    context("role management", () => {
      it("should allow admin to grant parameter admin role", async () => {
        await protocolRegistry.grantRole(
          PARAMETER_ADMIN_ROLE,
          governance.address
        )
        expect(
          await protocolRegistry.hasRole(
            PARAMETER_ADMIN_ROLE,
            governance.address
          )
        ).to.be.true
      })

      it("should allow admin to revoke parameter admin role", async () => {
        await protocolRegistry.grantRole(
          PARAMETER_ADMIN_ROLE,
          governance.address
        )
        await protocolRegistry.revokeRole(
          PARAMETER_ADMIN_ROLE,
          governance.address
        )
        expect(
          await protocolRegistry.hasRole(
            PARAMETER_ADMIN_ROLE,
            governance.address
          )
        ).to.be.false
      })
    })
  })

  describe("Edge Cases", () => {
    context("service key edge cases", () => {
      it("should handle zero service key", async () => {
        const zeroKey = ethers.constants.HashZero
        await protocolRegistry.setService(zeroKey, mockService.address)
        expect(await protocolRegistry.getService(zeroKey)).to.equal(
          mockService.address
        )
      })

      it("should handle maximum bytes32 service key", async () => {
        const maxKey = ethers.constants.MaxUint256
        await protocolRegistry.setService(maxKey, mockService.address)
        expect(await protocolRegistry.getService(maxKey)).to.equal(
          mockService.address
        )
      })
    })

    context("address edge cases", () => {
      it("should handle contract addresses", async () => {
        // Use the registry itself as a service address
        await protocolRegistry.setService(
          TEST_SERVICE_KEY,
          protocolRegistry.address
        )
        expect(await protocolRegistry.getService(TEST_SERVICE_KEY)).to.equal(
          protocolRegistry.address
        )
      })

      it("should handle EOA addresses", async () => {
        await protocolRegistry.setService(TEST_SERVICE_KEY, deployer.address)
        expect(await protocolRegistry.getService(TEST_SERVICE_KEY)).to.equal(
          deployer.address
        )
      })
    })

    context("repeated operations", () => {
      it("should handle setting same service multiple times", async () => {
        await protocolRegistry.setService(TEST_SERVICE_KEY, mockService.address)
        await protocolRegistry.setService(TEST_SERVICE_KEY, mockService.address)
        await protocolRegistry.setService(TEST_SERVICE_KEY, mockService.address)

        expect(await protocolRegistry.getService(TEST_SERVICE_KEY)).to.equal(
          mockService.address
        )
      })

      it("should handle alternating service updates", async () => {
        const addr1 = mockService.address
        const addr2 = governance.address

        await protocolRegistry.setService(TEST_SERVICE_KEY, addr1)
        expect(await protocolRegistry.getService(TEST_SERVICE_KEY)).to.equal(
          addr1
        )

        await protocolRegistry.setService(TEST_SERVICE_KEY, addr2)
        expect(await protocolRegistry.getService(TEST_SERVICE_KEY)).to.equal(
          addr2
        )

        await protocolRegistry.setService(TEST_SERVICE_KEY, addr1)
        expect(await protocolRegistry.getService(TEST_SERVICE_KEY)).to.equal(
          addr1
        )
      })
    })

    context("gas optimization scenarios", () => {
      it("should be efficient for multiple service lookups", async () => {
        await protocolRegistry.setService(TEST_SERVICE_KEY, mockService.address)

        // Multiple lookups should not cause issues
        const lookups = Array.from({ length: 5 }, (_, i) => i)
        await lookups.reduce(async (prev) => {
          await prev
          expect(await protocolRegistry.getService(TEST_SERVICE_KEY)).to.equal(
            mockService.address
          )
          expect(await protocolRegistry.hasService(TEST_SERVICE_KEY)).to.be.true
        }, Promise.resolve())
      })

      it("should handle batch service registration", async () => {
        const services = []
        const addresses = [
          mockService.address,
          governance.address,
          thirdParty.address,
        ]

        await addresses.reduce(async (prev, address, i) => {
          await prev
          const serviceKey = ethers.utils.id(`SERVICE_${i}`)
          services.push(serviceKey)
          await protocolRegistry.setService(serviceKey, address)
        }, Promise.resolve())

        // Verify all services are correctly registered
        await services.reduce(async (prev, serviceKey, i) => {
          await prev
          expect(await protocolRegistry.getService(serviceKey)).to.equal(
            addresses[i]
          )
          expect(await protocolRegistry.hasService(serviceKey)).to.be.true
        }, Promise.resolve())
      })
    })
  })

  describe("Service Discovery Patterns", () => {
    beforeEach(async () => {
      // Set up common service keys like the actual system would use
      await protocolRegistry.setService(
        ethers.utils.id("QC_DATA"),
        mockService.address
      )
      await protocolRegistry.setService(
        ethers.utils.id("QC_MANAGER"),
        governance.address
      )
      await protocolRegistry.setService(
        ethers.utils.id("SYSTEM_STATE"),
        thirdParty.address
      )
    })

    it("should support typical service discovery patterns", async () => {
      const qcDataKey = ethers.utils.id("QC_DATA")
      const qcManagerKey = ethers.utils.id("QC_MANAGER")
      const systemStateKey = ethers.utils.id("SYSTEM_STATE")

      expect(await protocolRegistry.getService(qcDataKey)).to.equal(
        mockService.address
      )
      expect(await protocolRegistry.getService(qcManagerKey)).to.equal(
        governance.address
      )
      expect(await protocolRegistry.getService(systemStateKey)).to.equal(
        thirdParty.address
      )
    })

    it("should support checking service availability before use", async () => {
      const availableKey = ethers.utils.id("QC_DATA")
      const unavailableKey = ethers.utils.id("NONEXISTENT_SERVICE")

      expect(await protocolRegistry.hasService(availableKey)).to.be.true
      expect(await protocolRegistry.hasService(unavailableKey)).to.be.false

      // This would be the typical pattern in contracts
      if (await protocolRegistry.hasService(availableKey)) {
        expect(await protocolRegistry.getService(availableKey)).to.equal(
          mockService.address
        )
      }
    })
  })
})
