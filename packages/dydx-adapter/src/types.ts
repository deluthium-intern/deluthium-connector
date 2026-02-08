/**
 * @deluthium/dydx-adapter - Type definitions
 *
 * Types for dYdX v4 (Cosmos-based) integration, order book bridging,
 * market data, and cross-venue arbitrage.
 */

import type { DeluthiumClientConfig, ISigner } from '@deluthium/sdk';

// ─── Adapter Configuration ────────────────────────────────────────────────────

export interface DydxAdapterConfig {
  /** Deluthium SDK client configuration */
  deluthium: DeluthiumClientConfig;

  /** Signer for Deluthium operations (EVM) */
  signer: ISigner;

  /** dYdX network: mainnet or testnet */
  network: 'mainnet' | 'testnet';

  /** dYdX chain REST endpoint (auto-resolved by network if omitted) */
  restEndpoint?: string;

  /** dYdX chain WebSocket endpoint (auto-resolved by network if omitted) */
  wsEndpoint?: string;

  /** dYdX chain gRPC endpoint (auto-resolved by network if omitted) */
  grpcEndpoint?: string;

  /** dYdX account mnemonic (for Cosmos signing) */
  mnemonic?: string;

  /** dYdX subaccount number (default: 0) */
  subaccountNumber?: number;

  /** How often to refresh order book bridge in ms (default: 2000) */
  bridgeRefreshIntervalMs?: number;

  /** Order bridge strategy */
  bridgeStrategy?: OrderBridgeStrategy;

  /** Maximum number of concurrent bridge orders (default: 10) */
  maxBridgeOrders?: number;

  /** Price deviation threshold in bps before refreshing bridge orders (default: 20) */
  priceDeviationThresholdBps?: number;
}

// ─── dYdX Network Configuration ───────────────────────────────────────────────

export const DYDX_ENDPOINTS = {
  mainnet: {
    rest: 'https://dydx-ops-rest.kingnodes.com',
    ws: 'wss://dydx-ops-ws.kingnodes.com/v4/ws',
    grpc: 'https://dydx-ops-grpc.kingnodes.com',
    chainId: 'dydx-mainnet-1',
    indexerRest: 'https://indexer.dydx.trade/v4',
    indexerWs: 'wss://indexer.dydx.trade/v4/ws',
  },
  testnet: {
    rest: 'https://dydx-testnet-rest.kingnodes.com',
    ws: 'wss://dydx-testnet-ws.kingnodes.com/v4/ws',
    grpc: 'https://dydx-testnet-grpc.kingnodes.com',
    chainId: 'dydx-testnet-4',
    indexerRest: 'https://indexer.v4testnet.dydx.exchange/v4',
    indexerWs: 'wss://indexer.v4testnet.dydx.exchange/v4/ws',
  },
} as const;

export type DydxNetwork = keyof typeof DYDX_ENDPOINTS;

// ─── Order Types ──────────────────────────────────────────────────────────────

/** dYdX order side */
export type OrderSide = 'BUY' | 'SELL';

/** dYdX order type */
export type OrderType = 'LIMIT' | 'MARKET' | 'STOP_LIMIT' | 'STOP_MARKET';

/** dYdX order time-in-force */
export type TimeInForce = 'GTT' | 'IOC' | 'FOK';

/** dYdX order status */
export type OrderStatus =
  | 'PENDING'
  | 'OPEN'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'EXPIRED';

/** dYdX perpetual market */
export interface DydxMarket {
  /** Market ticker (e.g., "BTC-USD") */
  ticker: string;
  /** Market status */
  status: 'ACTIVE' | 'PAUSED' | 'CANCEL_ONLY' | 'FINAL_SETTLEMENT';
  /** Base asset (e.g., "BTC") */
  baseAsset: string;
  /** Quote asset (always "USD") */
  quoteAsset: string;
  /** Atomic resolution (tick size exponent) */
  atomicResolution: number;
  /** Quantum conversion exponent */
  quantumConversionExponent: number;
  /** Step base quantums (minimum order size in base quantums) */
  stepBaseQuantums: number;
  /** Subticks per tick */
  subticksPerTick: number;
  /** Oracle price */
  oraclePrice: string;
  /** 24h price change percentage */
  priceChange24h?: string;
  /** 24h volume in quote currency */
  volume24h?: string;
  /** Open interest in base currency */
  openInterest?: string;
  /** Next funding rate */
  nextFundingRate?: string;
  /** Initial margin fraction */
  initialMarginFraction: string;
  /** Maintenance margin fraction */
  maintenanceMarginFraction: string;
}

/** dYdX order book level */
export interface OrderBookLevel {
  /** Price level */
  price: string;
  /** Size at this level */
  size: string;
}

/** dYdX order book snapshot */
export interface OrderBook {
  /** Market ticker */
  ticker: string;
  /** Bid levels (sorted best to worst) */
  bids: OrderBookLevel[];
  /** Ask levels (sorted best to worst) */
  asks: OrderBookLevel[];
  /** Snapshot timestamp */
  timestamp: number;
}

