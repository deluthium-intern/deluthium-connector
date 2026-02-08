/**
 * @deluthium/hashflow-adapter - Type definitions
 *
 * Types for the Hashflow WebSocket RFQ protocol, price levels,
 * cross-chain messaging, and adapter configuration.
 */

import type { Address, HexString, ISigner, DeluthiumClientConfig } from '@deluthium/sdk';

// ─── Chain Types ────────────────────────────────────────────────────────────

/** Chains supported by Hashflow */
export type HashflowChain =
  | 'ethereum'
  | 'arbitrum'
  | 'avalanche'
  | 'bsc'
  | 'optimism'
  | 'polygon'
  | 'base'
  | 'solana';

/** Mapping of Hashflow chain names to EVM chain IDs */
export const HASHFLOW_CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  arbitrum: 42161,
  avalanche: 43114,
  bsc: 56,
  optimism: 10,
  polygon: 137,
  base: 8453,
};

/** Reverse mapping: EVM chain ID to Hashflow chain name */
export const CHAIN_ID_TO_HASHFLOW: Record<number, HashflowChain> = {
  1: 'ethereum',
  42161: 'arbitrum',
  43114: 'avalanche',
  56: 'bsc',
  10: 'optimism',
  137: 'polygon',
  8453: 'base',
};

// ─── WebSocket Message Types ────────────────────────────────────────────────

/** Types of messages in the Hashflow WebSocket protocol */
export type HashflowMessageType =
  | 'auth'
  | 'auth_response'
  | 'price_levels'
  | 'rfq_request'           // rfqT (taker RFQ request)
  | 'rfq_response'          // Maker's response to rfqT
  | 'market_maker_status'
  | 'heartbeat'
  | 'error';

/** Base WebSocket message structure */
export interface HashflowWSMessage<T = unknown> {
  readonly type: HashflowMessageType;
  readonly messageId?: string;
  readonly data?: T;
  readonly timestamp?: number;
  readonly error?: string;
}

// ─── Authentication ─────────────────────────────────────────────────────────

/** Authentication request sent to Hashflow WebSocket */
export interface HashflowAuthRequest {
  /** Market maker identifier registered with Hashflow */
  readonly marketMaker: string;
  /** EIP-191 signature of the auth challenge */
  readonly signature: string;
  /** Wallet address associated with the market maker */
  readonly signerAddress: Address;
}

/** Authentication response from Hashflow */
export interface HashflowAuthResponse {
  readonly success: boolean;
  readonly sessionId?: string;
  readonly error?: string;
}

// ─── Price Levels ───────────────────────────────────────────────────────────

/** A single price level (bid or ask) */
export interface PriceLevel {
  /** Price at this level (human-readable decimal) */
  readonly price: string;
  /** Available quantity at this price (in base token, human-readable) */
  readonly quantity: string;
}

/** Price levels for a specific trading pair on a specific chain */
export interface PriceLevels {
  /** Trading pair identifier (e.g. "ETH/USDC") */
  readonly pair: string;
  /** Chain where these prices are valid */
  readonly chain: HashflowChain;
  /** Base token address */
  readonly baseToken: Address;
  /** Quote token address */
  readonly quoteToken: Address;
  /** Bid (buy) levels -- sorted best to worst */
  readonly bids: PriceLevel[];
  /** Ask (sell) levels -- sorted best to worst */
  readonly asks: PriceLevel[];
  /** Timestamp when these levels were generated (ms) */
  readonly timestamp: number;
  /** TTL in seconds for these price levels */
  readonly ttlSeconds: number;
}

/** Message payload for publishing price levels to Hashflow */
export interface PriceLevelsMessage {
  readonly pair: string;
  readonly chain: HashflowChain;
  readonly baseToken: string;
  readonly quoteToken: string;
  readonly bids: PriceLevel[];
  readonly asks: PriceLevel[];
  readonly ttlSeconds: number;
}

// ─── RFQ Types ──────────────────────────────────────────────────────────────

/** Hashflow RFQ request (rfqT) from a taker */
export interface HashflowRFQRequest {
  /** Unique request identifier */
  readonly rfqId: string;
  /** Chain where the trade will execute */
  readonly chain: HashflowChain;
  /** EVM chain ID */
  readonly chainId: number;
  /** Base token address */
  readonly baseToken: Address;
  /** Quote token address */
  readonly quoteToken: Address;
  /** Amount of base token (in wei as string) */
  readonly baseTokenAmount?: string;
  /** Amount of quote token (in wei as string) */
  readonly quoteTokenAmount?: string;
  /** Trade direction from taker's perspective */
  readonly tradeDirection: 'sell' | 'buy';
  /** Taker's wallet address */
  readonly trader: Address;
  /** Effective trader (may differ for smart contract wallets) */
  readonly effectiveTrader?: Address;
  /** Deadline for the RFQ response (unix timestamp seconds) */
  readonly responseDeadline: number;
  /** Whether this is a cross-chain trade */
  readonly isCrossChain: boolean;
  /** Destination chain for cross-chain trades */
  readonly dstChain?: HashflowChain;
  /** Destination chain ID for cross-chain trades */
  readonly dstChainId?: number;
}

