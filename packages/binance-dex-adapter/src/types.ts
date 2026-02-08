/**
 * @deluthium/binance-dex-adapter - Type definitions
 *
 * Types for PancakeSwap / BNB Chain DEX integration, price comparison,
 * and split-route execution between Deluthium RFQ and AMM pools.
 */

import type { DeluthiumClientConfig, ISigner } from '@deluthium/sdk';

// ─── Adapter Configuration ────────────────────────────────────────────────────

export interface BinanceDexAdapterConfig {
  /** Deluthium SDK client configuration */
  deluthium: DeluthiumClientConfig;

  /** Signer for on-chain transactions */
  signer: ISigner;

  /** Chain ID (default: 56 for BNB Chain mainnet) */
  chainId?: number;

  /** RPC URL for BNB Chain (auto-resolved if omitted) */
  rpcUrl?: string;

  /** PancakeSwap Smart Router address (auto-resolved by chain if omitted) */
  smartRouterAddress?: string;

  /** Maximum slippage tolerance in basis points (default: 50 = 0.5%) */
  maxSlippageBps?: number;

  /** How often to refresh prices in ms (default: 3000) */
  priceRefreshIntervalMs?: number;

  /** Minimum split ratio for Deluthium in basis points (default: 1000 = 10%) */
  minDeluthiumSplitBps?: number;

  /** Maximum gas price in gwei (default: 5) */
  maxGasPriceGwei?: number;

  /** Whether to use PancakeSwap v3 concentrated liquidity pools (default: true) */
  useV3Pools?: boolean;

  /** Whether to use PancakeSwap v2 classic AMM pools (default: true) */
  useV2Pools?: boolean;
}

// ─── Contract Addresses ───────────────────────────────────────────────────────

/** PancakeSwap contract addresses by chain */
export const PANCAKESWAP_ADDRESSES: Record<number, PancakeSwapContracts> = {
  56: {
    smartRouter: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
    v3Factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
    v2Factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
    v2Router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    quoterV2: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
    wbnb: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  },
  // opBNB
  204: {
    smartRouter: '0x2092bBb8FA2e2e5de0b9f4368B7E0E753e4A67E4',
    v3Factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
    v2Factory: '0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E',
    v2Router: '0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb',
    quoterV2: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
    wbnb: '0x4200000000000000000000000000000000000006',
  },
};

/** PancakeSwap contract addresses for a single chain */
export interface PancakeSwapContracts {
  smartRouter: string;
  v3Factory: string;
  v2Factory: string;
  v2Router: string;
  quoterV2: string;
  wbnb: string;
}

// ─── Token Types ──────────────────────────────────────────────────────────────

/** Token info for DEX operations */
export interface DexToken {
  address: string;
  symbol: string;
  decimals: number;
  /** Whether this is the native token (BNB) */
  isNative: boolean;
}

