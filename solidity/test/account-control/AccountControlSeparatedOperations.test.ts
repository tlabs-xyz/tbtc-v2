import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { AccountControl } from "../../typechain";
import {
    getTestAmounts,
    deployAccountControlForTest
} from "../helpers/testing-utils";

describe("AccountControl Separated Operations", function () {
    let accountControl: AccountControl;
    let owner: SignerWithAddress;
    let emergencyCouncil: SignerWithAddress;
    let mockBank: any;
    let reserve: SignerWithAddress;
    let user: SignerWithAddress;
    let amounts: any;

    beforeEach(async function () {
        [owner, emergencyCouncil, reserve, user] = await ethers.getSigners();

        // Deploy mock Bank
        const MockBankFactory = await ethers.getContractFactory("MockBank");
        mockBank = await MockBankFactory.deploy();

        // Deploy AccountControl using helper
        accountControl = await deployAccountControlForTest(owner, emergencyCouncil, mockBank) as AccountControl;

        // Get dynamic test amounts
        amounts = await getTestAmounts(accountControl);

        // Use MEDIUM_CAP for testing since LARGE_CAP isn't defined in testing utils
        const testCap = amounts.MEDIUM_CAP.mul(5); // 5x medium cap for testing

        // Authorize a reserve for testing
        await accountControl.connect(owner).authorizeReserve(
            reserve.address,
            testCap
        );

        // Set up backing
        await accountControl.connect(reserve).updateBacking(testCap);
    });

    describe("Pure token minting (mintTokens)", function () {
        it("should mint tokens and update accounting", async function () {
            const amount = amounts.SMALL_MINT;

            // Track state before
            const mintedBefore = await accountControl.minted(reserve.address);
            const totalMintedBefore = await accountControl.totalMintedAmount();

            // Mint tokens
            await expect(accountControl.connect(reserve).mintTokens(user.address, amount))
                .to.emit(accountControl, "PureTokenMint")
                .withArgs(reserve.address, user.address, amount);

            // Check tokens were minted via Bank
            expect(await mockBank.balanceOf(user.address)).to.equal(amount);

            // Check accounting WAS updated to enforce caps
            expect(await accountControl.minted(reserve.address)).to.equal(mintedBefore.add(amount));
            expect(await accountControl.totalMintedAmount()).to.equal(totalMintedBefore.add(amount));
        });

        it("should enforce cap requirements", async function () {
            const testCap = amounts.MEDIUM_CAP.mul(5);
            const excessAmount = testCap.add(amounts.SMALL_MINT);

            await expect(accountControl.connect(reserve).mintTokens(user.address, excessAmount))
                .to.be.revertedWithCustomError(accountControl, "ExceedsReserveCap");
        });

    });


    describe("Pure accounting credit (creditMinted)", function () {
        it("should update accounting without minting tokens", async function () {
            const amount = amounts.SMALL_MINT;

            // Track state before
            const mintedBefore = await accountControl.minted(reserve.address);
            const totalMintedBefore = await accountControl.totalMintedAmount();
            const userBalanceBefore = await mockBank.balanceOf(user.address);

            // Credit accounting only
            await expect(accountControl.connect(reserve).creditMinted(amount))
                .to.emit(accountControl, "AccountingCredit")
                .withArgs(reserve.address, amount);

            // Check accounting was updated
            expect(await accountControl.minted(reserve.address)).to.equal(mintedBefore.add(amount));
            expect(await accountControl.totalMintedAmount()).to.equal(totalMintedBefore.add(amount));

            // Check no tokens were minted
            expect(await mockBank.balanceOf(user.address)).to.equal(userBalanceBefore);
        });

        it("should enforce minting cap limits", async function () {
            const testCap = amounts.MEDIUM_CAP.mul(5);
            const excessAmount = testCap.add(amounts.SMALL_MINT);

            await expect(accountControl.connect(reserve).creditMinted(excessAmount))
                .to.be.revertedWith("ExceedsReserveCap");
        });
    });

    describe("Pure accounting debit (debitMinted)", function () {
        beforeEach(async function () {
            // Set up some minted amount to debit from
            await accountControl.connect(reserve).creditMinted(amounts.MEDIUM_MINT);
            // Mine a block to allow next operation
            await ethers.provider.send("evm_mine", []);
        });

        it("should update accounting without burning tokens", async function () {
            const amount = amounts.TINY_MINT; // Use smaller amount than what was credited

            // Track state before
            const mintedBefore = await accountControl.minted(reserve.address);
            const totalMintedBefore = await accountControl.totalMintedAmount();
            const userBalanceBefore = await mockBank.balanceOf(user.address);

            // Debit accounting only
            await expect(accountControl.connect(reserve).debitMinted(amount))
                .to.emit(accountControl, "AccountingDebit")
                .withArgs(reserve.address, amount);

            // Check accounting was updated
            expect(await accountControl.minted(reserve.address)).to.equal(mintedBefore.sub(amount));
            expect(await accountControl.totalMintedAmount()).to.equal(totalMintedBefore.sub(amount));

            // Check no tokens were burned
            expect(await mockBank.balanceOf(user.address)).to.equal(userBalanceBefore);
        });

        it("should prevent debiting more than minted", async function () {
            const excessAmount = amounts.MEDIUM_CAP.mul(10); // Much larger than what we minted

            await expect(accountControl.connect(reserve).debitMinted(excessAmount))
                .to.be.revertedWith("InsufficientMinted");
        });
    });

    describe("Atomic operations (safer alternatives)", function () {
        it("atomicMint should combine token minting and accounting", async function () {
            const amount = amounts.SMALL_MINT;

            // Atomic mint (no sequence validation)
            await expect(accountControl.connect(reserve).atomicMint(user.address, amount))
                .to.emit(accountControl, "MintExecuted")
                .withArgs(reserve.address, user.address, amount);

            // Check both tokens and accounting were updated
            expect(await mockBank.balanceOf(user.address)).to.equal(amount);
            expect(await accountControl.minted(reserve.address)).to.equal(amount);
        });


        it("atomic operations should not have sequence validation", async function () {
            const amount = amounts.SMALL_MINT;

            // Two atomic operations in sequence should both succeed
            await accountControl.connect(reserve).atomicMint(user.address, amount);
            await accountControl.connect(reserve).atomicMint(user.address, amount);

            expect(await mockBank.balanceOf(user.address)).to.equal(amount * 2);
        });
    });

    describe("Operation sequence validation", function () {
        it("should allow operations after cooldown period", async function () {
            const amount = amounts.SMALL_MINT;

            // First operation
            await accountControl.connect(reserve).mintTokens(user.address, amount);

            // Mine a block to pass cooldown
            await ethers.provider.send("evm_mine", []);

            // Second operation should now succeed (mintTokens includes both token and accounting)
            await accountControl.connect(reserve).mintTokens(user.address, amount);

            expect(await accountControl.minted(reserve.address)).to.equal(amount.mul(2));
        });

        it("should track last operation timestamp per reserve", async function () {
            const amount = amounts.SMALL_MINT;

            // Operation should update timestamp
            await accountControl.connect(reserve).mintTokens(user.address, amount);

            const timestamp = await accountControl.lastOperationTimestamp(reserve.address);
            const currentBlock = await ethers.provider.getBlockNumber();

            expect(timestamp).to.equal(currentBlock);
        });
    });

    describe("Integration with existing functionality", function () {
        it("should maintain backing invariant across separated operations", async function () {
            const amount = amounts.SMALL_MINT;

            // Pure operations that should maintain invariant
            await accountControl.connect(reserve).mintTokens(user.address, amount);
            await ethers.provider.send("evm_mine", []);
            await accountControl.connect(reserve).creditMinted(amount);

            // Backing should still be >= minted
            const backing = await accountControl.backing(reserve.address);
            const minted = await accountControl.minted(reserve.address);
            expect(backing).to.be.gte(minted);
        });

        it("should maintain compatibility with original mint function", async function () {
            const amount = amounts.SMALL_MINT;

            // Original mint function should still work
            await expect(accountControl.connect(reserve).mint(user.address, amount))
                .to.emit(accountControl, "MintExecuted")
                .withArgs(reserve.address, user.address, amount);

            // Both tokens and accounting should be updated
            expect(await mockBank.balanceOf(user.address)).to.equal(amount);
            expect(await accountControl.minted(reserve.address)).to.equal(amount);
        });
    });
});