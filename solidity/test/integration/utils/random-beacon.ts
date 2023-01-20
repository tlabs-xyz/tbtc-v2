/* eslint-disable no-await-in-loop */

import type { BigNumber, Contract } from "ethers"
import { HardhatRuntimeEnvironment } from "hardhat/types"
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import {
  governanceDelay,
  dkgResultChallengePeriodLength,
} from "../data/integration"
import type { SortitionPool } from "../../../typechain"

export type OperatorID = number
export type Operator = { id: OperatorID; signer: SignerWithAddress }

export async function updateDkgResultChallengePeriodLength(
  hre: HardhatRuntimeEnvironment,
  governance: SignerWithAddress,
  randomBeaconGovernance: Contract
): Promise<void> {
  const { helpers } = hre

  await randomBeaconGovernance
    .connect(governance)
    .beginDkgResultChallengePeriodLengthUpdate(dkgResultChallengePeriodLength)

  await helpers.time.increaseTime(governanceDelay)

  await randomBeaconGovernance
    .connect(governance)
    .finalizeDkgResultChallengePeriodLengthUpdate()
}

export async function getGenesisSeed(
  hre: HardhatRuntimeEnvironment,
  genesisBlock: number
): Promise<BigNumber> {
  const { ethers } = hre
  return ethers.BigNumber.from(
    ethers.utils.keccak256(
      ethers.utils.solidityPack(
        ["uint256", "uint256"],
        [
          "31415926535897932384626433832795028841971693993751058209749445923078164062862",
          genesisBlock,
        ]
      )
    )
  )
}

export async function selectGroup(
  hre: HardhatRuntimeEnvironment,
  sortitionPool: SortitionPool,
  seed: BigNumber
): Promise<Operator[]> {
  const { ethers } = hre
  const identifiers = await sortitionPool.selectGroup(
    64,
    ethers.utils.hexZeroPad(seed.toHexString(), 32)
  )
  const addresses = await sortitionPool.getIDOperators(identifiers)

  return Promise.all(
    identifiers.map(
      async (identifier, i): Promise<Operator> => ({
        id: identifier,
        signer: await ethers.getSigner(addresses[i]),
      })
    )
  )
}

export async function signDkgResult(
  hre: HardhatRuntimeEnvironment,
  signers: Operator[],
  groupPublicKey: string,
  misbehavedMembersIndices: number[],
  startBlock: number,
  numberOfSignatures: number
): Promise<{
  members: number[]
  signingMembersIndices: number[]
  signaturesBytes: string
}> {
  const { ethers } = hre
  const hardhatNetworkId = 31337

  const resultHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["uint256", "bytes", "uint8[]", "uint256"],
      [hardhatNetworkId, groupPublicKey, misbehavedMembersIndices, startBlock]
    )
  )

  const members: number[] = []
  const signingMembersIndices: number[] = []
  const signatures: string[] = []
  for (let i = 0; i < signers.length; i++) {
    const { id, signer: ethersSigner } = signers[i]
    members.push(id)

    if (signatures.length === numberOfSignatures) {
      // eslint-disable-next-line no-continue
      continue
    }

    const signerIndex: number = i + 1

    signingMembersIndices.push(signerIndex)

    const signature = await ethersSigner.signMessage(
      ethers.utils.arrayify(resultHash)
    )

    signatures.push(signature)
  }

  const signaturesBytes: string = ethers.utils.hexConcat(signatures)

  return { members, signingMembersIndices, signaturesBytes }
}

// Creates a members hash that actively participated in dkg
export function hashDKGMembers(
  hre: HardhatRuntimeEnvironment,
  members: number[],
  misbehavedMembersIndices: number[]
): string {
  const { ethers } = hre
  if (misbehavedMembersIndices.length > 0) {
    const activeDkgMembers = [...members]
    for (let i = 0; i < misbehavedMembersIndices.length; i++) {
      if (misbehavedMembersIndices[i] !== 0) {
        activeDkgMembers.splice(misbehavedMembersIndices[i] - i - 1, 1)
      }
    }

    return ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(["uint32[]"], [activeDkgMembers])
    )
  }

  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(["uint32[]"], [members])
  )
}
