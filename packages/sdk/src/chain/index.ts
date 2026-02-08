/**
 * @deluthium/sdk - Chain configuration
 *
 * Defines supported chains and their configuration (contract addresses,
 * wrapped native tokens, RPC URLs). Extensible via registerChain().
 */

import type { ChainConfig } from '../types/index.js';
import { ChainError } from '../errors/index.js';

// --- Built-in Chain Configurations ---

const BSC_MAINNET: ChainConfig = {
  chainId: 56,
  name: 'BNB Smart Chain',
  symbol: 'BSC',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io'],
  explorerUrl: 'https://bscscan.com',
  wrappedNativeToken: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
  rfqManagerAddress: '0x94020Af3571f253754e5566710A89666d90Df615',
  supported: true,
};

const BASE_MAINNET: ChainConfig = {
  chainId: 8453,
  name: 'Base',
  symbol: 'BASE',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://mainnet.base.org', 'https://base.meowrpc.com'],
  explorerUrl: 'https://basescan.org',
  wrappedNativeToken: '0x4200000000000000000000000000000000000006', // WETH
  rfqManagerAddress: '0x7648CE928efa92372E2bb34086421a8a1702bD36',
  supported: true,
};

const ETHEREUM_MAINNET: ChainConfig = {
  chainId: 1,
  name: 'Ethereum',
  symbol: 'ETH',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://eth.llamarpc.com', 'https://rpc.ankr.com/eth'],
  explorerUrl: 'https://etherscan.io',
  wrappedNativeToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
  rfqManagerAddress: undefined, // Not yet deployed
  supported: false,
};

const ZKSYNC_ERA: ChainConfig = {
  chainId: 324,
  name: 'zkSync Era',
  symbol: 'ZKSYNC',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://mainnet.era.zksync.io'],
  explorerUrl: 'https://explorer.zksync.io',
  wrappedNativeToken: '0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91', // WETH
  rfqManagerAddress: undefined, // Not yet deployed
  supported: false,
};

const ARBITRUM_ONE: ChainConfig = {
  chainId: 42161,
  name: 'Arbitrum One',
  symbol: 'ARB',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum.meowrpc.com'],
  explorerUrl: 'https://arbiscan.io',
  wrappedNativeToken: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
  rfqManagerAddress: undefined,
  supported: false,
};

const POLYGON_MAINNET: ChainConfig = {
  chainId: 137,
  name: 'Polygon',
  symbol: 'MATIC',
  nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
  rpcUrls: ['https://polygon-rpc.com', 'https://rpc.ankr.com/polygon'],
  explorerUrl: 'https://polygonscan.com',
  wrappedNativeToken: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WPOL
  rfqManagerAddress: undefined,
  supported: false,
};

// --- Registry ---

const chainRegistry = new Map<number, ChainConfig>();

// Register built-in chains
[BSC_MAINNET, BASE_MAINNET, ETHEREUM_MAINNET, ZKSYNC_ERA, ARBITRUM_ONE, POLYGON_MAINNET].forEach(
  (chain) => {
    chainRegistry.set(chain.chainId, chain);
  },
);

// --- Public API ---

/**
 * Get configuration for a specific chain.
 * @throws ChainError if chain is not registered
 */
export function getChainConfig(chainId: number): Readonly<ChainConfig> {
  const config = chainRegistry.get(chainId);
  if (!config) {
    throw new ChainError(
      `Chain ${chainId} is not registered. Use registerChain() to add it.`,
      chainId,
    );
  }
  // Return a frozen copy to prevent accidental mutation of the registry (MED-12)
  return Object.freeze({ ...config });
}

/**
 * Get chain config or undefined (no-throw version).
 */
export function tryGetChainConfig(chainId: number): ChainConfig | undefined {
  return chainRegistry.get(chainId);
}

/**
 * Register or override a chain configuration.
 */
export function registerChain(config: ChainConfig): void {
  chainRegistry.set(config.chainId, config);
}

/**
 * Get all registered chain configurations.
 */
export function getAllChains(): ChainConfig[] {
  return Array.from(chainRegistry.values());
}

/**
 * Get all chains where Deluthium RFQ Manager is deployed and supported.
 */
export function getSupportedChains(): ChainConfig[] {
  return getAllChains().filter((c) => c.supported && c.rfqManagerAddress);
}

/**
 * Get the RFQ Manager address for a chain.
 * @throws ChainError if chain not found or RFQ Manager not deployed
 */
export function getRfqManagerAddress(chainId: number): string {
  const config = getChainConfig(chainId);
  if (!config.rfqManagerAddress) {
    throw new ChainError(
      `RFQ Manager contract is not yet deployed on ${config.name} (chain ${chainId})`,
      chainId,
    );
  }
  return config.rfqManagerAddress;
}

/**
 * Get the wrapped native token address for a chain.
 * @throws ChainError if chain not found
 */
export function getWrappedNativeToken(chainId: number): string {
  return getChainConfig(chainId).wrappedNativeToken;
}

// --- Re-export constants for convenience ---

export const ChainId = {
  BSC: 56,
  BASE: 8453,
  ETHEREUM: 1,
  ZKSYNC: 324,
  ARBITRUM: 42161,
  POLYGON: 137,
} as const;

export type ChainId = (typeof ChainId)[keyof typeof ChainId];