/** dYdX order parameters for placement */
export interface DydxOrderParams {
  /** Market ticker */
  ticker: string;
  /** Order side */
  side: OrderSide;
  /** Order type */
  type: OrderType;
  /** Size in base currency */
  size: string;
  /** Price (required for limit orders) */
  price?: string;
  /** Time in force */
  timeInForce: TimeInForce;
  /** Good-til-time in seconds from now (for GTT orders) */
  goodTilTimeSec?: number;
  /** Whether to post-only (maker only) */
  postOnly?: boolean;
  /** Whether to reduce-only */
  reduceOnly?: boolean;
  /** Client order ID */
  clientId?: number;
}

/** dYdX order (placed or from order book) */
export interface DydxOrder {
  /** Order ID on dYdX chain */
  orderId: string;
  /** Client-specified order ID */
  clientId: number;
  /** Market ticker */
  ticker: string;
  /** Order side */
  side: OrderSide;
  /** Order type */
  type: OrderType;
  /** Order size in base currency */
  size: string;
  /** Filled size in base currency */
  filledSize: string;
  /** Remaining size */
  remainingSize: string;
  /** Limit price */
  price: string;
  /** Order status */
  status: OrderStatus;
  /** Time in force */
  timeInForce: TimeInForce;
  /** Good-til-block or good-til-time */
  goodTilBlock?: number;
  goodTilTime?: string;
  /** Post-only flag */
  postOnly: boolean;
  /** Reduce-only flag */
  reduceOnly: boolean;
  /** Created timestamp */
  createdAt: string;
}

// ─── Bridge Types ─────────────────────────────────────────────────────────────

/** Order bridge strategy */
export type OrderBridgeStrategy =
  | 'mirror'       // Mirror Deluthium quotes as dYdX limit orders
  | 'spread'       // Place orders with a spread around Deluthium mid-price
  | 'dynamic';     // Dynamically adjust based on market conditions

/** Bridge order -- a dYdX order derived from a Deluthium quote */
export interface BridgeOrder {
  /** Internal bridge order ID */
  bridgeId: string;
  /** dYdX order (once placed) */
  dydxOrder?: DydxOrder;
  /** Source Deluthium quote data */
  sourceQuote: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
    price: string;
    timestamp: number;
  };
  /** Target dYdX market ticker */
  ticker: string;
  /** Target side on dYdX */
  side: OrderSide;
  /** Target price on dYdX */
  price: string;
  /** Target size on dYdX */
  size: string;
  /** Bridge status */
  status: 'pending' | 'placed' | 'filled' | 'cancelled' | 'error';
  /** Error message if status is 'error' */
  error?: string;
  /** Created timestamp */
  createdAt: number;
  /** Last updated timestamp */
  updatedAt: number;
}

// ─── Arbitrage Types ──────────────────────────────────────────────────────────

/** Cross-venue arbitrage opportunity */
export interface ArbitrageOpportunity {
  /** Unique opportunity ID */
  id: string;
  /** Asset pair (e.g., "BTC-USD") */
  pair: string;
  /** Direction: buy on one venue, sell on the other */
  direction: 'buy_dydx_sell_deluthium' | 'buy_deluthium_sell_dydx';
  /** dYdX price */
  dydxPrice: string;
  /** Deluthium price */
  deluthiumPrice: string;
  /** Price difference in basis points */
  spreadBps: number;
  /** Estimated profit in USD */
  estimatedProfitUsd: string;
  /** Maximum executable size */
  maxSize: string;
  /** Detection timestamp */
  detectedAt: number;
  /** Whether the opportunity is still valid */
  valid: boolean;
  /** Estimated execution cost (gas, fees) in USD */
  estimatedCostUsd: string;
  /** Net profit after costs */
  netProfitUsd: string;
}

/** Arbitrage configuration */
export interface ArbitrageConfig {
  /** Minimum spread in bps to trigger (default: 30) */
  minSpreadBps: number;
  /** Maximum position size in USD (default: 10000) */
  maxPositionUsd: number;
  /** Minimum profit threshold in USD (default: 5) */
  minProfitUsd: number;
  /** Whether to auto-execute opportunities (default: false, notify only) */
  autoExecute: boolean;
  /** Pairs to monitor */
  pairs: string[];
}

// ─── Account Types ────────────────────────────────────────────────────────────

/** dYdX subaccount info */
export interface DydxSubaccount {
  /** Subaccount number */
  subaccountNumber: number;
  /** Equity in USD */
  equity: string;
  /** Free collateral in USD */
  freeCollateral: string;
  /** Total open positions value */
  openPositionsValue: string;
  /** Margin usage ratio (0 to 1) */
  marginUsage: string;
  /** Open positions */
  positions: DydxPosition[];
}

/** dYdX perpetual position */
export interface DydxPosition {
  /** Market ticker */
  ticker: string;
  /** Position side */
  side: 'LONG' | 'SHORT';
  /** Position size in base currency */
  size: string;
  /** Entry price */
  entryPrice: string;
  /** Unrealized PnL in USD */
  unrealizedPnl: string;
  /** Realized PnL in USD */
  realizedPnl: string;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export type DydxAdapterEvent =
  | 'orderbook:update'
  | 'bridge:placed'
  | 'bridge:filled'
  | 'bridge:cancelled'
  | 'bridge:error'
  | 'arbitrage:detected'
  | 'arbitrage:executed'
  | 'market:update'
  | 'connected'
  | 'disconnected';

export type DydxEventHandler<T = unknown> = (data: T) => void;