/** Common BNB Chain tokens */
export const BNB_CHAIN_TOKENS = {
  BNB: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', symbol: 'BNB', decimals: 18, isNative: true },
  WBNB: { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB', decimals: 18, isNative: false },
  USDT: { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', decimals: 18, isNative: false },
  USDC: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', decimals: 18, isNative: false },
  BUSD: { address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', symbol: 'BUSD', decimals: 18, isNative: false },
  ETH: { address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', symbol: 'ETH', decimals: 18, isNative: false },
  BTCB: { address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', symbol: 'BTCB', decimals: 18, isNative: false },
} as const;

// ─── Price Comparison Types ───────────────────────────────────────────────────

/** Price source identifier */
export type PriceSource = 'deluthium' | 'pancakeswap_v2' | 'pancakeswap_v3';

/** Price quote from a single source */
export interface SourceQuote {
  /** Price source */
  source: PriceSource;
  /** Input token */
  srcToken: DexToken;
  /** Output token */
  destToken: DexToken;
  /** Input amount in wei */
  srcAmount: string;
  /** Output amount in wei */
  destAmount: string;
  /** Effective price (destAmount / srcAmount, human-readable) */
  effectivePrice: string;
  /** Estimated gas cost in wei */
  gasCostWei: string;
  /** Estimated gas cost in USD */
  gasCostUsd: string;
  /** Output amount minus gas cost, in output token units */
  netDestAmount: string;
  /** Quote timestamp */
  timestamp: number;
  /** Whether the quote is currently valid */
  valid: boolean;
  /** Expiry timestamp (if applicable) */
  expiresAt?: number;
}

/** Comparison result between multiple price sources */
export interface PriceComparison {
  /** Source token */
  srcToken: DexToken;
  /** Destination token */
  destToken: DexToken;
  /** Input amount in wei */
  srcAmount: string;
  /** All collected quotes */
  quotes: SourceQuote[];
  /** Best quote (highest net output) */
  bestQuote: SourceQuote;
  /** Price difference between best and worst in bps */
  spreadBps: number;
  /** Comparison timestamp */
  timestamp: number;
}

// ─── Split Route Types ────────────────────────────────────────────────────────

/** Split allocation between venues */
export interface SplitAllocation {
  /** Price source */
  source: PriceSource;
  /** Fraction of total input allocated (0 to 1) */
  fraction: number;
  /** Input amount allocated in wei */
  srcAmount: string;
  /** Expected output amount in wei */
  destAmount: string;
}

/** Optimized split route */
export interface SplitRoute {
  /** Source token */
  srcToken: DexToken;
  /** Destination token */
  destToken: DexToken;
  /** Total input amount in wei */
  totalSrcAmount: string;
  /** Total expected output in wei */
  totalDestAmount: string;
  /** Individual allocations */
  allocations: SplitAllocation[];
  /** Total estimated gas cost in wei */
  totalGasCostWei: string;
  /** Net output after gas costs */
  netDestAmount: string;
  /** Improvement over best single source in bps */
  improvementBps: number;
  /** Whether split routing is beneficial (vs single source) */
  splitBeneficial: boolean;
  /** Route computation timestamp */
  timestamp: number;
}

/** Split route execution result */
export interface SplitExecutionResult {
  /** The route that was executed */
  route: SplitRoute;
  /** Per-allocation execution results */
  executions: AllocationExecution[];
  /** Total actual output received in wei */
  totalActualOutput: string;
  /** Slippage realized in bps (vs expected) */
  realizedSlippageBps: number;
  /** Total gas used */
  totalGasUsed: string;
  /** Overall success */
  success: boolean;
  /** Execution timestamp */
  executedAt: number;
}

/** Execution result for a single allocation */
export interface AllocationExecution {
  /** Allocation that was executed */
  allocation: SplitAllocation;
  /** Transaction hash (for on-chain portions) */
  txHash?: string;
  /** Actual output amount received in wei */
  actualOutput: string;
  /** Execution success */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

// ─── Pool Types ───────────────────────────────────────────────────────────────

/** PancakeSwap liquidity pool */
export interface PancakeSwapPool {
  /** Pool address */
  address: string;
  /** Pool version */
  version: 'v2' | 'v3';
  /** Token0 */
  token0: DexToken;
  /** Token1 */
  token1: DexToken;
  /** Fee tier in bps (v3 only: 100, 500, 2500, 10000) */
  feeBps?: number;
  /** Current tick (v3 only) */
  tick?: number;
  /** sqrtPriceX96 (v3 only) */
  sqrtPriceX96?: string;
  /** Total value locked in USD */
  tvlUsd?: string;
  /** 24h volume in USD */
  volume24hUsd?: string;
  /** Reserve0 (v2 only) */
  reserve0?: string;
  /** Reserve1 (v2 only) */
  reserve1?: string;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export type BinanceDexAdapterEvent =
  | 'price:updated'
  | 'price:error'
  | 'comparison:ready'
  | 'route:computed'
  | 'route:executed'
  | 'route:error';

export type BinanceDexEventHandler<T = unknown> = (data: T) => void;
