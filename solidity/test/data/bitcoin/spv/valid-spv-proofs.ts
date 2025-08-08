import type { BytesLike, BigNumberish } from "ethers"

/**
 * Represents SPV proof test data for a Bitcoin transaction
 */
export interface SPVProofTestData {
  name: string
  description: string
  txInfo: {
    version: BytesLike
    inputVector: BytesLike
    outputVector: BytesLike
    locktime: BytesLike
  }
  proof: {
    merkleProof: BytesLike
    txIndexInBlock: BigNumberish
    bitcoinHeaders: BytesLike
    coinbasePreimage: BytesLike
    coinbaseProof: BytesLike
  }
  expectedTxHash: BytesLike
  chainDifficulty?: number
}

/**
 * Valid SPV proof from Bitcoin mainnet
 * Source: https://github.com/keep-network/bitcoin-spv/blob/releases/mainnet/solidity/v3.4.0-solc-0.8/testVectors.json#L910-L916
 * This transaction has been verified on the Bitcoin blockchain
 */
export const ValidMainnetProof: SPVProofTestData = {
  name: "ValidMainnetProof",
  description: "Valid Bitcoin mainnet transaction with complete SPV proof",
  txInfo: {
    version: "0x01000000",
    inputVector:
      "0x011746bd867400f3494b8f44c24b83e1aa58c4f0ff25b4a61cffeffd4bc" +
      "0f9ba300000000000ffffffff",
    outputVector:
      "0x024897070000000000220020a4333e5612ab1a1043b25755c89b16d5518" +
      "4a42f81799e623e6bc39db8539c180000000000000000166a14edb1b5c2f3" +
      "9af0fec151732585b1049b07895211",
    locktime: "0x00000000",
  },
  proof: {
    merkleProof:
      "0xe35a0d6de94b656694589964a252957e4673a9fb1d2f8b4a92e3f0a7bb6" +
      "54fddb94e5a1e6d7f7f499fd1be5dd30a73bf5584bf137da5fdd77cc21aeb" +
      "95b9e35788894be019284bd4fbed6dd6118ac2cb6d26bc4be4e423f55a3a4" +
      "8f2874d8d02a65d9c87d07de21d4dfe7b0a9f4a23cc9a58373e9e6931fefd" +
      "b5afade5df54c91104048df1ee999240617984e18b6f931e2373673d0195b" +
      "8c6987d7ff7650d5ce53bcec46e13ab4f2da1146a7fc621ee672f62bc2274" +
      "2486392d75e55e67b09960c3386a0b49e75f1723d6ab28ac9a2028a0c7286" +
      "6e2111d79d4817b88e17c821937847768d92837bae3832bb8e5a4ab4434b9" +
      "7e00a6c10182f211f592409068d6f5652400d9a3d1cc150a7fb692e874cc4" +
      "2d76bdafc842f2fe0f835a7c24d2d60c109b187d64571efbaa8047be85821" +
      "f8e67e0e85f2f5894bc63d00c2ed9d64",
    txIndexInBlock: 281,
    bitcoinHeaders:
      "0x0000002073bd2184edd9c4fc76642ea6754ee40136970efc10c41900000" +
      "00000000000000296ef123ea96da5cf695f22bf7d94be87d49db1ad7ac371" +
      "ac43c4da4161c8c216349c5ba11928170d38782b00000020fe70e48339d6b" +
      "17fbbf1340d245338f57336e97767cc240000000000000000005af53b865c" +
      "27c6e9b5e5db4c3ea8e024f8329178a79ddb39f7727ea2fe6e6825d1349c5" +
      "ba1192817e2d9515900000020baaea6746f4c16ccb7cd961655b636d39b5f" +
      "e1519b8f15000000000000000000c63a8848a448a43c9e4402bd893f701cd" +
      "11856e14cbbe026699e8fdc445b35a8d93c9c5ba1192817b945dc6c000000" +
      "20f402c0b551b944665332466753f1eebb846a64ef24c7170000000000000" +
      "0000033fc68e070964e908d961cd11033896fa6c9b8b76f64a2db7ea928af" +
      "a7e304257d3f9c5ba11928176164145d0000ff3f63d40efa46403afd71a25" +
      "4b54f2b495b7b0164991c2d22000000000000000000f046dc1b71560b7d07" +
      "86cfbdb25ae320bd9644c98d5c7c77bf9df05cbe96212758419c5ba119281" +
      "7a2bb2caa00000020e2d4f0edd5edd80bdcb880535443747c6b22b48fb620" +
      "0d0000000000000000001d3799aa3eb8d18916f46bf2cf807cb89a9b1b4c5" +
      "6c3f2693711bf1064d9a32435429c5ba1192817752e49ae",
    coinbasePreimage:
      "0x77b98a5e6643973bba49dda18a75140306d2d8694b66f2dcb3561ad5aff" + "0b0c7",
    coinbaseProof:
      "0xdc20dadef477faab2852f2f8ae0c826aa7e05c4de0d36f0e63630429554" +
      "884c371da5974b6f34fa2c3536738f031b49f34e0c9d084d7280f26212e39" +
      "007ebe9ea0870c312745b58128a00a6557851e987ece02294d156f0020336" +
      "e158928e8964292642c6c4dc469f34b7bacf2d8c42115bab6afc9067f2ed3" +
      "0e8749729b63e0889e203ee58e355903c1e71f78c008df6c3597b2cc66d0b" +
      "8aae1a4a33caa775498e531cfb6af58e87db99e0f536dd226d18f43e38641" +
      "48ba5b7faca5c775f10bc810c602e1af2195a34577976921ce009a4ddc0a0" +
      "7f605c96b0f5fcf580831ebbe01a31fa29bde884609d286dccfa5ba8e558c" +
      "e3125bd4c3a19e888cf26852286202d2a7d302c75e0ff5ca8fe7299fb0d9d" +
      "1132bf2c56c2e3b73df799286193d60c109b187d64571efbaa8047be85821" +
      "f8e67e0e85f2f5894bc63d00c2ed9d64",
  },
  expectedTxHash:
    "0x48e5a1a0e616d8fd92b4ef228c424e0c816799a256c6a90892195ccfc53300d6",
}

