import { BigNumber } from "ethers"
import {
  Proof,
  UnspentTransactionOutput,
  DecomposedRawTransaction,
  TransactionHash,
} from "./bitcoin"
import { DepositScriptParameters, RevealedDeposit } from "./deposit"
import { RedemptionRequest } from "./redemption"

/**
 * Represents a generic chain identifier.
 */
export interface Identifier {
  /**
   * Identifier as an un-prefixed hex string.
   */
  identifierHex: string
}

/**
 * Interface for communication with the Bridge on-chain contract.
 */
export interface Bridge {
  /**
   * Submits a deposit sweep transaction proof to the on-chain contract.
   * @param sweepTx - Sweep transaction data.
   * @param sweepProof - Sweep proof data.
   * @param mainUtxo - Data of the wallet's main UTXO.
   * @param vault - Optional identifier of the vault the swept deposits should
   *        be routed in.
   */
  submitDepositSweepProof(
    sweepTx: DecomposedRawTransaction,
    sweepProof: Proof,
    mainUtxo: UnspentTransactionOutput,
    vault?: Identifier
  ): Promise<void>

  /**
   * Reveals a given deposit to the on-chain contract.
   * @param depositTx - Deposit transaction data
   * @param depositOutputIndex - Index of the deposit transaction output that
   *        funds the revealed deposit
   * @param deposit - Data of the revealed deposit
   * @returns Transaction hash of the reveal deposit transaction as string
   */
  revealDeposit(
    depositTx: DecomposedRawTransaction,
    depositOutputIndex: number,
    deposit: DepositScriptParameters,
    vault?: Identifier
  ): Promise<string>

  /**
   * Gets a revealed deposit from the on-chain contract.
   * @param depositTxHash The revealed deposit transaction's hash.
   * @param depositOutputIndex Index of the deposit transaction output that
   *        funds the revealed deposit.
   * @returns Revealed deposit data.
   */
  deposits(
    depositTxHash: TransactionHash,
    depositOutputIndex: number
  ): Promise<RevealedDeposit>

  /**
   * Requests a redemption from the on-chain contract.
   * @param walletPublicKey - The Bitcoin public key of the wallet. Must be in the
   *        compressed form (33 bytes long with 02 or 03 prefix).
   * @param mainUtxo - The main UTXO of the wallet. Must match the main UTXO
   *        held by the on-chain contract.
   * @param redeemerOutputScript - The output script that the redeemed funds will
   *        be locked to. Must be un-prefixed and not prepended with length.
   * @param amount - The amount to be redeemed in satoshis.
   * @returns Empty promise.
   */
  requestRedemption(
    walletPublicKey: string,
    mainUtxo: UnspentTransactionOutput,
    redeemerOutputScript: string,
    amount: BigNumber
  ): Promise<void>

  /**
   * Submits a redemption transaction proof to the on-chain contract.
   * @param redemptionTx - Redemption transaction data
   * @param redemptionProof - Redemption proof data
   * @param mainUtxo - Data of the wallet's main UTXO
   * @param walletPublicKey - Bitcoin public key of the wallet. Must be in the
   *        compressed form (33 bytes long with 02 or 03 prefix).
   */
  submitRedemptionProof(
    redemptionTx: DecomposedRawTransaction,
    redemptionProof: Proof,
    mainUtxo: UnspentTransactionOutput,
    walletPublicKey: string
  ): Promise<void>

  /**
   * Gets transaction proof difficulty factor from the on-chain contract.
   * @dev This number signifies how many confirmations a transaction has to
   *      accumulate before it can be proven on-chain.
   * @returns Proof difficulty factor.
   */
  txProofDifficultyFactor(): Promise<number>

  /**
   * Gets a pending redemption from the on-chain contract.
   * @param walletPublicKey Bitcoin public key of the wallet the request is
   *        targeted to. Must be in the compressed form (33 bytes long with 02
   *        or 03 prefix).
   * @param redeemerOutputScript The redeemer output script the redeemed funds
   *        are supposed to be locked on. Must be un-prefixed and not prepended
   *        with length.
   * @returns Promise with the pending redemption.
   */
  pendingRedemptions(
    walletPublicKey: string,
    redeemerOutputScript: string
  ): Promise<RedemptionRequest>

  /**
   * Gets a timed-out redemption from the on-chain contract.
   * @param walletPublicKey Bitcoin public key of the wallet the request is
   *        targeted to. Must be in the compressed form (33 bytes long with 02
   *        or 03 prefix).
   * @param redeemerOutputScript The redeemer output script the redeemed funds
   *        are supposed to be locked on. Must be un-prefixed and not prepended
   *        with length.
   * @returns Promise with the pending redemption.
   */
  timedOutRedemptions(
    walletPublicKey: string,
    redeemerOutputScript: string
  ): Promise<RedemptionRequest>

  /**
   * Gets the public key of the current active wallet.
   * @returns Compressed (33 bytes long with 02 or 03 prefix) active wallet's
   *          public key. If there is no active wallet at the moment, undefined
   *          is returned.
   */
  activeWalletPublicKey(): Promise<string | undefined>
}
