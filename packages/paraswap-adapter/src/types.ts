/**
 * @deluthium/paraswap-adapter - Type definitions
 *
 * Types for Paraswap Augustus integration, rate provisioning,
 * and on-chain pool adapter interaction.
 */

import type { DeluthiumClientConfig, ISigner } from '@deluthium/sdk';

// ─── Adapter Configuration ────────────────────────────────────────────────────

export interface ParaswapAdapterConfig {
  /** Deluthium SDK client configuration */
  deluthium: DeluthiumClientConfig;

  /** Signer for on-chain transactions */
  signer: ISigner;

  /** Chain ID to operate on (default: from deluthium config) */
  chainId?: number;

  /** Augustus Swapper contract address (auto-resolved by chain if omitted) */
  augustusAddress?: string;

  /** Deployed DeluthiumParaswapPool adapter contract address */
  poolAdapterAddress?: string;

  /** How often to refresh rates in ms (default: 5000) */
  rateRefreshIntervalMs?: number;

  /** Maximum slippage tolerance in basis points (default: 50 = 0.5%) */
  maxSlippageBps?: number;

  /** Rate markup in basis points applied to indicative quotes (default: 5 = 0.05%) */
  rateMarkupBps?: number;
}

// ─── Augustus / Paraswap Types ────────────────────────────────────────────────

/** Paraswap supported chains and their Augustus Swapper addresses */
export const AUGUSTUS_ADDRESSES: Record<number, string> = {
  1: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',       // Ethereum
  56: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',      // BNB Chain
  137: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',     // Polygon
  42161: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',   // Arbitrum
  10: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',      // Optimism
  43114: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',   // Avalanche
  8453: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',    // Base
};

/** Token metadata for Paraswap rate requests */
export interface ParaswapToken {
  address: string;
  decimals: number;
  symbol?: string;
}

/** Rate request from Paraswap's routing engine to our liquidity pool */
export interface RateRequest {
  /** Source token */
  srcToken: ParaswapToken;
  /** Destination token */
  destToken: ParaswapToken;
  /** Amount of source token in wei */
  srcAmount: string;
  /** Chain ID */
  chainId: number;
  /** Side: SELL or BUY */
  side: 'SELL' | 'BUY';
}

/** Rate response to Paraswap routing engine */
export interface RateResponse {
  /** Source token address */
  srcToken: string;
  /** Destination token address */
  destToken: string;
  /** Source amount in wei */
  srcAmount: string;
  /** Destination amount in wei (the quote) */
  destAmount: string;
  /** Exchange identifier */
  exchange: string;
  /** Pool identifier */
  poolId: string;
  /** Data blob for Augustus to pass to the pool adapter */
  data: string;
  /** Gas cost estimate */
  gasCost: string;
}

/** Build transaction request */
export interface BuildTxRequest {
  /** Source token address */
  srcToken: string;
  /** Destination token address */
  destToken: string;
  /** Source amount in wei */
  srcAmount: string;
  /** Expected destination amount in wei */
  destAmount: string;
  /** Minimum destination amount (after slippage) in wei */
  minDestAmount: string;
  /** Sender address */
  sender: string;
  /** Receiver address */
  receiver: string;
  /** Chain ID */
  chainId: number;
  /** Deadline (unix timestamp seconds) */
  deadline: number;
}

/** Built transaction ready for submission */
export interface BuiltTransaction {
  /** To address (Augustus Swapper) */
  to: string;
  /** Transaction value in wei (for native token swaps) */
  value: string;
  /** Encoded calldata */
  data: string;
  /** Gas limit estimate */
  gasLimit: string;
  /** Chain ID */
  chainId: number;
}

// ─── Price Cache ──────────────────────────────────────────────────────────────

/** Cached rate entry */
export interface CachedRate {
  /** Rate request that produced this */
  request: RateRequest;
  /** Rate response */
  response: RateResponse;
  /** Timestamp when cached */
  cachedAt: number;
  /** TTL in ms */
  ttlMs: number;
}

// ─── Pool Registration ────────────────────────────────────────────────────────

/** Pool registration status */
export interface PoolRegistrationStatus {
  /** Whether the pool is registered with Augustus */
  registered: boolean;
  /** Pool adapter contract address */
  adapterAddress?: string;
  /** Chain ID */
  chainId: number;
  /** Supported trading pairs */
  supportedPairs: Array<{ srcToken: string; destToken: string }>;
  /** Registration timestamp */
  registeredAt?: number;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export type ParaswapAdapterEvent =
  | 'rate:updated'
  | 'rate:error'
  | 'swap:executed'
  | 'swap:error'
  | 'pool:registered'
  | 'pool:deregistered';

export type ParaswapEventHandler<T = unknown> = (data: T) => void;

export interface RateUpdateEvent {
  pair: string;
  srcToken: string;
  destToken: string;
  rate: string;
  timestamp: number;
}

export interface SwapExecutedEvent {
  txHash: string;
  srcToken: string;
  destToken: string;
  srcAmount: string;
  destAmount: string;
  sender: string;
  receiver: string;
  timestamp: number;
}
