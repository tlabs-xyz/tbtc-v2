import { HardhatUserConfig } from "hardhat/config"
import "dotenv/config"

// Core imports (always needed)
import "@keep-network/hardhat-helpers"
import "@nomiclabs/hardhat-waffle"
import "@nomicfoundation/hardhat-chai-matchers"
import "@typechain/hardhat"
import "hardhat-deploy"
import "hardhat-dependency-compiler"

// Environment detection
const isTestEnv =
  process.env.NODE_ENV === "test" ||
  process.env.HARDHAT_NETWORK === "hardhat" ||
  process.env.TEST_ENV === "true"

// Production imports (conditionally imported)
if (!isTestEnv) {
  try {
    require("./tasks")
    require("@keep-network/hardhat-local-networks-config")
    require("@nomiclabs/hardhat-etherscan")
    require("hardhat-gas-reporter")
    require("hardhat-contract-sizer")
    require("@tenderly/hardhat-tenderly")
    require("solidity-docgen")
  } catch (error) {
    console.warn("Some production plugins could not be loaded:", error.message)
  }
}

const ecdsaSolidityCompilerConfig = {
  version: "0.8.17",
  settings: {
    optimizer: {
      enabled: true,
      runs: 200,
    },
  },
}

// Reduce the number of optimizer runs to 100 to keep the contract size sane.
// BridgeGovernance contract does not need to be super gas-efficient.
const bridgeGovernanceCompilerConfig = {
  version: "0.8.17",
  settings: {
    optimizer: {
      enabled: true,
      runs: 200,
    },
  },
}