/** Hashflow RFQ response (market maker's quote) */
export interface HashflowRFQResponse {
  /** Must match the rfqId from the request */
  readonly rfqId: string;
  /** Chain identifier */
  readonly chain: HashflowChain;
  /** Base token address */
  readonly baseToken: Address;
  /** Quote token address */
  readonly quoteToken: Address;
  /** Quoted base token amount (in wei) */
  readonly baseTokenAmount: string;
  /** Quoted quote token amount (in wei) */
  readonly quoteTokenAmount: string;
  /** Quote expiry timestamp (unix seconds) */
  readonly quoteExpiry: number;
  /** EIP-191 signature of the quote */
  readonly signature: string;
  /** Signer address */
  readonly signerAddress: Address;
  /** Hashflow pool contract address to execute through */
  readonly pool: Address;
  /** Nonce for replay protection */
  readonly nonce: string;
  /** Transaction ID for tracking */
  readonly txid: HexString;
  /** For cross-chain: destination chain */
  readonly dstChain?: HashflowChain;
  /** For cross-chain: destination pool */
  readonly dstPool?: Address;
  /** For cross-chain: destination external account */
  readonly dstExternalAccount?: Address;
}

// ─── Hashflow Quote Struct (on-chain) ───────────────────────────────────────

/** The on-chain quote structure signed by the market maker */
export interface HashflowQuoteData {
  /** Hashflow pool address */
  readonly pool: Address;
  /** External account (trader) address */
  readonly externalAccount: Address;
  /** Effective trader address */
  readonly effectiveTrader: Address;
  /** Base token address */
  readonly baseToken: Address;
  /** Quote token address */
  readonly quoteToken: Address;
  /** Base token amount in wei */
  readonly baseTokenAmount: bigint;
  /** Quote token amount in wei */
  readonly quoteTokenAmount: bigint;
  /** Nonce */
  readonly nonce: bigint;
  /** Transaction ID */
  readonly txid: HexString;
  /** Quote expiry (unix timestamp seconds) */
  readonly quoteExpiry: number;
}

// ─── Cross-chain Types ──────────────────────────────────────────────────────

/** Supported cross-chain messaging protocols */
export type CrossChainProtocol = 'wormhole' | 'layerzero';

/** Cross-chain quote extension */
export interface CrossChainQuoteData extends HashflowQuoteData {
  /** Source chain */
  readonly srcChain: HashflowChain;
  /** Destination chain */
  readonly dstChain: HashflowChain;
  /** Destination chain ID */
  readonly dstChainId: number;
  /** Destination pool address */
  readonly dstPool: Address;
  /** Destination external account */
  readonly dstExternalAccount: Address;
  /** Cross-chain messaging protocol */
  readonly xChainProtocol: CrossChainProtocol;
}

// ─── Market Maker Status ────────────────────────────────────────────────────

/** Market maker online/offline status */
export interface MarketMakerStatus {
  /** Whether the MM is active and accepting RFQs */
  readonly active: boolean;
  /** Supported trading pairs */
  readonly supportedPairs: string[];
  /** Supported chains */
  readonly supportedChains: HashflowChain[];
  /** Last heartbeat timestamp */
  readonly lastHeartbeat: number;
}

// ─── Adapter Configuration ──────────────────────────────────────────────────

/** Configuration for the Hashflow adapter */
export interface HashflowAdapterConfig {
  /** Deluthium SDK client configuration */
  readonly deluthiumConfig: DeluthiumClientConfig;
  /** Signer for EIP-191 signing (quotes and authentication) */
  readonly signer: ISigner;
  /** Market maker identifier registered with Hashflow */
  readonly marketMaker: string;
  /** Hashflow WebSocket URL (default: wss://maker-ws.hashflow.com/v3) */
  readonly hashflowWsUrl?: string;
  /** Chain(s) to operate on */
  readonly chains: number[];
  /** Trading pairs to support (e.g. ["ETH/USDC", "BNB/USDT"]) */
  readonly pairs: string[];
  /** How often to refresh price levels in ms (default: 5000) */
  readonly priceRefreshIntervalMs?: number;
  /** Maximum spread to add on top of Deluthium quotes in bps (default: 5) */
  readonly spreadBps?: number;
  /** Number of price levels to publish (default: 5) */
  readonly numLevels?: number;
  /** Price level TTL in seconds (default: 10) */
  readonly levelTtlSeconds?: number;
  /** Maximum quote validity in seconds (default: 30) */
  readonly maxQuoteExpirySec?: number;
  /** Hashflow pool contract addresses per chain */
  readonly poolAddresses?: Record<number, Address>;
  /** Whether to auto-reconnect on disconnect (default: true) */
  readonly autoReconnect?: boolean;
}

// ─── Adapter Events ─────────────────────────────────────────────────────────

/** Events emitted by the Hashflow adapter */
export interface HashflowAdapterEvents {
  /** Connected to Hashflow WebSocket */
  connected: () => void;
  /** Disconnected from Hashflow WebSocket */
  disconnected: (code: number, reason: string) => void;
  /** Authentication successful */
  authenticated: (sessionId: string) => void;
  /** Price levels published */
  pricesPublished: (levels: PriceLevels) => void;
  /** RFQ request received from taker */
  rfqReceived: (request: HashflowRFQRequest) => void;
  /** RFQ response sent to taker */
  rfqResponded: (response: HashflowRFQResponse) => void;
  /** RFQ request could not be quoted */
  rfqDeclined: (rfqId: string, reason: string) => void;
  /** Adapter error */
  error: (error: Error) => void;
}
