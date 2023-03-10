import {
  Transaction,
  Proof,
  TransactionMerkleBranch,
  Client as BitcoinClient,
  TransactionHash,
  computeHash256,
  deserializeBlockHeader,
  bitsToTarget,
  targetToDifficulty,
  hashLEToBigNumber,
  serializeBlockHeader,
  BlockHeader,
} from "./bitcoin"
import { BigNumber } from "ethers"
import { Hex } from "./hex"

/**
 * Assembles a proof that a given transaction was included in the blockchain and
 * has accumulated the required number of confirmations.
 * @param transactionHash - Hash of the transaction being proven.
 * @param requiredConfirmations - Required number of confirmations.
 * @param bitcoinClient - Bitcoin client used to interact with the network.
 * @returns Bitcoin transaction along with the inclusion proof.
 */
export async function assembleTransactionProof(
  transactionHash: TransactionHash,
  requiredConfirmations: number,
  bitcoinClient: BitcoinClient
): Promise<Transaction & Proof> {
  const transaction = await bitcoinClient.getTransaction(transactionHash)
  const confirmations = await bitcoinClient.getTransactionConfirmations(
    transactionHash
  )

  if (confirmations < requiredConfirmations) {
    throw new Error(
      "Transaction confirmations number[" +
        confirmations +
        "] is not enough, required [" +
        requiredConfirmations +
        "]"
    )
  }

  const latestBlockHeight = await bitcoinClient.latestBlockHeight()
  const txBlockHeight = latestBlockHeight - confirmations + 1

  // We subtract `1` from `requiredConfirmations` because the header at
  // `txBlockHeight` is already included in the headers chain and is considered
  // the first confirmation. So we only need to retrieve `requiredConfirmations - 1`
  // subsequent block headers to reach the desired number of confirmations for
  // the transaction.
  const headersChain = await bitcoinClient.getHeadersChain(
    txBlockHeight,
    requiredConfirmations - 1
  )

  const merkleBranch = await bitcoinClient.getTransactionMerkle(
    transactionHash,
    txBlockHeight
  )

  const merkleProof = createMerkleProof(merkleBranch)

  const proof = {
    merkleProof: merkleProof,
    txIndexInBlock: merkleBranch.position,
    bitcoinHeaders: headersChain,
  }

  return { ...transaction, ...proof }
}

/**
 * Create a proof of transaction inclusion in the block by concatenating
 * 32-byte-long hash values. The values are converted to little endian form.
 * @param txMerkleBranch - Branch of a Merkle tree leading to a transaction.
 * @returns Transaction inclusion proof in hexadecimal form.
 */
function createMerkleProof(txMerkleBranch: TransactionMerkleBranch): string {
  let proof = Buffer.from("")
  txMerkleBranch.merkle.forEach(function (item) {
    proof = Buffer.concat([proof, Buffer.from(item, "hex").reverse()])
  })
  return proof.toString("hex")
}

/**
 * Proves that a transaction with the given hash is included in the Bitcoin
 * blockchain by validating the transaction's inclusion in the Merkle tree and
 * verifying that the block containing the transaction has enough confirmations.
 * @param transactionHash The hash of the transaction to be validated.
 * @param requiredConfirmations The number of confirmations required for the
 *        transaction to be considered valid. The transaction has 1 confirmation
 *        when it is in the block at the current blockchain tip. Every subsequent
 *        block added to the blockchain is one additional confirmation.
 * @param previousDifficulty The difficulty of the previous Bitcoin epoch.
 * @param currentDifficulty The difficulty of the current Bitcoin epoch.
 * @param bitcoinClient The client for interacting with the Bitcoin blockchain.
 * @throws {Error} If the transaction is not included in the Bitcoin blockchain
 *        or if the block containing the transaction does not have enough
 *        confirmations.
 * @dev The function should be used within a try-catch block.
 * @returns An empty return value.
 */
export async function validateTransactionProof(
  transactionHash: TransactionHash,
  requiredConfirmations: number,
  previousDifficulty: BigNumber,
  currentDifficulty: BigNumber,
  bitcoinClient: BitcoinClient
) {
  if (requiredConfirmations < 1) {
    throw new Error("The number of required confirmations but at least 1")
  }

  const proof = await assembleTransactionProof(
    transactionHash,
    requiredConfirmations,
    bitcoinClient
  )

  const bitcoinHeaders: BlockHeader[] = splitHeaders(proof.bitcoinHeaders)
  if (bitcoinHeaders.length != requiredConfirmations) {
    throw new Error("Wrong number of confirmations")
  }

  const merkleRootHash: Hex = bitcoinHeaders[0].merkleRootHash
  const intermediateNodeHashes: Hex[] = splitMerkleProof(proof.merkleProof)

  validateMerkleTree(
    transactionHash,
    merkleRootHash,
    intermediateNodeHashes,
    proof.txIndexInBlock
  )

  validateBlockHeadersChain(
    bitcoinHeaders,
    previousDifficulty,
    currentDifficulty
  )
}

