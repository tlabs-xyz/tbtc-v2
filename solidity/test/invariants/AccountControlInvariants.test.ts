import { expect } from "chai";
import { ethers } from "hardhat";
import { MockAccountControl, MockBank, MockTBTCVault } from "../../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("AccountControl Invariant Tests", function () {
    let accountControl: MockAccountControl;
    let bank: MockBank;
    let vault: MockTBTCVault;
    
    let admin: SignerWithAddress;
    let reserve1: SignerWithAddress;
    let reserve2: SignerWithAddress;
    let reserve3: SignerWithAddress;
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;

    // Track all reserves for invariant checking
    let allReserves: SignerWithAddress[];

    beforeEach(async function () {
        [admin, reserve1, reserve2, reserve3, user1, user2] = await ethers.getSigners();
        allReserves = [reserve1, reserve2, reserve3];

        // Deploy mock contracts
        const MockAccountControl = await ethers.getContractFactory("MockAccountControl");
        const MockBank = await ethers.getContractFactory("MockBank");
        const MockTBTCVault = await ethers.getContractFactory("contracts/test/MockTBTCVault.sol:MockTBTCVault");

        accountControl = await MockAccountControl.deploy();
        bank = await MockBank.deploy();
        vault = await MockTBTCVault.deploy();

        // Setup initial state
        await bank.authorizeBalanceIncreaser(accountControl.address);
        await vault.setTbtcToken(bank.address);

        // Setup reserves with backing
        for (const reserve of allReserves) {
            await accountControl.authorizeReserve(reserve.address, ethers.utils.parseUnits("1000", 8)); // 1000 BTC cap
            await accountControl.setBacking(reserve.address, ethers.utils.parseUnits("500", 8)); // 500 BTC backing
        }
    });

    async function checkAllInvariants() {
        // Invariant 1: backing >= minted for all reserves
        for (const reserve of allReserves) {
            const backing = await accountControl.backing(reserve.address);
            const minted = await accountControl.minted(reserve.address);
            expect(backing).to.be.gte(minted, `Reserve ${reserve.address}: backing < minted`);
        }

        // Invariant 2: totalMinted = sum of all per-reserve minted amounts
        let expectedTotal = ethers.BigNumber.from(0);
        for (const reserve of allReserves) {
            const minted = await accountControl.minted(reserve.address);
            expectedTotal = expectedTotal.add(minted);
        }
        const actualTotal = await accountControl.totalMintedAmount();
        expect(actualTotal).to.equal(expectedTotal, "Total minted != sum of reserves");

        // Invariant 3: If paused, no state changes should occur
        const isPaused = await accountControl.paused();
        if (isPaused) {
            // This check would be done in individual test cases
        }
    }

    describe("Invariant 1: Backing >= Minted", function () {
        it("should maintain backing >= minted after single mint", async function () {
            await accountControl.connect(reserve1).mintTBTC(user1.address, ethers.utils.parseEther("100"));
            await checkAllInvariants();
        });

        it("should maintain backing >= minted after multiple mints", async function () {
            await accountControl.connect(reserve1).mintTBTC(user1.address, ethers.utils.parseEther("100"));
            await accountControl.connect(reserve2).mintTBTC(user2.address, ethers.utils.parseEther("200"));
            await accountControl.connect(reserve1).mintTBTC(user1.address, ethers.utils.parseEther("50"));
            await checkAllInvariants();
        });

        it("should maintain backing >= minted after redemptions", async function () {
            // Setup some minting first
            await accountControl.connect(reserve1).mintTBTC(user1.address, ethers.utils.parseEther("100"));
            await accountControl.connect(reserve2).mintTBTC(user2.address, ethers.utils.parseEther("200"));
            
            // Redeem some
            await accountControl.connect(reserve1).redeemTBTC(ethers.utils.parseEther("50"));
            await accountControl.connect(reserve2).redeemTBTC(ethers.utils.parseEther("100"));
            
            await checkAllInvariants();
        });

        it("should prevent minting when it would violate backing constraint", async function () {
            // Try to mint more than backing allows
            const backing = await accountControl.backing(reserve1.address);
            const satoshisBacking = backing.toNumber();
            const excessiveAmount = ethers.utils.parseEther((satoshisBacking * 1e10 + 1).toString());

            await expect(
                accountControl.connect(reserve1).mintTBTC(user1.address, excessiveAmount)
            ).to.be.revertedWith("Insufficient backing for mint");

            await checkAllInvariants();
        });
    });

    describe("Invariant 2: Total Consistency", function () {
        it("should maintain total = sum consistency after complex operations", async function () {
            // Complex sequence of operations
            await accountControl.connect(reserve1).mintTBTC(user1.address, ethers.utils.parseEther("100"));
            await accountControl.connect(reserve2).mintTBTC(user2.address, ethers.utils.parseEther("200"));
            await accountControl.connect(reserve3).mintTBTC(user1.address, ethers.utils.parseEther("150"));
            
            await accountControl.connect(reserve1).redeemTBTC(ethers.utils.parseEther("30"));
            await accountControl.connect(reserve2).redeemTBTC(ethers.utils.parseEther("50"));
            
            await accountControl.connect(reserve1).mintTBTC(user2.address, ethers.utils.parseEther("75"));
            
            await checkAllInvariants();
        });

        it("should maintain consistency after backing changes", async function () {
            // Mint some tokens
            await accountControl.connect(reserve1).mintTBTC(user1.address, ethers.utils.parseEther("100"));
            
            // Increase backing (should not affect minted tracking)
            await accountControl.setBacking(reserve1.address, ethers.utils.parseUnits("800", 8));
            
            await checkAllInvariants();
            
            // Mint more (should still work with increased backing)
            await accountControl.connect(reserve1).mintTBTC(user1.address, ethers.utils.parseEther("200"));
            
            await checkAllInvariants();
        });
    });

    describe("Invariant 3: Pause State Consistency", function () {
        it("should prevent all minting when paused", async function () {
            await accountControl.setPaused(true);
            
            await expect(
                accountControl.connect(reserve1).mintTBTC(user1.address, ethers.utils.parseEther("100"))
            ).to.be.revertedWith("Contract paused");
            
            await expect(
                accountControl.connect(reserve1).redeemTBTC(ethers.utils.parseEther("100"))
            ).to.be.revertedWith("Contract paused");
            
            await checkAllInvariants();
        });

        it("should resume normal operation when unpaused", async function () {
            // Pause and try operations
            await accountControl.setPaused(true);
            await expect(
                accountControl.connect(reserve1).mintTBTC(user1.address, ethers.utils.parseEther("100"))
            ).to.be.revertedWith("Contract paused");
            
            // Unpause and retry
            await accountControl.setPaused(false);
            await accountControl.connect(reserve1).mintTBTC(user1.address, ethers.utils.parseEther("100"));
            
            await checkAllInvariants();
        });
    });

    describe("Multi-Reserve Stress Test", function () {
        it("should maintain all invariants under high-frequency operations", async function () {
            const operations = [
                () => accountControl.connect(reserve1).mintTBTC(user1.address, ethers.utils.parseEther("50")),
                () => accountControl.connect(reserve2).mintTBTC(user2.address, ethers.utils.parseEther("75")),
                () => accountControl.connect(reserve3).mintTBTC(user1.address, ethers.utils.parseEther("25")),
                () => accountControl.connect(reserve1).redeemTBTC(ethers.utils.parseEther("20")),
                () => accountControl.connect(reserve2).redeemTBTC(ethers.utils.parseEther("30")),
                () => accountControl.connect(reserve1).mintTBTC(user2.address, ethers.utils.parseEther("40")),
                () => accountControl.connect(reserve3).redeemTBTC(ethers.utils.parseEther("15")),
                () => accountControl.connect(reserve2).mintTBTC(user1.address, ethers.utils.parseEther("60")),
            ];

            // Execute operations and check invariants after each
            for (let i = 0; i < operations.length; i++) {
                try {
                    await operations[i]();
                    await checkAllInvariants();
                } catch (error) {
                    // If operation reverts due to business logic (like insufficient backing),
                    // invariants should still hold
                    await checkAllInvariants();
                }
            }
        });
    });

    describe("Edge Cases", function () {
        it("should handle zero amounts correctly", async function () {
            await accountControl.connect(reserve1).mintTBTC(user1.address, 0);
            await checkAllInvariants();
        });

        it("should handle minimum amounts correctly", async function () {
            await accountControl.connect(reserve1).mintTBTC(user1.address, 1);
            await checkAllInvariants();
        });

        it("should maintain invariants when backing equals minted exactly", async function () {
            const backing = await accountControl.backing(reserve1.address);
            const maxMintable = backing.mul(ethers.utils.parseUnits("1", 10)); // Convert satoshis to wei
            
            await accountControl.connect(reserve1).mintTBTC(user1.address, maxMintable);
            await checkAllInvariants();
            
            // Should not be able to mint even 1 satoshi more (need 1e10 wei to get 1 satoshi)
            await expect(
                accountControl.connect(reserve1).mintTBTC(user1.address, ethers.utils.parseUnits("1", 10))
            ).to.be.revertedWith("Insufficient backing for mint");
        });
    });
});