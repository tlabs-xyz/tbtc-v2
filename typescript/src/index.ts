// TODO: Consider exports refactoring as per discussion https://github.com/keep-network/tbtc-v2/pull/460#discussion_r1084530007

import {
  calculateDepositAddress,
  getRevealedDeposit,
  revealDeposit,
  suggestDepositWallet,
} from "./deposit"

import { submitDepositSweepProof } from "./deposit-sweep"

import {
  requestRedemption,
  submitRedemptionProof,
  getRedemptionRequest,
  findWalletForRedemption,
} from "./redemption"

import {
  requestOptimisticMint,
  cancelOptimisticMint,
  finalizeOptimisticMint,
  getOptimisticMintingRequest,
} from "./optimistic-minting"

import { validateTransactionProof } from "./proof"

export const TBTC = {
  calculateDepositAddress,
  suggestDepositWallet,
  revealDeposit,
  getRevealedDeposit,
  requestRedemption,
  getRedemptionRequest,
  findWalletForRedemption,
}

export const SpvMaintainer = {
  submitDepositSweepProof,
  submitRedemptionProof,
}

export const OptimisticMinting = {
  requestOptimisticMint,
  cancelOptimisticMint,
  finalizeOptimisticMint,
  getOptimisticMintingRequest,
}

export const Bitcoin = {
  validateTransactionProof,
}

export {
  TransactionHash as BitcoinTransactionHash,
  Transaction as BitcoinTransaction,
  TransactionOutput as BitcoinTransactionOutput,
  locktimeToNumber as BitcoinLocktimeToNumber,
} from "./bitcoin"

export { BitcoinNetwork } from "./bitcoin-network"

export { Client as ElectrumClient } from "./electrum"

export {
  Bridge as EthereumBridge,
  WalletRegistry as EthereumWalletRegistry,
  Address as EthereumAddress,
  TBTCVault as EthereumTBTCVault,
  TBTCToken as EthereumTBTCToken,
} from "./ethereum"

export { Hex } from "./hex"

export {
  OptimisticMintingRequest,
  OptimisticMintingRequestedEvent,
} from "./optimistic-minting"