/**
 * Validates the Merkle tree by checking if the provided transaction hash,
 * Merkle root hash, intermediate node hashes, and transaction index parameters
 * produce a valid Merkle proof.
 * @param transactionHash The hash of the transaction being validated.
 * @param merkleRootHash The Merkle root hash that the intermediate node hashes
 *        should compute to.
 * @param intermediateNodeHashes The Merkle tree intermediate node hashes.
 *        This is a list of hashes the transaction being validated is paired
 *        with in the Merkle tree.
 * @param transactionIndex The index of the transaction being validated within
 *        the block, used to determine the path to traverse in the Merkle tree.
 * @throws {Error} If the Merkle tree is not valid.
 * @returns An empty return value.
 */
function validateMerkleTree(
  transactionHash: TransactionHash,
  merkleRootHash: Hex,
  intermediateNodeHashes: Hex[],
  transactionIndex: number
) {
  // Shortcut for a block that contains only a single transaction (coinbase).
  if (
    transactionHash.reverse().equals(merkleRootHash) &&
    transactionIndex == 0 &&
    intermediateNodeHashes.length == 0
  ) {
    return
  }

  validateMerkleTreeHashes(
    transactionHash,
    merkleRootHash,
    intermediateNodeHashes,
    transactionIndex
  )
}

/**
 * Validates the transaction's Merkle proof by traversing the Merkle tree
 * starting from the provided transaction hash and using the intermediate node
 * hashes to compute the root hash. If the computed root hash does not match the
 * merkle root hash, an error is thrown.
 * @param transactionHash The hash of the transaction being validated.
 * @param merkleRootHash The Merkle root hash that the intermediate nodes should
 *        compute to.
 * @param intermediateNodeHashes The Merkle tree intermediate node hashes.
 *        This is a list of hashes the transaction being validated is paired
 *        with in the Merkle tree.
 * @param transactionIndex The index of the transaction in the block, used
 *        to determine the path to traverse in the Merkle tree.
 * @throws {Error} If the intermediate nodes are of an invalid length or if the
 *         computed root hash does not match the merkle root hash parameter.
 * @returns An empty return value.
 */
function validateMerkleTreeHashes(
  transactionHash: TransactionHash,
  merkleRootHash: Hex,
  intermediateNodeHashes: Hex[],
  transactionIndex: number
) {
  // To prove the transaction inclusion in a block we only need the hashes that
  // form a path from the transaction being validated to the Merkle root hash.
  // If the Merkle tree looks like this:
  //
  //           h_01234567
  //          /           \
  //      h_0123          h_4567
  //     /      \       /        \
  //   h_01    h_23    h_45     h_67
  //   /  \    /  \    /  \    /   \
  //  h_0 h_1 h_2 h_3 h_4 h_5 h_6 h_7
  //
  // and the transaction hash to be validated is h_5 the following data
  // will be used:
  // - `transactionHash`: h_5
  // - `merkleRootHash`: h_01234567
  // - `intermediateNodeHashes`: [h_4, h_67, h_0123]
  // - `transactionIndex`: 5
  //
  // The following calculations will be performed:
  // - h_4 and h_5 will be hashed to obtain h_45
  // - h_45 and h_67 will be hashed to obtain h_4567
  // - h_0123 will be hashed with h_4567 to obtain h_1234567 (Merkle root hash).

  // Note that when we move up the Merkle tree calculating parent hashes we need
  // to join children hashes. The information which child hash should go first
  // is obtained from `transactionIndex`. When `transactionIndex` is odd the
  // hash taken from `intermediateNodeHashes` must go first. If it is even the
  // hash from previous calculation must go first. The `transactionIndex` is
  // divided by `2` after every hash calculation.

  if (intermediateNodeHashes.length === 0) {
    throw new Error("Invalid merkle tree")
  }

  let idx = transactionIndex
  let currentHash = transactionHash.reverse()

  // Move up the Merkle tree hashing current hash value with hashes taken
  // from `intermediateNodeHashes`. Use `idx` to determine the order of joining
  // children hashes.
  for (let i = 0; i < intermediateNodeHashes.length; i++) {
    if (idx % 2 === 1) {
      // If the current value of idx is odd the hash taken from
      // `intermediateNodeHashes` goes before the current hash.
      currentHash = computeHash256(
        Hex.from(intermediateNodeHashes[i].toString() + currentHash.toString())
      )
    } else {
      // If the current value of idx is even the hash taken from the current
      // hash goes before the hash taken from `intermediateNodeHashes`.
      currentHash = computeHash256(
        Hex.from(currentHash.toString() + intermediateNodeHashes[i].toString())
      )
    }

    // Divide the value of `idx` by `2` when we move one level up the Merkle
    // tree.
    idx = idx >> 1
  }

  // Verify we arrived at the same value of Merkle root hash as the one stored
  // in the block header.
  if (!currentHash.equals(merkleRootHash)) {
    throw new Error(
      "Transaction Merkle proof is not valid for provided header and transaction hash"
    )
  }
}

