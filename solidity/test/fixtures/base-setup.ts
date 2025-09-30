import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { ethers, waffle, helpers } from "hardhat"
import type {
  TBTC,
  Bridge,
  Bank,
  TBTCVault,
  IRelay,
  IRandomBeacon,
  WalletRegistry,
  BridgeGovernance,
} from "../../typechain"
import { fixture } from "../integration/utils/fixture"

const { createSnapshot, restoreSnapshot } = helpers.snapshot

export interface TestSigners {
  deployer: SignerWithAddress
  governance: SignerWithAddress
  spvMaintainer: SignerWithAddress
  [key: string]: SignerWithAddress
}

export interface BaseTestEnvironment {
  tbtc: TBTC
  bridge: Bridge
  bridgeGovernance: BridgeGovernance
  bank: Bank
  tbtcVault: TBTCVault
  walletRegistry: WalletRegistry
  randomBeacon: any
  relay: any
  signers: TestSigners
}

let baseEnvironment: BaseTestEnvironment | null = null
let environmentSnapshot: string | null = null

export async function setupTestSigners(): Promise<TestSigners> {
  const [deployer, governance, spvMaintainer, ...others] = await ethers.getSigners()

  return {
    deployer,
    governance,
    spvMaintainer,
    // Add additional named signers as needed
    user1: others[0],
    user2: others[1],
    user3: others[2],
  }
}

export async function createBaseTestEnvironment(): Promise<BaseTestEnvironment> {
  if (baseEnvironment && environmentSnapshot) {
    await restoreSnapshot()
    return baseEnvironment
  }

  const signers = await setupTestSigners()

  const {
    deployer,
    governance,
    spvMaintainer,
    tbtc,
    bridge,
    bank,
    tbtcVault,
    walletRegistry,
    relay,
    randomBeacon,
    bridgeGovernance,
  } = await waffle.loadFixture(fixture)

  baseEnvironment = {
    tbtc,
    bridge,
    bridgeGovernance,
    bank,
    tbtcVault,
    walletRegistry,
    randomBeacon,
    relay,
    signers: {
      deployer,
      governance,
      spvMaintainer,
      user1: signers.user1,
      user2: signers.user2,
      user3: signers.user3,
    },
  }

  environmentSnapshot = await createSnapshot()

  return baseEnvironment
}

export async function restoreBaseTestEnvironment(): Promise<void> {
  if (environmentSnapshot) {
    await restoreSnapshot()
  }
}

export function getBaseTestEnvironment(): BaseTestEnvironment | null {
  return baseEnvironment
}

export async function resetBaseTestEnvironment(): Promise<void> {
  baseEnvironment = null
  environmentSnapshot = null
}