/**
 * Simple P2PKH transaction for wallet control verification
 * This represents a typical Bitcoin transaction that proves wallet ownership
 */
export const P2PKHWalletControlProof: SPVProofTestData = {
  name: "P2PKHWalletControlProof",
  description: "P2PKH transaction proving wallet control",
  txInfo: {
    version: "0x02000000",
    inputVector:
      "0x01" + // 1 input
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" + // txid
      "00000000" + // output index 0
      "6a" + // script length (106 bytes)
      "47304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef022012345678" + // signature
      "21" + // pubkey length (33 bytes)
      "02abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" + // compressed pubkey
      "ffffffff", // sequence
    outputVector:
      "0x02" + // 2 outputs
      "00e1f50500000000" + // 100000000 satoshi (1 BTC)
      "19" + // script length (25 bytes)
      "76a914" + // OP_DUP OP_HASH160
      "389ffce9cd9ae88dcc0631e88a821ffdbe9bfe26" + // pubkey hash
      "88ac" + // OP_EQUALVERIFY OP_CHECKSIG
      "404b4c0000000000" + // 5000000 satoshi (0.05 BTC)
      "19" + // script length
      "76a914" + // OP_DUP OP_HASH160
      "9f4a0cf9b9e0358e7bda47a096d7e20b8328c5d9" + // change address
      "88ac", // OP_EQUALVERIFY OP_CHECKSIG
    locktime: "0x00000000",
  },
  proof: {
    // Simplified proof data for testing - in production these would be real values
    merkleProof: "0x" + "a".repeat(640), // 320 bytes of mock merkle proof
    txIndexInBlock: 42,
    bitcoinHeaders: "0x" + "b".repeat(1280), // 640 bytes of headers (8 headers)
    coinbasePreimage: "0x" + "c".repeat(64),
    coinbaseProof: "0x" + "d".repeat(640),
  },
  expectedTxHash:
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
}

/**
 * Transaction with multiple inputs and outputs for complex validation
 */