// Configuration for testing environment.
export const testConfig = {
  // How many accounts we expect to define for non-staking related signers, e.g.
  // deployer, thirdParty, governance.
  // It is used as an offset for getting accounts for operators and stakes registration.
  nonStakingAccountsCount: 10,

  // How many roles do we need to define for staking, i.e. stakeOwner, stakingProvider,
  // operator, beneficiary, authorizer.
  stakingRolesCount: 5,

  // Number of operators to register. Should be at least the same as group size.
  operatorsCount: 110,
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: isTestEnv ? 100 : 1000, // Optimize for size in tests, gas efficiency in production
          },
        },
      },
    ],
    overrides: {
      "@keep-network/ecdsa/contracts/WalletRegistry.sol":
        ecdsaSolidityCompilerConfig,
      "contracts/bridge/BridgeGovernance.sol": bridgeGovernanceCompilerConfig,
      "contracts/account-control/QCManager.sol": {
        version: "0.8.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200, // Optimize for size with reasonable gas efficiency
          },
          viaIR: true, // Enable intermediate representation for better optimization
        },
      },
      "contracts/account-control/QCManagerLib.sol": {
        version: "0.8.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200, // Optimize for size with reasonable gas efficiency
          },
          viaIR: true, // Enable intermediate representation for better optimization
        },
      },
    },
  },

  paths: {
    artifacts: "./build",
    deploy: "./deploy",
    deployments: "./deployments",
  },

  networks: {
    hardhat: {
      forking: isTestEnv
        ? undefined
        : {
            // forking is enabled only if FORKING_URL env is provided
            enabled: !!process.env.FORKING_URL,
            // URL should point to a node with archival data (Alchemy recommended)
            url: process.env.FORKING_URL || "",
            // latest block is taken if FORKING_BLOCK env is not provided
            blockNumber:
              process.env.FORKING_BLOCK &&
              parseInt(process.env.FORKING_BLOCK, 10),
          },
      accounts: {
        // Simplified account count for tests, full count for production
        count: isTestEnv
          ? 50
          : testConfig.nonStakingAccountsCount +
            testConfig.stakingRolesCount * testConfig.operatorsCount,
      },
      tags: ["allowStubs"],
      // we use higher gas price for tests to obtain more realistic results
      // for gas refund tests than when the default hardhat ~1 gwei gas price is
      // used
      gasPrice: 200000000000, // 200 gwei
      // Allow oversized contracts in test environment, conditional in production
      allowUnlimitedContractSize:
        isTestEnv || process.env.TEST_USE_STUBS_TBTC === "true",
    },
    system_tests: {
      url: "http://127.0.0.1:8545",
      tags: ["allowStubs"],
    },
    development: {
      url: "http://localhost:8545",
      chainId: 1101,
      tags: ["allowStubs"],
    },
    sepolia: {
      url: process.env.CHAIN_API_URL || "",
      chainId: 11155111,
      accounts: process.env.ACCOUNTS_PRIVATE_KEYS
        ? process.env.ACCOUNTS_PRIVATE_KEYS.split(",")
        : undefined,
      tags: ["tenderly"],
    },
    mainnet: {
      url: process.env.CHAIN_API_URL || "",
      chainId: 1,
      accounts: process.env.CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY
        ? [process.env.CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY]
        : undefined,
      tags: ["etherscan", "tenderly"],
    },
  },

  tenderly: {
    username: "thesis",
    project: "",
  },

  // Define local networks configuration file path to load networks from file.
  // localNetworksConfig: "./.hardhat/networks.ts",

  external: {
    contracts:
      process.env.USE_EXTERNAL_DEPLOY === "true"
        ? [
            {
              artifacts: "node_modules/@keep-network/tbtc/artifacts",
            },
            {
              artifacts:
                "node_modules/@threshold-network/solidity-contracts/export/artifacts",
              deploy:
                "node_modules/@threshold-network/solidity-contracts/export/deploy",
            },
            {
              artifacts:
                "node_modules/@keep-network/random-beacon/export/artifacts",
              deploy: "node_modules/@keep-network/random-beacon/export/deploy",
            },
            {
              artifacts: "node_modules/@keep-network/ecdsa/export/artifacts",
              deploy: "node_modules/@keep-network/ecdsa/export/deploy",
            },
          ]
        : undefined,
    deployments: {
      // For development environment we expect the local dependencies to be
      // linked with `yarn link` command.
      development: [
        "node_modules/@threshold-network/solidity-contracts/deployments/development",
        "node_modules/@keep-network/random-beacon/deployments/development",
        "node_modules/@keep-network/ecdsa/deployments/development",
      ],
      sepolia: [
        "node_modules/@keep-network/tbtc/artifacts",
        "node_modules/@keep-network/random-beacon/artifacts",
        "node_modules/@keep-network/ecdsa/artifacts",
      ],
      mainnet: ["./external/mainnet"],
    },
  },

  namedAccounts: {
    deployer: {
      default: 1,
      sepolia: 0,
      mainnet: 0, // "0x123694886DBf5Ac94DDA07135349534536D14cAf"
    },
    governance: {
      default: 2,
      sepolia: 0,
      mainnet: "0x9f6e831c8f8939dc0c830c6e492e7cef4f9c2f5f", // Threshold Council
    },
    chaosnetOwner: {
      default: 3,
      sepolia: 0,
      // Not used for mainnet deployment scripts of `@keepn-network/tbtc-v2`.
      // Used by `@keep-network/random-beacon` and `@keep-network/ecdsa`
      // when deploying `SortitionPool`s.
    },
    esdm: {
      default: 4,
      sepolia: 0,
      mainnet: "0x9f6e831c8f8939dc0c830c6e492e7cef4f9c2f5f", // Threshold Council
    },
    keepTechnicalWalletTeam: {
      default: 5,
      sepolia: 0,
      mainnet: "0xB3726E69Da808A689F2607939a2D9E958724FC2A",
    },
    keepCommunityMultiSig: {
      default: 6,
      sepolia: 0,
      mainnet: "0x19FcB32347ff4656E4E6746b4584192D185d640d",
    },
    treasury: {
      default: 7,
      sepolia: 0,
      mainnet: "0x87F005317692D05BAA4193AB0c961c69e175f45f", // Token Holder DAO
    },
    spvMaintainer: {
      default: 8,
      sepolia: 0,
      // We are not setting SPV maintainer for mainnet in deployment scripts.
    },
    v1Redeemer: {
      default: 10,
      sepolia: 0,
      mainnet: "0x8Bac178fA95Cb56D11A94d4f1b2B1F5Fc48A30eA",
    },
    redemptionWatchtowerManager: {
      default: 11,
      sepolia: 0,
      mainnet: "0x87F005317692D05BAA4193AB0c961c69e175f45f", // Token Holder DAO
    },
  },
  dependencyCompiler: {
    paths: [
      "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol",
      "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol",
      // WalletRegistry contract is deployed with @open-zeppelin/hardhat-upgrades
      // plugin that doesn't work well with hardhat-deploy artifacts defined in
      // external artifacts section, hence we have to compile the contracts from
      // sources.
      "@keep-network/ecdsa/contracts/WalletRegistry.sol",
    ],
    keep: true,
  },
  mocha: {
    timeout: isTestEnv ? 60000 : 600_000, // 1 minute for tests, 10 minutes for production
    slow: 5000, // Mark tests taking >5s as slow
    reporter: "spec",
    // Reduce parallel execution to help with lock file conflicts
    parallel: false,
  },
  typechain: {
    outDir: "typechain",
  },

  // Production-only configurations
  ...(isTestEnv
    ? {}
    : {
        etherscan: {
          apiKey: process.env.ETHERSCAN_API_KEY,
        },
        contractSizer: {
          alphaSort: true,
          disambiguatePaths: false,
          runOnCompile: process.env.CONTRACT_SIZE_CHECK_DISABLED !== "true",
          strict: false,
          // WalletRegistry is excluded because it's an external dependency from @keep-network/ecdsa
          // that exceeds the 24KB contract size limit (24.142 KB). We don't control this contract.
          except: ["BridgeStub$", "WalletRegistry$"],
        },
        docgen: {
          outputDir: "generated-docs",
          templates: "docgen-templates",
          pages: "files", // `single`, `items` or `files`
          exclude: ["./test"],
        },
      }),
}

export default config
