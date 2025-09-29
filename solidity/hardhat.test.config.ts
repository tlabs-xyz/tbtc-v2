import { HardhatUserConfig } from "hardhat/config"

import "dotenv/config"
import "@nomiclabs/hardhat-waffle"
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
    deployments: {
      hardhat: ["./external/npm"],
      localhost: ["./external/npm"],
    },
  },

  dependencyCompiler: {
    paths: [],
  },
}

export default config