export const ComplexMultiInputTx: SPVProofTestData = {
  name: "ComplexMultiInputTx",
  description: "Transaction with multiple inputs and outputs",
  txInfo: {
    version: "0x02000000",
    inputVector:
      "0x03" + // 3 inputs
      // Input 1
      "1111111111111111111111111111111111111111111111111111111111111111" +
      "00000000" +
      "00" + // empty script (coinbase-like)
      "ffffffff" +
      // Input 2
      "2222222222222222222222222222222222222222222222222222222222222222" +
      "01000000" +
      "00" +
      "ffffffff" +
      // Input 3
      "3333333333333333333333333333333333333333333333333333333333333333" +
      "02000000" +
      "00" +
      "ffffffff",
    outputVector:
      "0x04" + // 4 outputs
      // Output 1 - P2WPKH
      "00ca9a3b00000000" + // 1000000000 satoshi (10 BTC)
      "16" + // script length (22 bytes)
      "0014" + // OP_0 + 20 bytes
      "1234567890abcdef1234567890abcdef12345678" + // witness program
      // Output 2 - P2SH
      "00e1f50500000000" + // 100000000 satoshi (1 BTC)
      "17" + // script length (23 bytes)
      "a914" + // OP_HASH160
      "abcdefabcdefabcdefabcdefabcdefabcdefabcd" + // script hash
      "87" + // OP_EQUAL
      // Output 3 - P2WSH
      "404b4c0000000000" + // 5000000 satoshi
      "22" + // script length (34 bytes)
      "0020" + // OP_0 + 32 bytes
      "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210" + // witness program
      // Output 4 - OP_RETURN
      "0000000000000000" + // 0 satoshi
      "26" + // script length (38 bytes)
      "6a24" + // OP_RETURN + 36 bytes
      "aa21a9ed" + // commitment header
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", // commitment data
    locktime: "0x00000000",
  },
  proof: {
    merkleProof: "0x" + "e".repeat(800), // 400 bytes
    txIndexInBlock: 123,
    bitcoinHeaders: "0x" + "f".repeat(1920), // 960 bytes (12 headers)
    coinbasePreimage: "0x" + "1".repeat(64),
    coinbaseProof: "0x" + "2".repeat(800),
  },
  expectedTxHash:
    "0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
}

/**
 * Test data for invalid merkle proofs (security testing)
 */
export const InvalidMerkleProofData = {
  // Valid transaction but with tampered merkle proof
  tamperedMerkleProof: {
    ...ValidMainnetProof,
    name: "TamperedMerkleProof",
    description: "Valid transaction with tampered merkle proof",
    proof: {
      ...ValidMainnetProof.proof,
      // Changed some bytes in the middle of the merkle proof
      merkleProof:
        "0xe35a0d6de94b656694589964a252957e4673a9fb1d2f8b4a92e3f0a7bb6" +
        "54fddb94e5a1e6d7f7f499fd1be5dd30a73bf5584bf137da5fdd77cc21aeb" +
        "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF" + // Tampered section
        "8f2874d8d02a65d9c87d07de21d4dfe7b0a9f4a23cc9a58373e9e6931fefd" +
        "b5afade5df54c91104048df1ee999240617984e18b6f931e2373673d0195b" +
        "8c6987d7ff7650d5ce53bcec46e13ab4f2da1146a7fc621ee672f62bc2274" +
        "2486392d75e55e67b09960c3386a0b49e75f1723d6ab28ac9a2028a0c7286" +
        "6e2111d79d4817b88e17c821937847768d92837bae3832bb8e5a4ab4434b9" +
        "7e00a6c10182f211f592409068d6f5652400d9a3d1cc150a7fb692e874cc4" +
        "2d76bdafc842f2fe0f835a7c24d2d60c109b187d64571efbaa8047be85821" +
        "f8e67e0e85f2f5894bc63d00c2ed9d64",
    },
  },

  // Insufficient merkle proof depth
  shortMerkleProof: {
    ...ValidMainnetProof,
    name: "ShortMerkleProof",
    description: "Transaction with insufficient merkle proof depth",
    proof: {
      ...ValidMainnetProof.proof,
      // Only first 64 bytes of merkle proof
      merkleProof:
        "0xe35a0d6de94b656694589964a252957e4673a9fb1d2f8b4a92e3f0a7bb6" +
        "54fddb94e5a1e6d7f7f499fd1be5dd30a73bf5584bf137da5fdd77cc21aeb",
    },
  },
}

/**
 * Test data for insufficient proof of work (security testing)
 */
export const InsufficientProofOfWork = {
  ...ValidMainnetProof,
  name: "InsufficientProofOfWork",
  description: "Valid transaction but with insufficient accumulated difficulty",
  proof: {
    ...ValidMainnetProof.proof,
    // Only 2 headers instead of required amount
    bitcoinHeaders:
      "0x0000002073bd2184edd9c4fc76642ea6754ee40136970efc10c41900000" +
      "00000000000000296ef123ea96da5cf695f22bf7d94be87d49db1ad7ac371" +
      "ac43c4da4161c8c216349c5ba11928170d38782b00000020fe70e48339d6b" +
      "17fbbf1340d245338f57336e97767cc240000000000000000005af53b865c" +
      "27c6e9b5e5db4c3ea8e024f8329178a79ddb39f7727ea2fe6e6825d1349c5" +
      "ba1192817e2d9515900000020baaea6746f4c16ccb7cd961655b636d39b5f",
  },
}
