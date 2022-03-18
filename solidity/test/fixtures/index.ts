import { Contract } from "ethers"
import { ethers } from "hardhat"
import type {
  TestERC20,
  TBTC,
  VendingMachine,
  TestERC20__factory,
  TBTC__factory,
  VendingMachine__factory,
} from "../../typechain"
import { to1ePrecision } from "../helpers/contract-test-helpers"

export const constants = {
  unmintFee: to1ePrecision(1, 15), // 0.001
  walletCreationPeriod: 604800, // 1 week
  walletMinBtcBalance: to1ePrecision(1, 8), // 1 BTC
  walletMaxBtcBalance: to1ePrecision(10, 8), // 10 BTC
}

export const walletState = {
  Unknown: 0,
  Live: 1,
  MovingFunds: 2,
  Closed: 3,
  Terminated: 4,
}

export const ecdsaDkgState = {
  IDLE: 0,
  AWAITING_SEED: 1,
  AWAITING_RESULT: 2,
  CHALLENGE: 3,
}

export interface DeployedContracts {
  [key: string]: Contract
}

export async function vendingMachineDeployment(): Promise<DeployedContracts> {
  const TestERC20 = await ethers.getContractFactory<TestERC20__factory>(
    "TestERC20"
  )
  const tbtcV1: TestERC20 = await TestERC20.deploy()
  await tbtcV1.deployed()

  const TBTC = await ethers.getContractFactory<TBTC__factory>("TBTC")
  const tbtcV2: TBTC = await TBTC.deploy()
  await tbtcV2.deployed()

  const VendingMachine =
    await ethers.getContractFactory<VendingMachine__factory>("VendingMachine")
  const vendingMachine: VendingMachine = await VendingMachine.deploy(
    tbtcV1.address,
    tbtcV2.address,
    constants.unmintFee
  )
  await vendingMachine.deployed()

  const contracts: DeployedContracts = {
    tbtcV1,
    tbtcV2,
    vendingMachine,
  }

  return contracts
}
