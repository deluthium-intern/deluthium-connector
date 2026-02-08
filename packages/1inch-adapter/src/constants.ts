import type { OneInchChainConfig } from './types.js';

// ── Chain IDs ────────────────────────────────────────────────────────────────

export enum ChainId {
  ETHEREUM = 1,
  BSC = 56,
  BASE = 8453,
  ZKSYNC = 324,
}

// ── 1inch Router Addresses ───────────────────────────────────────────────────

export const ONEINCH_ROUTER_V6 =
  '0x111111125421ca6dc452d289314280a0f8842a65';

export const ONEINCH_ROUTER_V6_ZKSYNC =
  '0x6fd4383cb451173d5f9304f041c7bcbf27d561ff';

// ── Deluthium RFQ Manager Addresses ──────────────────────────────────────────

export const DELUTHIUM_RFQ_MANAGERS: Record<number, string> = {
  56: '0x94020Af3571f253754e5566710A89666d90Df615',
  8453: '0x7648CE928efa92372E2bb34086421a8a1702bD36',
};

// ── Wrapped Native Tokens ────────────────────────────────────────────────────

export const WRAPPED_NATIVE_TOKENS: Record<number, string> = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  56: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  8453: '0x4200000000000000000000000000000000000006',
  324: '0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91',
};

// ── Sentinel Addresses ───────────────────────────────────────────────────────

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export const NATIVE_TOKEN_ADDRESS =
  '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// ── Per-Chain Configuration ──────────────────────────────────────────────────

export const CHAIN_CONFIGS: Record<number, OneInchChainConfig> = {
  [ChainId.BSC]: {
    chainId: ChainId.BSC,
    name: 'BNB Smart Chain',
    oneInchRouter: ONEINCH_ROUTER_V6,
    deluthiumRfqManager: DELUTHIUM_RFQ_MANAGERS[ChainId.BSC] ?? ZERO_ADDRESS,
    wrappedNativeToken: WRAPPED_NATIVE_TOKENS[ChainId.BSC]!,
    nativeSymbol: 'BNB',
  },
  [ChainId.BASE]: {
    chainId: ChainId.BASE,
    name: 'Base',
    oneInchRouter: ONEINCH_ROUTER_V6,
    deluthiumRfqManager: DELUTHIUM_RFQ_MANAGERS[ChainId.BASE] ?? ZERO_ADDRESS,
    wrappedNativeToken: WRAPPED_NATIVE_TOKENS[ChainId.BASE]!,
    nativeSymbol: 'ETH',
  },
  [ChainId.ETHEREUM]: {
    chainId: ChainId.ETHEREUM,
    name: 'Ethereum',
    oneInchRouter: ONEINCH_ROUTER_V6,
    deluthiumRfqManager: ZERO_ADDRESS,
    wrappedNativeToken: WRAPPED_NATIVE_TOKENS[ChainId.ETHEREUM]!,
    nativeSymbol: 'ETH',
  },
  [ChainId.ZKSYNC]: {
    chainId: ChainId.ZKSYNC,
    name: 'zkSync Era',
    oneInchRouter: ONEINCH_ROUTER_V6_ZKSYNC,
    deluthiumRfqManager: ZERO_ADDRESS,
    wrappedNativeToken: WRAPPED_NATIVE_TOKENS[ChainId.ZKSYNC]!,
    nativeSymbol: 'ETH',
  },
};

// ── Bit-Width Limits ─────────────────────────────────────────────────────────

export const UINT_40_MAX = (1n << 40n) - 1n;
export const UINT_80_MAX = (1n << 80n) - 1n;
export const UINT_160_MAX = (1n << 160n) - 1n;

// ── Default Tuning Values ────────────────────────────────────────────────────

export const DEFAULTS = {
  EXPIRATION_BUFFER: 300,
  MAX_SLIPPAGE_PERCENT: 5,
  MIN_QUOTE_VALIDITY: 30,
  MAX_QUOTE_VALIDITY: 3600,
} as const;

// ── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Returns the full chain configuration for the given chainId.
 * @throws Error if the chain is not supported.
 */
export function getChainConfig(chainId: number): OneInchChainConfig {
  const config = CHAIN_CONFIGS[chainId];
  if (!config) {
    throw new Error(`Unsupported chain: ${chainId}. Supported chains: ${Object.keys(CHAIN_CONFIGS).join(', ')}`);
  }
  // Guard against zero-address RFQ managers (CRIT-06)
  if (config.deluthiumRfqManager === ZERO_ADDRESS) {
    throw new Error(
      `Deluthium RFQ Manager is not yet deployed on ${config.name} (chain ${chainId}). ` +
      `Cannot build orders targeting the zero address.`,
    );
  }
  return config;
}

/**
 * Returns the 1inch Aggregation Router address for the given chain.
 */
export function getOneInchRouter(chainId: number): string {
  return getChainConfig(chainId).oneInchRouter;
}

/**
 * Returns the wrapped-native-token address for the given chain.
 */
export function getWrappedNativeToken(chainId: number): string {
  return getChainConfig(chainId).wrappedNativeToken;
}

/**
 * Returns the EIP-712 domain for the 1inch Aggregation Router on the given chain.
 */
export function getOneInchDomain(chainId: number): {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
} {
  return {
    name: '1inch Aggregation Router',
    version: '6',
    chainId,
    verifyingContract: getOneInchRouter(chainId),
  };
}
