// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.17;

/*
 * SPV Validator Design Philosophy
 * ==============================
 *
 * This contract bridges the gap between Account Control's SPV needs and
 * Bridge's proven SPV infrastructure without modifying production Bridge.
 *
 * WHY NOT MODIFY BRIDGE?
 * - Bridge secures millions in BTC and is battle-tested in production
 * - Redeploying Bridge carries significant risk and operational overhead
 * - Bridge's SPV logic is internal and not designed for external access
 *
 * OUR APPROACH:
 * - Replicate Bridge's exact SPV validation algorithms
 * - Use same relay contract and difficulty parameters as Bridge
 * - Provide clean interface tailored for Account Control needs
 * - Maintain identical security guarantees without production risks
 *
 * SECURITY CONSIDERATIONS:
 * - SPV logic is copied verbatim from Bridge's BitcoinTx.validateProof()
 * - Same cryptographic verification as production Bridge
 * - Same relay and difficulty factor sources ensure consistency
 * - Role-based access control protects configuration changes
 */

import "@keep-network/bitcoin-spv-sol/contracts/BTCUtils.sol";
import "@keep-network/bitcoin-spv-sol/contracts/ValidateSPV.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

import "../bridge/BitcoinTx.sol";
import "../bridge/IRelay.sol";

/// @title SPV Validator for Account Control
/// @notice Lightweight SPV proof validator that replicates Bridge's validation logic
/// @dev This contract provides SPV validation without requiring Bridge modifications.
///
///      DESIGN DECISION: Rather than modifying the production Bridge contract
///      (which would require redeployment of a critical system component),
///      we created this lightweight validator that replicates Bridge's exact
///      SPV verification logic. This approach:
///
///      1. Avoids the risk of redeploying Bridge in production
///      2. Reuses the same battle-tested SPV algorithms that secure millions in BTC
///      3. Uses the same relay and difficulty parameters as Bridge
///      4. Provides a clean interface for Account Control system needs
///
///      The validator acts as a "bridge" to Bridge's proven SPV infrastructure,
///      giving Account Control access to production-grade SPV verification
///      without touching the core Bridge contract.
contract SPVValidator is AccessControl {
    using BTCUtils for bytes;
    using BTCUtils for uint256;
    using ValidateSPV for bytes;
    using ValidateSPV for bytes32;

    /// @notice The relay contract for difficulty validation
    IRelay public immutable relay;

    /// @notice The difficulty factor required for SPV proofs
    uint96 public immutable txProofDifficultyFactor;

    /// @notice Role for updating configuration
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");

    /// @notice Events
    event SPVProofValidated(
        bytes32 indexed txHash,
        address indexed validator,
        uint256 indexed timestamp
    );

    event WalletControlVerified(
        address indexed qc,
        string btcAddress,
        bytes32 indexed txHash,
        address indexed verifiedBy,
        uint256 timestamp
    );

    event RedemptionFulfillmentVerified(
        bytes32 indexed redemptionId,
        bytes32 indexed txHash,
        address indexed verifiedBy,
        uint256 timestamp
    );

    /// @notice Constructor
    /// @param _relay Address of the relay contract (same as Bridge uses)
    /// @param _txProofDifficultyFactor Difficulty factor (same as Bridge uses)
    constructor(address _relay, uint96 _txProofDifficultyFactor) {
        require(_relay != address(0), "Invalid relay address");
        require(_txProofDifficultyFactor > 0, "Invalid difficulty factor");

        relay = IRelay(_relay);
        txProofDifficultyFactor = _txProofDifficultyFactor;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(CONFIG_ROLE, msg.sender);
    }

    /// @notice Validate SPV proof using the same logic as Bridge
    /// @dev This function replicates Bridge's BitcoinTx.validateProof() logic exactly.
    ///      We chose to replicate rather than modify Bridge to avoid production risks.
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof data
    /// @return txHash Verified transaction hash
    function validateProof(
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external view returns (bytes32 txHash) {
        // REPLICATION NOTE: This replicates the exact logic from Bridge's
        // BitcoinTx.validateProof() to avoid modifying the production Bridge contract
        require(
            txInfo.inputVector.validateVin(),
            "Invalid input vector provided"
        );
        require(
            txInfo.outputVector.validateVout(),
            "Invalid output vector provided"
        );
        require(
            proof.merkleProof.length == proof.coinbaseProof.length,
            "Tx not on same level of merkle tree as coinbase"
        );

        txHash = abi
            .encodePacked(
                txInfo.version,
                txInfo.inputVector,
                txInfo.outputVector,
                txInfo.locktime
            )
            .hash256View();

        bytes32 root = proof.bitcoinHeaders.extractMerkleRootLE();

        require(
            txHash.prove(root, proof.merkleProof, proof.txIndexInBlock),
            "Tx merkle proof is not valid for provided header and tx hash"
        );

        bytes32 coinbaseHash = sha256(abi.encodePacked(proof.coinbasePreimage));

        require(
            coinbaseHash.prove(root, proof.coinbaseProof, 0),
            "Coinbase merkle proof is not valid for provided header and hash"
        );

        _evaluateProofDifficulty(proof.bitcoinHeaders);

        return txHash;
    }

    /// @notice Verify wallet control via OP_RETURN challenge
    /// @param qc The QC address claiming wallet control
    /// @param btcAddress The Bitcoin address being claimed
    /// @param challenge The expected challenge string
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    /// @return verified True if wallet control is verified
    function verifyWalletControl(
        address qc,
        string calldata btcAddress,
        bytes32 challenge,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external view returns (bool verified) {
        // Step 1: Verify SPV proof
        bytes32 txHash = this.validateProof(txInfo, proof);

        // Step 2: Additional validation for wallet control
        // TODO: Implement OP_RETURN challenge verification
        // TODO: Implement input address verification

        // For now, return true if SPV verification passed
        // Prevent unused variable warnings
        qc;
        btcAddress;
        challenge;
        txHash;

        return true;
    }

    /// @notice Verify redemption fulfillment payment
    /// @param redemptionId The redemption identifier
    /// @param userBtcAddress The user's Bitcoin address
    /// @param expectedAmount The expected payment amount in satoshis
    /// @param txInfo Bitcoin transaction information
    /// @param proof SPV proof of transaction inclusion
    /// @return verified True if redemption is fulfilled
    function verifyRedemptionFulfillment(
        bytes32 redemptionId,
        string calldata userBtcAddress,
        uint64 expectedAmount,
        BitcoinTx.Info calldata txInfo,
        BitcoinTx.Proof calldata proof
    ) external view returns (bool verified) {
        // Step 1: Verify SPV proof
        bytes32 txHash = this.validateProof(txInfo, proof);

        // Step 2: Additional validation for redemption fulfillment
        // TODO: Implement payment output verification
        // TODO: Implement amount verification

        // For now, return true if SPV verification passed
        // Prevent unused variable warnings
        redemptionId;
        userBtcAddress;
        expectedAmount;
        txHash;

        return true;
    }

    /// @dev Evaluate proof difficulty using the same logic as Bridge
    /// @dev This replicates Bridge's evaluateProofDifficulty() to maintain consistency
    ///      with production Bridge validation without requiring Bridge modifications.
    /// @param bitcoinHeaders Bitcoin headers chain being part of the SPV proof
    function _evaluateProofDifficulty(bytes memory bitcoinHeaders)
        private
        view
    {
        uint256 currentEpochDifficulty = relay.getCurrentEpochDifficulty();
        uint256 previousEpochDifficulty = relay.getPrevEpochDifficulty();

        uint256 requestedDiff = 0;
        uint256 firstHeaderDiff = bitcoinHeaders
            .extractTarget()
            .calculateDifficulty();

        if (firstHeaderDiff == currentEpochDifficulty) {
            requestedDiff = currentEpochDifficulty;
        } else if (firstHeaderDiff == previousEpochDifficulty) {
            requestedDiff = previousEpochDifficulty;
        } else {
            revert("Not at current or previous difficulty");
        }

        uint256 observedDiff = bitcoinHeaders.validateHeaderChain();

        require(
            observedDiff != ValidateSPV.getErrBadLength(),
            "Invalid length of the headers chain"
        );
        require(
            observedDiff != ValidateSPV.getErrInvalidChain(),
            "Invalid headers chain"
        );
        require(
            observedDiff != ValidateSPV.getErrLowWork(),
            "Insufficient work in a header"
        );

        require(
            observedDiff >= requestedDiff * txProofDifficultyFactor,
            "Insufficient accumulated difficulty in header chain"
        );
    }
}
