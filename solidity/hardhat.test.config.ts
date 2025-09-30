import { HardhatUserConfig } from "hardhat/config"

import "dotenv/config"
import "@nomiclabs/hardhat-waffle"
import "@nomicfoundation/hardhat-chai-matchers"
import "@typechain/hardhat"
import "hardhat-deploy"
import "hardhat-dependency-compiler"
import "@keep-network/hardhat-helpers"

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 100, // Further reduced to handle contract size limits
          },
        },
      },
    ],
  },

  paths: {
    artifacts: "./build",
    deploy: "./deploy",
    deployments: "./deployments",
  },

  networks: {
    hardhat: {
      accounts: {
        count: 50, // Simplified account count for testing
      },
      tags: ["allowStubs"],
      gasPrice: 200000000000, // 200 gwei
      allowUnlimitedContractSize: true, // Allow oversized contracts for testing
    },
  },

  mocha: {
    timeout: 60000,
  },

  namedAccounts: {
    deployer: {
      default: 0,
    },
    governance: {
      default: 1,
    },
    treasury: {
      default: 2,
    },
    spvMaintainer: {
      default: 3,
    },
    esdm: {
      default: 4,
    },
    redemptionWatchtowerManager: {
      default: 5,
    },
  },

  external: {
    contracts: [
      {
        artifacts: "node_modules/@keep-network/tbtc/artifacts",
      },
      {
        artifacts: "node_modules/@threshold-network/solidity-contracts/export/artifacts",
      },
      {
        artifacts: "node_modules/@keep-network/random-beacon/export/artifacts",
      },
      {
        artifacts: "node_modules/@keep-network/ecdsa/export/artifacts",
      },
    ],
    deployments: {
      hardhat: ["./external/npm"],
      localhost: ["./external/npm"],
    },
  },

  dependencyCompiler: {
    paths: [
      "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol",
      "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol",
      "@keep-network/ecdsa/contracts/WalletRegistry.sol",
    ],
    keep: true,
  },
}

export default config