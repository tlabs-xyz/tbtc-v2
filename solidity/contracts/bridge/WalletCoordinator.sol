// SPDX-License-Identifier: GPL-3.0-only

// ██████████████     ▐████▌     ██████████████
// ██████████████     ▐████▌     ██████████████
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
// ██████████████     ▐████▌     ██████████████
// ██████████████     ▐████▌     ██████████████
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌
//               ▐████▌    ▐████▌

pragma solidity 0.8.17;

import {BTCUtils} from "@keep-network/bitcoin-spv-sol/contracts/BTCUtils.sol";
import {BytesLib} from "@keep-network/bitcoin-spv-sol/contracts/BytesLib.sol";
import "@keep-network/random-beacon/contracts/Reimbursable.sol";
import "@keep-network/random-beacon/contracts/ReimbursementPool.sol";

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./BitcoinTx.sol";
import "./Bridge.sol";
import "./Deposit.sol";
import "./Redemption.sol";
import "./Wallets.sol";

/// @title Wallet coordinator.
/// @notice The wallet coordinator contract aims to facilitate the coordination
///         of the off-chain wallet members during complex multi-chain wallet
///         operations like deposit sweeping, redemptions, or moving funds.
///         Such processes involve various moving parts and many steps that each
///         individual wallet member must do. Given the distributed nature of
///         the off-chain wallet software, full off-chain implementation is
///         challenging and prone to errors, especially byzantine faults.
///         This contract provides a single and trusted on-chain coordination
///         point thus taking the riskiest part out of the off-chain software.
///         The off-chain wallet members can focus on the core tasks and do not
///         bother about electing a trusted coordinator or aligning internal
///         states using complex consensus algorithms.
contract WalletCoordinator is OwnableUpgradeable, Reimbursable {
    using BTCUtils for bytes;
    using BytesLib for bytes;

    /// @notice Represents wallet action:
    enum WalletAction {
        /// @dev The wallet does not perform any action.
        Idle,
        /// @dev The wallet is executing heartbeat.
        Heartbeat,
        /// @dev The wallet is handling a deposit sweep action.
        DepositSweep,
        /// @dev The wallet is handling a redemption action.
        Redemption,
        /// @dev The wallet is handling a moving funds action.
        MovingFunds,
        /// @dev The wallet is handling a moved funds sweep action.
        MovedFundsSweep
    }

    /// @notice Holds information about a wallet time lock.
    struct WalletLock {
        /// @notice A UNIX timestamp defining the moment until which the wallet
        ///         is locked and cannot receive new proposals. The value of 0
        ///         means the wallet is not locked and can receive a proposal
        ///         at any time.
        uint32 expiresAt;
        /// @notice The wallet action being the cause of the lock.
        WalletAction cause;
    }

    /// @notice Helper structure representing a deposit sweep proposal.
    struct DepositSweepProposal {
        // 20-byte public key hash of the target wallet.
        bytes20 walletPubKeyHash;
        // Deposits that should be part of the sweep.
        DepositKey[] depositsKeys;
        // Proposed BTC fee for the entire transaction.
        uint256 sweepTxFee;
        // Array containing the reveal blocks of each deposit. This information
        // strongly facilitates the off-chain processing. Using those blocks,
        // wallet operators can quickly fetch corresponding Bridge.DepositRevealed
        // events carrying deposit data necessary to perform proposal validation.
        // This field is not explicitly validated within the validateDepositSweepProposal
        // function because if something is wrong here the off-chain wallet
        // operators will fail anyway as they won't be able to gather deposit
        // data necessary to perform the on-chain validation using the
        // validateDepositSweepProposal function.
        uint256[] depositsRevealBlocks;
    }

    /// @notice Helper structure representing a plain-text deposit key.
    ///         Each deposit can be identified by their 32-byte funding
    ///         transaction hash (Bitcoin internal byte order) an the funding
    ///         output index (0-based).
    /// @dev Do not confuse this structure with the deposit key used within the
    ///      Bridge contract to store deposits. Here we have the plain-text
    ///      components of the key while the Bridge uses a uint representation of
    ///      keccak256(fundingTxHash | fundingOutputIndex) for gas efficiency.
    struct DepositKey {
        bytes32 fundingTxHash;
        uint32 fundingOutputIndex;
    }

    /// @notice Helper structure holding deposit extra data required during
    ///         deposit sweep proposal validation. Basically, this structure
    ///         is a combination of BitcoinTx.Info and relevant parts of
    ///         Deposit.DepositRevealInfo.
    /// @dev These data can be pulled from respective `DepositRevealed` events
    ///      emitted by the `Bridge.revealDeposit` function. The `fundingTx`
    ///      field must be taken directly from the Bitcoin chain, using the
    ///      `DepositRevealed.fundingTxHash` as transaction identifier.
    struct DepositExtraInfo {
        BitcoinTx.Info fundingTx;
        bytes8 blindingFactor;
        bytes20 walletPubKeyHash;
        bytes20 refundPubKeyHash;
        bytes4 refundLocktime;
    }

    /// @notice Helper structure representing a redemption proposal.
    struct RedemptionProposal {
        // 20-byte public key hash of the target wallet.
        bytes20 walletPubKeyHash;
        // Array of the redeemers' output scripts that should be part of
        // the redemption. Each output script MUST BE prefixed by its byte
        // length, i.e. passed in the exactly same format as during the
        // `Bridge.requestRedemption` transaction.
        bytes[] redeemersOutputScripts;
        // Proposed BTC fee for the entire transaction.
        uint256 redemptionTxFee;
    }

    /// @notice Mapping that holds addresses allowed to submit proposals and
    ///         request heartbeats.
    mapping(address => bool) public isCoordinator;

    /// @notice Mapping that holds wallet time locks. The key is a 20-byte
    ///         wallet public key hash.
    mapping(bytes20 => WalletLock) public walletLock;

    /// @notice Handle to the Bridge contract.
    Bridge public bridge;

    /// @notice Determines the wallet heartbeat request validity time. In other
    ///         words, this is  the worst-case time for a wallet heartbeat
    ///         during which the wallet is busy and canot take other actions.
    ///         This is also the duration of the time lock applied to the wallet
    ///         once a new heartbeat request is submitted.
    ///
    ///         For example, if a deposit sweep proposal was submitted at
    ///         2 pm and heartbeatRequestValidity is 1 hour, the next request or
    ///         proposal (of any type) can be submitted after 3 pm.
    uint32 public heartbeatRequestValidity;

    /// @notice Gas that is meant to balance the heartbeat request overall cost.
    ///         Can be updated by the owner based on the current conditions.
    uint32 public heartbeatRequestGasOffset;

    /// @notice Determines the deposit sweep proposal validity time. In other
    ///         words, this is the worst-case time for a deposit sweep during
    ///         which the wallet is busy and cannot take another actions. This
    ///         is also the duration of the time lock applied to the wallet
    ///         once a new deposit sweep proposal is submitted.
    ///
    ///         For example, if a deposit sweep proposal was submitted at
    ///         2 pm and depositSweepProposalValidity is 4 hours, the next
    ///         proposal (of any type) can be submitted after 6 pm.
    uint32 public depositSweepProposalValidity;

    /// @notice The minimum time that must elapse since the deposit reveal
    ///         before a deposit becomes eligible for a deposit sweep.
    ///
    ///         For example, if a deposit was revealed at 9 am and depositMinAge
    ///         is 2 hours, the deposit is eligible for sweep after 11 am.
    ///
    /// @dev Forcing deposit minimum age ensures block finality for Ethereum.
    ///      In the happy path case, i.e. where the deposit is revealed immediately
    ///      after being broadcast on the Bitcoin network, the minimum age
    ///      check also ensures block finality for Bitcoin.
    uint32 public depositMinAge;

    /// @notice Each deposit can be technically swept until it reaches its
    ///         refund timestamp after which it can be taken back by the depositor.
    ///         However, allowing the wallet to sweep deposits that are close
    ///         to their refund timestamp may cause a race between the wallet
    ///         and the depositor. In result, the wallet may sign an invalid
    ///         sweep transaction that aims to sweep an already refunded deposit.
    ///         Such tx signature may be used to create an undefeatable fraud
    ///         challenge against the wallet. In order to mitigate that problem,
    ///         this parameter determines a safety margin that puts the latest
    ///         moment a deposit can be swept far before the point after which
    ///         the deposit becomes refundable.
    ///
    ///         For example, if a deposit becomes refundable after 8 pm and
    ///         depositRefundSafetyMargin is 6 hours, the deposit is valid for
    ///         for a sweep only before 2 pm.
    uint32 public depositRefundSafetyMargin;

    /// @notice The maximum count of deposits that can be swept within a
    ///         single sweep.
    uint16 public depositSweepMaxSize;

    /// @notice Gas that is meant to balance the deposit sweep proposal
    ///         submission overall cost. Can be updated by the owner based on
    ///         the current conditions.
    uint32 public depositSweepProposalSubmissionGasOffset;

    /// @notice Determines the redemption proposal validity time. In other
    ///         words, this is the worst-case time for a redemption during
    ///         which the wallet is busy and cannot take another actions. This
    ///         is also the duration of the time lock applied to the wallet
    ///         once a new redemption proposal is submitted.
    ///
    ///         For example, if a redemption proposal was submitted at
    ///         2 pm and redemptionProposalValidity is 2 hours, the next
    ///         proposal (of any type) can be submitted after 4 pm.
    uint32 public redemptionProposalValidity;

    /// @notice The minimum time that must elapse since the redemption request
    ///         creation before a request becomes eligible for a processing.
    ///
    ///         For example, if a request was created at 9 am and
    ///         redemptionRequestMinAge is 2 hours, the request is eligible for
    ///         processing after 11 am.
    ///
    /// @dev Forcing request minimum age ensures block finality for Ethereum.
    uint32 public redemptionRequestMinAge;

    /// @notice Each redemption request can be technically handled until it
    ///         reaches its timeout timestamp after which it can be reported
    ///         as timed out. However, allowing the wallet to handle requests
    ///         that are close to their timeout timestamp may cause a race
    ///         between the wallet and the redeemer. In result, the wallet may
    ///         redeem the requested funds even though the redeemer already
    ///         received back their tBTC (locked during redemption request) upon
    ///         reporting the request timeout. In effect, the redeemer may end
    ///         out with both tBTC and redeemed BTC in their hands which has
    ///         a negative impact on the tBTC <-> BTC peg. In order to mitigate
    ///         that problem, this parameter determines a safety margin that
    ///         puts the latest moment a request can be handled far before the
    ///         point after which the request can be reported as timed out.
    ///
    ///         For example, if a request times out after 8 pm and
    ///         redemptionRequestTimeoutSafetyMargin is 2 hours, the request is
    ///         valid for processing only before 6 pm.
    uint32 public redemptionRequestTimeoutSafetyMargin;

    /// @notice The maximum count of redemption requests that can be processed
    ///         within a single redemption.
    uint16 public redemptionMaxSize;

    /// @notice Gas that is meant to balance the redemption proposal
    ///         submission overall cost. Can be updated by the owner based on
    ///         the current conditions.
    uint32 public redemptionProposalSubmissionGasOffset;

    event CoordinatorAdded(address indexed coordinator);

    event CoordinatorRemoved(address indexed coordinator);

    event WalletManuallyUnlocked(bytes20 indexed walletPubKeyHash);

    event HeartbeatRequestParametersUpdated(
        uint32 heartbeatRequestValidity,
        uint32 heartbeatRequestGasOffset
    );

    event HeartbeatRequestSubmitted(
        bytes20 walletPubKeyHash,
        bytes message,
        address indexed coordinator
    );

    event DepositSweepProposalParametersUpdated(
        uint32 depositSweepProposalValidity,
        uint32 depositMinAge,
        uint32 depositRefundSafetyMargin,
        uint16 depositSweepMaxSize,
        uint32 depositSweepProposalSubmissionGasOffset
    );

    event DepositSweepProposalSubmitted(
        DepositSweepProposal proposal,
        address indexed coordinator
    );

    event RedemptionProposalParametersUpdated(
        uint32 redemptionProposalValidity,
        uint32 redemptionRequestMinAge,
        uint32 redemptionRequestTimeoutSafetyMargin,
        uint16 redemptionMaxSize,
        uint32 redemptionProposalSubmissionGasOffset
    );

    event RedemptionProposalSubmitted(
        RedemptionProposal proposal,
        address indexed coordinator
    );

    modifier onlyCoordinator() {
        require(isCoordinator[msg.sender], "Caller is not a coordinator");
        _;
    }

    modifier onlyAfterWalletLock(bytes20 walletPubKeyHash) {
        require(
            /* solhint-disable-next-line not-rely-on-time */
            block.timestamp > walletLock[walletPubKeyHash].expiresAt,
            "Wallet locked"
        );
        _;
    }

    modifier onlyReimbursableAdmin() override {
        require(owner() == msg.sender, "Caller is not the owner");
        _;
    }

    function initialize(Bridge _bridge) external initializer {
        __Ownable_init();

        bridge = _bridge;
        // Pre-fetch addresses to save gas later.
        (, , , reimbursementPool) = _bridge.contractReferences();

        heartbeatRequestValidity = 1 hours;
        heartbeatRequestGasOffset = 10_000;

        depositSweepProposalValidity = 4 hours;
        depositMinAge = 2 hours;
        depositRefundSafetyMargin = 24 hours;
        depositSweepMaxSize = 5;
        depositSweepProposalSubmissionGasOffset = 20_000; // optimized for 10 inputs

        redemptionProposalValidity = 2 hours;
        redemptionRequestMinAge = 600; // 10 minutes or ~50 blocks.
        redemptionRequestTimeoutSafetyMargin = 2 hours;
        redemptionMaxSize = 20;
        redemptionProposalSubmissionGasOffset = 20_000;
    }

    /// @notice Adds the given address to the set of coordinator addresses.
    /// @param coordinator Address of the new coordinator.
    /// @dev Requirements:
    ///      - The caller must be the owner,
    ///      - The `coordinator` must not be an existing coordinator.
    function addCoordinator(address coordinator) external onlyOwner {
        require(
            !isCoordinator[coordinator],
            "This address is already a coordinator"
        );
        isCoordinator[coordinator] = true;
        emit CoordinatorAdded(coordinator);
    }

    /// @notice Removes the given address from the set of coordinator addresses.
    /// @param coordinator Address of the existing coordinator.
    /// @dev Requirements:
    ///      - The caller must be the owner,
    ///      - The `coordinator` must be an existing coordinator.
    function removeCoordinator(address coordinator) external onlyOwner {
        require(
            isCoordinator[coordinator],
            "This address is not a coordinator"
        );
        delete isCoordinator[coordinator];
        emit CoordinatorRemoved(coordinator);
    }

    /// @notice Allows to unlock the given wallet before their time lock expires.
    ///         This function should be used in exceptional cases where
    ///         something went wrong and there is a need to unlock the wallet
    ///         without waiting.
    /// @param walletPubKeyHash 20-byte public key hash of the wallet
    /// @dev Requirements:
    ///      - The caller must be the owner.
    function unlockWallet(bytes20 walletPubKeyHash) external onlyOwner {
        // Just in case, allow the owner to unlock the wallet earlier.
        walletLock[walletPubKeyHash] = WalletLock(0, WalletAction.Idle);
        emit WalletManuallyUnlocked(walletPubKeyHash);
    }

    /// @notice Updates parameters related to heartbeat request.
    /// @param _heartbeatRequestValidity The new value of `heartbeatRequestValidity`.
    /// @param _heartbeatRequestGasOffset The new value of `heartbeatRequestGasOffset`.
    /// @dev Requirements:
    ///      - The caller must be the owner.
    function updateHeartbeatRequestParameters(
        uint32 _heartbeatRequestValidity,
        uint32 _heartbeatRequestGasOffset
    ) external onlyOwner {
        heartbeatRequestValidity = _heartbeatRequestValidity;
        heartbeatRequestGasOffset = _heartbeatRequestGasOffset;
        emit HeartbeatRequestParametersUpdated(
            _heartbeatRequestValidity,
            _heartbeatRequestGasOffset
        );
    }

    /// @notice Updates parameters related to deposit sweep proposal.
    /// @param _depositSweepProposalValidity The new value of `depositSweepProposalValidity`.
    /// @param _depositMinAge The new value of `depositMinAge`.
    /// @param _depositRefundSafetyMargin The new value of `depositRefundSafetyMargin`.
    /// @param _depositSweepMaxSize The new value of `depositSweepMaxSize`.
    /// @dev Requirements:
    ///      - The caller must be the owner.
    function updateDepositSweepProposalParameters(
        uint32 _depositSweepProposalValidity,
        uint32 _depositMinAge,
        uint32 _depositRefundSafetyMargin,
        uint16 _depositSweepMaxSize,
        uint32 _depositSweepProposalSubmissionGasOffset
    ) external onlyOwner {
        depositSweepProposalValidity = _depositSweepProposalValidity;
        depositMinAge = _depositMinAge;
        depositRefundSafetyMargin = _depositRefundSafetyMargin;
        depositSweepMaxSize = _depositSweepMaxSize;
        depositSweepProposalSubmissionGasOffset = _depositSweepProposalSubmissionGasOffset;

        emit DepositSweepProposalParametersUpdated(
            _depositSweepProposalValidity,
            _depositMinAge,
            _depositRefundSafetyMargin,
            _depositSweepMaxSize,
            _depositSweepProposalSubmissionGasOffset
        );
    }

    /// @notice Submits a heartbeat request from the wallet. Locks the wallet
    ///         for a specific time, equal to the request validity period.
    ///         This function validates the proposed heartbeat messge to see
    ///         if it matches the heartbeat format expected by the Bridge.
    /// @param walletPubKeyHash 20-byte public key hash of the wallet that is
    ///        supposed to execute the heartbeat.
    /// @param message The proposed heartbeat message for the wallet to sign.
    /// @dev Requirements:
    ///      - The caller is a coordinator,
    ///      - The wallet is not time-locked,
    ///      - The message to sign is a valid heartbeat message.
    function requestHeartbeat(bytes20 walletPubKeyHash, bytes calldata message)
        public
        onlyCoordinator
        onlyAfterWalletLock(walletPubKeyHash)
    {
        require(
            Heartbeat.isValidHeartbeatMessage(message),
            "Not a valid heartbeat message"
        );

        walletLock[walletPubKeyHash] = WalletLock(
            /* solhint-disable-next-line not-rely-on-time */
            uint32(block.timestamp) + heartbeatRequestValidity,
            WalletAction.Heartbeat
        );

        emit HeartbeatRequestSubmitted(walletPubKeyHash, message, msg.sender);
    }

    /// @notice Wraps `requestHeartbeat` call and reimburses the caller's
    ///         transaction cost.
    /// @dev See `requestHeartbeat` function documentation.
    function requestHeartbeatWithReimbursement(
        bytes20 walletPubKeyHash,
        bytes calldata message
    ) external {
        uint256 gasStart = gasleft();

        requestHeartbeat(walletPubKeyHash, message);

        reimbursementPool.refund(
            (gasStart - gasleft()) + heartbeatRequestGasOffset,
            msg.sender
        );
    }

    /// @notice Submits a deposit sweep proposal. Locks the target wallet
    ///         for a specific time, equal to the proposal validity period.
    ///         This function does not store the proposal in the state but
    ///         just emits an event that serves as a guiding light for wallet
    ///         off-chain members. Wallet members are supposed to validate
    ///         the proposal on their own, before taking any action.
    /// @param proposal The deposit sweep proposal
    /// @dev Requirements:
    ///      - The caller is a coordinator,
    ///      - The wallet is not time-locked.
    function submitDepositSweepProposal(DepositSweepProposal calldata proposal)
        public
        onlyCoordinator
        onlyAfterWalletLock(proposal.walletPubKeyHash)
    {
        walletLock[proposal.walletPubKeyHash] = WalletLock(
            /* solhint-disable-next-line not-rely-on-time */
            uint32(block.timestamp) + depositSweepProposalValidity,
            WalletAction.DepositSweep
        );

        emit DepositSweepProposalSubmitted(proposal, msg.sender);
    }

    /// @notice Wraps `submitDepositSweepProposal` call and reimburses the
    ///         caller's transaction cost.
    /// @dev See `submitDepositSweepProposal` function documentation.
    function submitDepositSweepProposalWithReimbursement(
        DepositSweepProposal calldata proposal
    ) external {
        uint256 gasStart = gasleft();

        submitDepositSweepProposal(proposal);

        reimbursementPool.refund(
            (gasStart - gasleft()) + depositSweepProposalSubmissionGasOffset,
            msg.sender
        );
    }

    /// @notice View function encapsulating the main rules of a valid deposit
    ///         sweep proposal. This function is meant to facilitate the off-chain
    ///         validation of the incoming proposals. Thanks to it, most
    ///         of the work can be done using a single readonly contract call.
    ///         Worth noting, the validation done here is not exhaustive as some
    ///         conditions may not be verifiable within the on-chain function or
    ///         checking them may be easier on the off-chain side. For example,
    ///         this function does not check the SPV proofs and confirmations of
    ///         the deposit funding transactions as this would require an
    ///         integration with the difficulty relay that greatly increases
    ///         complexity. Instead of that, each off-chain wallet member is
    ///         supposed to do that check on their own.
    /// @param proposal The sweeping proposal to validate.
    /// @param depositsExtraInfo Deposits extra data required to perform the validation.
    /// @return True if the proposal is valid. Reverts otherwise.
    /// @dev Requirements:
    ///      - The target wallet must be in the Live state,
    ///      - The number of deposits included in the sweep must be in
    ///        the range [1, `depositSweepMaxSize`],
    ///      - The length of `depositsExtraInfo` array must be equal to the
    ///        length of `proposal.depositsKeys`, i.e. each deposit must
    ///        have exactly one set of corresponding extra data,
    ///      - The proposed sweep tx fee must be grater than zero,
    ///      - The proposed maximum per-deposit sweep tx fee must be lesser than
    ///        or equal the maximum fee allowed by the Bridge (`Bridge.depositTxMaxFee`),
    ///      - Each deposit must be revealed to the Bridge,
    ///      - Each deposit must be old enough, i.e. at least `depositMinAge`
    ///        elapsed since their reveal time,
    ///      - Each deposit must not be swept yet,
    ///      - Each deposit must have valid extra data (see `validateDepositExtraInfo`),
    ///      - Each deposit must have the refund safety margin preserved,
    ///      - Each deposit must be controlled by the same wallet,
    ///      - Each deposit must target the same vault,
    ///      - Each deposit must be unique.
    ///
    ///      The following off-chain validation must be performed as a bare minimum:
    ///      - Inputs used for the sweep transaction have enough Bitcoin confirmations,
    ///      - Deposits revealed to the Bridge have enough Ethereum confirmations.
    function validateDepositSweepProposal(
        DepositSweepProposal calldata proposal,
        DepositExtraInfo[] calldata depositsExtraInfo
    ) external view returns (bool) {
        require(
            bridge.wallets(proposal.walletPubKeyHash).state ==
                Wallets.WalletState.Live,
            "Wallet is not in Live state"
        );

        require(proposal.depositsKeys.length > 0, "Sweep below the min size");

        require(
            proposal.depositsKeys.length <= depositSweepMaxSize,
            "Sweep exceeds the max size"
        );

        require(
            proposal.depositsKeys.length == depositsExtraInfo.length,
            "Each deposit key must have matching extra data"
        );

        validateSweepTxFee(proposal.sweepTxFee, proposal.depositsKeys.length);

        address proposalVault = address(0);

        uint256[] memory processedDepositKeys = new uint256[](
            proposal.depositsKeys.length
        );

        for (uint256 i = 0; i < proposal.depositsKeys.length; i++) {
            DepositKey memory depositKey = proposal.depositsKeys[i];
            DepositExtraInfo memory depositExtraInfo = depositsExtraInfo[i];

            uint256 depositKeyUint = uint256(
                keccak256(
                    abi.encodePacked(
                        depositKey.fundingTxHash,
                        depositKey.fundingOutputIndex
                    )
                )
            );

            // slither-disable-next-line calls-loop
            Deposit.DepositRequest memory depositRequest = bridge.deposits(
                depositKeyUint
            );

            require(depositRequest.revealedAt != 0, "Deposit not revealed");

            require(
                /* solhint-disable-next-line not-rely-on-time */
                block.timestamp > depositRequest.revealedAt + depositMinAge,
                "Deposit min age not achieved yet"
            );

            require(depositRequest.sweptAt == 0, "Deposit already swept");

            validateDepositExtraInfo(
                depositKey,
                depositRequest.depositor,
                depositExtraInfo
            );

            uint32 depositRefundableTimestamp = BTCUtils.reverseUint32(
                uint32(depositExtraInfo.refundLocktime)
            );
            require(
                /* solhint-disable-next-line not-rely-on-time */
                block.timestamp <
                    depositRefundableTimestamp - depositRefundSafetyMargin,
                "Deposit refund safety margin is not preserved"
            );

            require(
                depositExtraInfo.walletPubKeyHash == proposal.walletPubKeyHash,
                "Deposit controlled by different wallet"
            );

            // Make sure all deposits target the same vault by using the
            // vault of the first deposit as a reference.
            if (i == 0) {
                proposalVault = depositRequest.vault;
            }
            require(
                depositRequest.vault == proposalVault,
                "Deposit targets different vault"
            );

            // Make sure there are no duplicates in the deposits list.
            for (uint256 j = 0; j < i; j++) {
                require(
                    processedDepositKeys[j] != depositKeyUint,
                    "Duplicated deposit"
                );
            }

            processedDepositKeys[i] = depositKeyUint;
        }

        return true;
    }

    /// @notice Validates the sweep tx fee by checking if the part of the fee
    ///         incurred by each deposit does not exceed the maximum value
    ///         allowed by the Bridge. This function is heavily based on
    ///         `DepositSweep.depositSweepTxFeeDistribution` function.
    /// @param sweepTxFee The sweep transaction fee.
    /// @param depositsCount Count of the deposits swept by the sweep transaction.
    /// @dev Requirements:
    ///      - The sweep tx fee must be grater than zero,
    ///      - The maximum per-deposit sweep tx fee must be lesser than or equal
    ///        the maximum fee allowed by the Bridge (`Bridge.depositTxMaxFee`).
    function validateSweepTxFee(uint256 sweepTxFee, uint256 depositsCount)
        internal
        view
    {
        require(sweepTxFee > 0, "Proposed transaction fee cannot be zero");

        // Compute the indivisible remainder that remains after dividing the
        // sweep transaction fee over all deposits evenly.
        uint256 depositTxFeeRemainder = sweepTxFee % depositsCount;
        // Compute the transaction fee per deposit by dividing the sweep
        // transaction fee (reduced by the remainder) by the number of deposits.
        uint256 depositTxFee = (sweepTxFee - depositTxFeeRemainder) /
            depositsCount;

        (, , uint64 depositTxMaxFee, ) = bridge.depositParameters();

        // The transaction fee is incurred by each deposit evenly except for the last
        // deposit that has the indivisible remainder additionally incurred.
        // See `DepositSweep.submitDepositSweepProof`.
        // We must make sure the highest value of the deposit transaction fee does
        // not exceed the maximum value limited by the governable parameter.
        require(
            depositTxFee + depositTxFeeRemainder <= depositTxMaxFee,
            "Proposed transaction fee is too high"
        );
    }

    /// @notice Validates the extra data for the given deposit. This function
    ///         is heavily based on `Deposit.revealDeposit` function.
    /// @param depositKey Key of the given deposit.
    /// @param depositor Depositor that revealed the deposit.
    /// @param depositExtraInfo Extra data being subject of the validation.
    /// @dev Requirements:
    ///      - The transaction hash computed using `depositExtraInfo.fundingTx`
    ///        must match the `depositKey.fundingTxHash`. This requirement
    ///        ensures the funding transaction data provided in the extra
    ///        data container actually represent the funding transaction of
    ///        the given deposit.
    ///      - The P2(W)SH script inferred from `depositExtraInfo` is actually
    ///        used to lock funds by the `depositKey.fundingOutputIndex` output
    ///        of the `depositExtraInfo.fundingTx` transaction. This requirement
    ///        ensures the reveal data provided in the extra data container
    ///        actually matches the given deposit.
    function validateDepositExtraInfo(
        DepositKey memory depositKey,
        address depositor,
        DepositExtraInfo memory depositExtraInfo
    ) internal view {
        bytes32 depositExtraFundingTxHash = abi
            .encodePacked(
                depositExtraInfo.fundingTx.version,
                depositExtraInfo.fundingTx.inputVector,
                depositExtraInfo.fundingTx.outputVector,
                depositExtraInfo.fundingTx.locktime
            )
            .hash256View();

        // Make sure the funding tx provided as part of deposit extra data
        // actually matches the deposit referred by the given deposit key.
        if (depositKey.fundingTxHash != depositExtraFundingTxHash) {
            revert("Extra info funding tx hash does not match");
        }

        bytes memory expectedScript = abi.encodePacked(
            hex"14", // Byte length of depositor Ethereum address.
            depositor,
            hex"75", // OP_DROP
            hex"08", // Byte length of blinding factor value.
            depositExtraInfo.blindingFactor,
            hex"75", // OP_DROP
            hex"76", // OP_DUP
            hex"a9", // OP_HASH160
            hex"14", // Byte length of a compressed Bitcoin public key hash.
            depositExtraInfo.walletPubKeyHash,
            hex"87", // OP_EQUAL
            hex"63", // OP_IF
            hex"ac", // OP_CHECKSIG
            hex"67", // OP_ELSE
            hex"76", // OP_DUP
            hex"a9", // OP_HASH160
            hex"14", // Byte length of a compressed Bitcoin public key hash.
            depositExtraInfo.refundPubKeyHash,
            hex"88", // OP_EQUALVERIFY
            hex"04", // Byte length of refund locktime value.
            depositExtraInfo.refundLocktime,
            hex"b1", // OP_CHECKLOCKTIMEVERIFY
            hex"75", // OP_DROP
            hex"ac", // OP_CHECKSIG
            hex"68" // OP_ENDIF
        );

        bytes memory fundingOutput = depositExtraInfo
            .fundingTx
            .outputVector
            .extractOutputAtIndex(depositKey.fundingOutputIndex);
        bytes memory fundingOutputHash = fundingOutput.extractHash();

        // Path that checks the deposit extra data validity in case the
        // referred deposit is a P2SH.
        if (
            // slither-disable-next-line calls-loop
            fundingOutputHash.length == 20 &&
            fundingOutputHash.slice20(0) == expectedScript.hash160View()
        ) {
            return;
        }

        // Path that checks the deposit extra data validity in case the
        // referred deposit is a P2WSH.
        if (
            fundingOutputHash.length == 32 &&
            fundingOutputHash.toBytes32() == sha256(expectedScript)
        ) {
            return;
        }

        revert("Extra info funding output script does not match");
    }

    /// @notice Updates parameters related to redemption proposal.
    /// @param _redemptionProposalValidity The new value of `redemptionProposalValidity`.
    /// @param _redemptionRequestMinAge The new value of `redemptionRequestMinAge`.
    /// @param _redemptionRequestTimeoutSafetyMargin The new value of
    ///        `redemptionRequestTimeoutSafetyMargin`.
    /// @param _redemptionMaxSize The new value of `redemptionMaxSize`.
    /// @param _redemptionProposalSubmissionGasOffset The new value of
    ///        `redemptionProposalSubmissionGasOffset`.
    /// @dev Requirements:
    ///      - The caller must be the owner.
    function updateRedemptionProposalParameters(
        uint32 _redemptionProposalValidity,
        uint32 _redemptionRequestMinAge,
        uint32 _redemptionRequestTimeoutSafetyMargin,
        uint16 _redemptionMaxSize,
        uint32 _redemptionProposalSubmissionGasOffset
    ) external onlyOwner {
        redemptionProposalValidity = _redemptionProposalValidity;
        redemptionRequestMinAge = _redemptionRequestMinAge;
        redemptionRequestTimeoutSafetyMargin = _redemptionRequestTimeoutSafetyMargin;
        redemptionMaxSize = _redemptionMaxSize;
        redemptionProposalSubmissionGasOffset = _redemptionProposalSubmissionGasOffset;

        emit RedemptionProposalParametersUpdated(
            _redemptionProposalValidity,
            _redemptionRequestMinAge,
            _redemptionRequestTimeoutSafetyMargin,
            _redemptionMaxSize,
            _redemptionProposalSubmissionGasOffset
        );
    }

    /// @notice Submits a redemption proposal. Locks the target wallet
    ///         for a specific time, equal to the proposal validity period.
    ///         This function does not store the proposal in the state but
    ///         just emits an event that serves as a guiding light for wallet
    ///         off-chain members. Wallet members are supposed to validate
    ///         the proposal on their own, before taking any action.
    /// @param proposal The redemption proposal
    /// @dev Requirements:
    ///      - The caller is a coordinator,
    ///      - The wallet is not time-locked.
    function submitRedemptionProposal(RedemptionProposal calldata proposal)
        public
        onlyCoordinator
        onlyAfterWalletLock(proposal.walletPubKeyHash)
    {
        walletLock[proposal.walletPubKeyHash] = WalletLock(
            /* solhint-disable-next-line not-rely-on-time */
            uint32(block.timestamp) + redemptionProposalValidity,
            WalletAction.Redemption
        );

        emit RedemptionProposalSubmitted(proposal, msg.sender);
    }

    /// @notice Wraps `submitRedemptionProposal` call and reimburses the
    ///         caller's transaction cost.
    /// @dev See `submitRedemptionProposal` function documentation.
    function submitRedemptionProposalWithReimbursement(
        RedemptionProposal calldata proposal
    ) external {
        uint256 gasStart = gasleft();

        submitRedemptionProposal(proposal);

        reimbursementPool.refund(
            (gasStart - gasleft()) + redemptionProposalSubmissionGasOffset,
            msg.sender
        );
    }

    /// @notice View function encapsulating the main rules of a valid redemption
    ///         proposal. This function is meant to facilitate the off-chain
    ///         validation of the incoming proposals. Thanks to it, most
    ///         of the work can be done using a single readonly contract call.
    /// @param proposal The redemption proposal to validate.
    /// @return True if the proposal is valid. Reverts otherwise.
    /// @dev Requirements:
    ///      - The target wallet must be in the Live state,
    ///      - The number of redemption requests included in the redemption
    ///        proposal must be in the range [1, `redemptionMaxSize`],
    ///      - The proposed redemption tx fee must be grater than zero,
    ///      - The proposed redemption tx fee must be lesser than or equal to
    ///        the maximum total fee allowed by the Bridge
    ///        (`Bridge.redemptionTxMaxTotalFee`),
    ///      - The proposed maximum per-request redemption tx fee share must be
    ///        lesser than or equal to the maximum fee share allowed by the
    ///        given request (`RedemptionRequest.txMaxFee`),
    ///      - Each request must be a pending request registered in the Bridge,
    ///      - Each request must be old enough, i.e. at least `redemptionRequestMinAge`
    ///        elapsed since their creation time,
    ///      - Each request must have the timeout safety margin preserved,
    ///      - Each request must be unique.
    function validateRedemptionProposal(RedemptionProposal calldata proposal)
        external
        view
        returns (bool)
    {
        require(
            bridge.wallets(proposal.walletPubKeyHash).state ==
                Wallets.WalletState.Live,
            "Wallet is not in Live state"
        );

        uint256 requestsCount = proposal.redeemersOutputScripts.length;

        require(requestsCount > 0, "Redemption below the min size");

        require(
            requestsCount <= redemptionMaxSize,
            "Redemption exceeds the max size"
        );

        (
            ,
            ,
            ,
            uint64 redemptionTxMaxTotalFee,
            uint32 redemptionTimeout,
            ,

        ) = bridge.redemptionParameters();

        require(
            proposal.redemptionTxFee > 0,
            "Proposed transaction fee cannot be zero"
        );

        // Make sure the proposed fee does not exceed the total fee limit.
        require(
            proposal.redemptionTxFee <= redemptionTxMaxTotalFee,
            "Proposed transaction fee is too high"
        );

        // Compute the indivisible remainder that remains after dividing the
        // redemption transaction fee over all requests evenly.
        uint256 redemptionTxFeeRemainder = proposal.redemptionTxFee %
            requestsCount;
        // Compute the transaction fee per request by dividing the redemption
        // transaction fee (reduced by the remainder) by the number of requests.
        uint256 redemptionTxFeePerRequest = (proposal.redemptionTxFee -
            redemptionTxFeeRemainder) / requestsCount;

        uint256[] memory processedRedemptionKeys = new uint256[](requestsCount);

        for (uint256 i = 0; i < requestsCount; i++) {
            bytes memory script = proposal.redeemersOutputScripts[i];

            // As the wallet public key hash is part of the redemption key,
            // we have an implicit guarantee that all requests being part
            // of the proposal target the same wallet.
            uint256 redemptionKey = uint256(
                keccak256(
                    abi.encodePacked(
                        keccak256(script),
                        proposal.walletPubKeyHash
                    )
                )
            );

            // slither-disable-next-line calls-loop
            Redemption.RedemptionRequest memory redemptionRequest = bridge
                .pendingRedemptions(redemptionKey);

            require(
                redemptionRequest.requestedAt != 0,
                "Not a pending redemption request"
            );

            require(
                /* solhint-disable-next-line not-rely-on-time */
                block.timestamp >
                    redemptionRequest.requestedAt + redemptionRequestMinAge,
                "Redemption request min age not achieved yet"
            );

            // Calculate the timeout the given request times out at.
            uint32 requestTimeout = redemptionRequest.requestedAt +
                redemptionTimeout;
            // Make sure we are far enough from the moment the request times out.
            require(
                /* solhint-disable-next-line not-rely-on-time */
                block.timestamp <
                    requestTimeout - redemptionRequestTimeoutSafetyMargin,
                "Redemption request timeout safety margin is not preserved"
            );

            uint256 feePerRequest = redemptionTxFeePerRequest;
            // The last request incurs the fee remainder.
            if (i == requestsCount - 1) {
                feePerRequest += redemptionTxFeeRemainder;
            }
            // Make sure the redemption transaction fee share incurred by
            // the given request fits in the limit for that request.
            require(
                feePerRequest <= redemptionRequest.txMaxFee,
                "Proposed transaction per-request fee share is too high"
            );

            // Make sure there are no duplicates in the requests list.
            for (uint256 j = 0; j < i; j++) {
                require(
                    processedRedemptionKeys[j] != redemptionKey,
                    "Duplicated request"
                );
            }

            processedRedemptionKeys[i] = redemptionKey;
        }

        return true;
    }
}