/**
 * Validates a chain of consecutive block headers by checking each header's
 * difficulty, hash, and continuity with the previous header. This function can
 * be used to validate a series of Bitcoin block headers for their validity.
 * @param blockHeaders An array of block headers that form the chain to be
 *        validated.
 * @param previousEpochDifficulty The difficulty of the previous Bitcoin epoch.
 * @param currentEpochDifficulty The difficulty of the current Bitcoin epoch.
 * @dev The block headers must come from Bitcoin epochs with difficulties marked
 *      by the previous and current difficulties. If a Bitcoin difficulty relay
 *      is used to provide these values and the relay is up-to-date, only the
 *      recent block headers will pass validation. Block headers older than the
 *      current and previous Bitcoin epochs will fail.
 * @throws {Error} If any of the block headers are invalid, or if the block
 *         header chain is not continuous.
 * @returns An empty return value.
 */
function validateBlockHeadersChain(
  blockHeaders: BlockHeader[],
  previousEpochDifficulty: BigNumber,
  currentEpochDifficulty: BigNumber
) {
  let requireCurrentDifficulty: boolean = false
  let previousBlockHeaderHash: Hex = Hex.from("00")

  for (let index = 0; index < blockHeaders.length; index++) {
    const currentHeader = blockHeaders[index]

    // Check if the current block header stores the hash of the previously
    // processed block header. Skip the check for the first header.
    if (index !== 0) {
      if (
        !previousBlockHeaderHash.equals(currentHeader.previousBlockHeaderHash)
      ) {
        throw new Error("Invalid headers chain")
      }
    }

    const difficultyTarget = bitsToTarget(currentHeader.bits)

    const currentBlockHeaderHash = computeHash256(
      serializeBlockHeader(currentHeader)
    )

    // Ensure the header has sufficient work.
    if (hashLEToBigNumber(currentBlockHeaderHash).gt(difficultyTarget)) {
      throw new Error("Insufficient work in the header")
    }

    // Save the current block header hash to compare it with the next block
    // header's previous block header hash.
    previousBlockHeaderHash = currentBlockHeaderHash

    // Check if the stored block difficulty is equal to previous or current
    // difficulties.
    const difficulty = targetToDifficulty(difficultyTarget)

    if (previousEpochDifficulty.eq(1) && currentEpochDifficulty.eq(1)) {
      // Special case for Bitcoin Testnet. Do not check block's difficulty
      // due to required difficulty falling to `1` for Testnet.
      continue
    }

    if (
      !difficulty.eq(previousEpochDifficulty) &&
      !difficulty.eq(currentEpochDifficulty)
    ) {
      throw new Error(
        "Header difficulty not at current or previous Bitcoin difficulty"
      )
    }

    // Additionally, require the header to be at current difficulty if some
    // headers at current difficulty have already been seen. This ensures
    // there is at most one switch from previous to current difficulties.
    if (requireCurrentDifficulty && !difficulty.eq(currentEpochDifficulty)) {
      throw new Error("Header must be at current Bitcoin difficulty")
    }

    // If the header is at current difficulty, require the subsequent headers to
    // be at current difficulty as well.
    requireCurrentDifficulty = difficulty.eq(currentEpochDifficulty)
  }
}

/**
 * Splits a given Merkle proof string into an array of intermediate node hashes.
 * @param merkleProof A string representation of the Merkle proof.
 * @returns An array of intermediate node hashes.
 * @throws {Error} If the length of the Merkle proof is not a multiple of 64.
 */
export function splitMerkleProof(merkleProof: string): Hex[] {
  if (merkleProof.length % 64 != 0) {
    throw new Error("Incorrect length of Merkle proof")
  }

  const intermediateNodeHashes: Hex[] = []
  for (let i = 0; i < merkleProof.length; i += 64) {
    intermediateNodeHashes.push(Hex.from(merkleProof.slice(i, i + 64)))
  }

  return intermediateNodeHashes
}

/**
 * Splits Bitcoin block headers in the raw format into an array of BlockHeaders.
 * @param blockHeaders - string that contains block headers in the raw format.
 * @returns Array of BlockHeader objects.
 */
export function splitHeaders(blockHeaders: string): BlockHeader[] {
  if (blockHeaders.length % 160 !== 0) {
    throw new Error("Incorrect length of Bitcoin headers")
  }

  const result: BlockHeader[] = []
  for (let i = 0; i < blockHeaders.length; i += 160) {
    result.push(
      deserializeBlockHeader(Hex.from(blockHeaders.substring(i, i + 160)))
    )
  }

  return result
}
