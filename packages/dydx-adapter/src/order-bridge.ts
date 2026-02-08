/**
 * @deluthium/dydx-adapter - Order Bridge
 *
 * Converts Deluthium indicative quotes into dYdX limit orders and
 * manages their lifecycle. Continuously monitors price deviations
 * and refreshes bridge orders to keep them in sync with Deluthium
 * market pricing.
 *
 * Strategies:
 * - mirror  : Place dYdX limit orders at the exact Deluthium quote price
 * - spread  : Place orders with a configurable spread around mid-price
 * - dynamic : Adjust spread based on volatility and fill rates
 *
 * @packageDocumentation
 */

import {
  DeluthiumRestClient,
  retry,
  generateNonce,
} from '@deluthium/sdk';
import { DeluthiumError } from '@deluthium/sdk';
import type { IndicativeQuoteRequest, IndicativeQuoteResponse } from '@deluthium/sdk';
import type {
  DydxAdapterConfig,
  OrderBridgeStrategy,
  BridgeOrder,
  DydxOrderParams,
  OrderSide,
  DydxAdapterEvent,
  DydxEventHandler,
} from './types.js';
import type { CosmosClient } from './cosmos-client.js';
import type { MarketDataFeed } from './market-data.js';

const DEFAULT_REFRESH_INTERVAL_MS = 2_000;
const DEFAULT_MAX_BRIDGE_ORDERS = 10;
const DEFAULT_DEVIATION_THRESHOLD_BPS = 20;
const DEFAULT_ORDER_TTL_SEC = 60;
const BRIDGE_ID_PREFIX = 'bridge-';

/**
 * Mapping configuration from Deluthium token pairs to dYdX market tickers.
 */
export interface TokenTickerMapping {
  /** Deluthium token_in address */
  tokenIn: string;
  /** Deluthium token_out address */
  tokenOut: string;
  /** dYdX market ticker (e.g. "BTC-USD") */
  ticker: string;
  /** Deluthium chain ID for the quote */
  chainId: number;
  /** The side on dYdX when buying tokenOut on Deluthium */
  dydxSide: OrderSide;
  /** Base token decimals for size conversion */
  baseDecimals: number;
  /** Quote amount to use for indicative quotes (in wei) */
  quoteAmountWei: string;
}

/**
 * Bridges Deluthium indicative quotes to dYdX limit orders.
 *
 * Periodically fetches Deluthium quotes for configured token pairs,
 * converts them to dYdX order parameters, and places/refreshes limit
 * orders on the dYdX order book. When prices deviate beyond the
 * configured threshold, orders are cancelled and replaced.
 *
 * @example
 * ```typescript
 * const bridge = new OrderBridge(config, cosmosClient, marketData, client);
 * bridge.addMapping({ tokenIn: '0xA', tokenOut: '0xB', ticker: 'BTC-USD',
 *   chainId: 56, dydxSide: 'BUY', baseDecimals: 18, quoteAmountWei: '1000000000000000000' });
 * await bridge.start();
 * ```
 */
export class OrderBridge {
  private readonly cosmosClient: CosmosClient;
  private readonly marketData: MarketDataFeed;
  private readonly deluthiumClient: DeluthiumRestClient;
  private readonly strategy: OrderBridgeStrategy;
  private readonly refreshIntervalMs: number;
  private readonly maxBridgeOrders: number;
  private readonly deviationThresholdBps: number;
  private readonly bridgeOrders = new Map<string, BridgeOrder>();
  private readonly mappings: TokenTickerMapping[] = [];
  private readonly listeners = new Map<string, Set<DydxEventHandler<unknown>>>();
  private running = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private nonceCounter = 0;

  constructor(
    config: DydxAdapterConfig,
    cosmosClient: CosmosClient,
    marketData: MarketDataFeed,
    deluthiumClient: DeluthiumRestClient,
  ) {
    this.cosmosClient = cosmosClient;
    this.marketData = marketData;
    this.deluthiumClient = deluthiumClient;
    this.strategy = config.bridgeStrategy ?? 'mirror';
    this.refreshIntervalMs = config.bridgeRefreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    this.maxBridgeOrders = config.maxBridgeOrders ?? DEFAULT_MAX_BRIDGE_ORDERS;
    this.deviationThresholdBps = config.priceDeviationThresholdBps ?? DEFAULT_DEVIATION_THRESHOLD_BPS;
  }

  /** Add a token pair mapping for the bridge. */
  addMapping(mapping: TokenTickerMapping): void {
    this.mappings.push(mapping);
  }

  /** Remove a mapping by ticker. */
  removeMapping(ticker: string): void {
    const idx = this.mappings.findIndex((m) => m.ticker === ticker);
    if (idx >= 0) this.mappings.splice(idx, 1);
  }

  /** Get all current bridge orders. */
  getBridgeOrders(): BridgeOrder[] {
    return Array.from(this.bridgeOrders.values());
  }

  /** Get bridge orders for a specific ticker. */
  getBridgeOrdersByTicker(ticker: string): BridgeOrder[] {
    return this.getBridgeOrders().filter((o) => o.ticker === ticker);
  }

  /** Start the order bridge refresh loop. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.refreshCycle();
  }

  /** Stop the order bridge and cancel all active bridge orders. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    await this.cancelAllBridgeOrders();
  }

  /** Whether the bridge is currently running. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Register an event listener. */
  on(event: DydxAdapterEvent, handler: DydxEventHandler<unknown>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  /** Remove an event listener. */
  off(event: DydxAdapterEvent, handler: DydxEventHandler<unknown>): void {
    this.listeners.get(event)?.delete(handler);
  }

  private async refreshCycle(): Promise<void> {
    if (!this.running) return;
    try {
      await this.processAllMappings();
      await this.checkAndRefreshOrders();
    } catch (err) {
      this.emit('bridge:error', {
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      });
    }
    if (this.running) {
      this.refreshTimer = setTimeout(() => { void this.refreshCycle(); }, this.refreshIntervalMs);
    }
  }

  private async processAllMappings(): Promise<void> {
    for (const mapping of this.mappings) {
      if (!this.running) break;
      try {
        await this.processSingleMapping(mapping);
      } catch (err) {
        this.emit('bridge:error', {
          ticker: mapping.ticker,
          error: err instanceof Error ? err.message : String(err),
          timestamp: Date.now(),
        });
      }
    }
  }

  private async processSingleMapping(mapping: TokenTickerMapping): Promise<void> {
    const existingOrders = this.getBridgeOrdersByTicker(mapping.ticker);
    if (existingOrders.length >= this.maxBridgeOrders) return;

    const quoteReq: IndicativeQuoteRequest = {
      src_chain_id: mapping.chainId,
      dst_chain_id: mapping.chainId,
      token_in: mapping.tokenIn,
      token_out: mapping.tokenOut,
      amount_in: mapping.quoteAmountWei,
    };

    const quote = await retry(
      () => this.deluthiumClient.getIndicativeQuote(quoteReq),
      2, 500,
    );

    const orderParams = this.convertQuoteToOrder(quote, mapping);
    if (!orderParams) return;

    const existingOrder = existingOrders.find(
      (o) => o.status === 'placed' && o.side === mapping.dydxSide,
    );

    if (existingOrder) {
      const deviation = this.calculateDeviationBps(existingOrder.price, orderParams.price!);
      if (deviation < this.deviationThresholdBps) return;
      await this.cancelBridgeOrder(existingOrder.bridgeId);
    }

    await this.placeBridgeOrder(orderParams, quote, mapping);
  }

  private convertQuoteToOrder(
    quote: IndicativeQuoteResponse,
    mapping: TokenTickerMapping,
  ): DydxOrderParams | null {
    const price = parseFloat(quote.price);
    if (!price || price <= 0) return null;
    const amountOut = parseFloat(quote.amount_out);
    if (!amountOut) return null;

    let dydxPrice: number;
    let dydxSize: number;

    switch (this.strategy) {
      case 'mirror':
        dydxPrice = price;
        dydxSize = this.computeBaseSize(amountOut, mapping);
        break;
      case 'spread': {
        const spreadBps = this.deviationThresholdBps / 2;
        const mult = mapping.dydxSide === 'BUY' ? 1 - spreadBps / 10_000 : 1 + spreadBps / 10_000;
        dydxPrice = price * mult;
        dydxSize = this.computeBaseSize(amountOut, mapping);
        break;
      }
      case 'dynamic': {
        const marketSpread = this.marketData.getSpreadBps(mapping.ticker);
        const dynamicBps = marketSpread
          ? Math.max(marketSpread * 0.5, this.deviationThresholdBps / 4)
          : this.deviationThresholdBps / 2;
        const dynMult = mapping.dydxSide === 'BUY' ? 1 - dynamicBps / 10_000 : 1 + dynamicBps / 10_000;
        dydxPrice = price * dynMult;
        dydxSize = this.computeBaseSize(amountOut, mapping);
        break;
      }
      default:
        return null;
    }

    if (dydxSize <= 0 || dydxPrice <= 0) return null;
    return {
      ticker: mapping.ticker, side: mapping.dydxSide, type: 'LIMIT',
      size: dydxSize.toFixed(8), price: dydxPrice.toFixed(2),
      timeInForce: 'GTT', goodTilTimeSec: DEFAULT_ORDER_TTL_SEC, postOnly: true,
    };
  }

  private computeBaseSize(amountOut: number, mapping: TokenTickerMapping): number {
    return amountOut / Math.pow(10, mapping.baseDecimals);
  }

  private async placeBridgeOrder(
    params: DydxOrderParams, sourceQuote: IndicativeQuoteResponse, mapping: TokenTickerMapping,
  ): Promise<void> {
    const bridgeId = this.generateBridgeId();
    const bridgeOrder: BridgeOrder = {
      bridgeId,
      sourceQuote: {
        tokenIn: sourceQuote.token_in, tokenOut: sourceQuote.token_out,
        amountIn: sourceQuote.amount_in, amountOut: sourceQuote.amount_out,
        price: sourceQuote.price, timestamp: sourceQuote.timestamp,
      },
      ticker: mapping.ticker, side: mapping.dydxSide,
      price: params.price!, size: params.size,
      status: 'pending', createdAt: Date.now(), updatedAt: Date.now(),
    };
    this.bridgeOrders.set(bridgeId, bridgeOrder);

    try {
      const dydxOrder = await this.cosmosClient.placeOrder(params);
      bridgeOrder.dydxOrder = dydxOrder;
      bridgeOrder.status = 'placed';
      bridgeOrder.updatedAt = Date.now();
      this.bridgeOrders.set(bridgeId, bridgeOrder);
      this.emit('bridge:placed', bridgeOrder);
    } catch (err) {
      bridgeOrder.status = 'error';
      bridgeOrder.error = err instanceof Error ? err.message : String(err);
      bridgeOrder.updatedAt = Date.now();
      this.bridgeOrders.set(bridgeId, bridgeOrder);
      this.emit('bridge:error', { bridgeId, error: bridgeOrder.error, timestamp: Date.now() });
    }
  }

  private async checkAndRefreshOrders(): Promise<void> {
    for (const [bridgeId, bridgeOrder] of this.bridgeOrders) {
      if (bridgeOrder.status !== 'placed' || !bridgeOrder.dydxOrder) continue;
      try {
        const currentOrder = await this.cosmosClient.getOrder(bridgeOrder.dydxOrder.orderId);
        if (!currentOrder) {
          bridgeOrder.status = 'cancelled';
          bridgeOrder.updatedAt = Date.now();
          this.bridgeOrders.set(bridgeId, bridgeOrder);
          this.emit('bridge:cancelled', bridgeOrder);
          continue;
        }
        if (currentOrder.status === 'FILLED') {
          bridgeOrder.status = 'filled';
          bridgeOrder.dydxOrder = currentOrder;
          bridgeOrder.updatedAt = Date.now();
          this.bridgeOrders.set(bridgeId, bridgeOrder);
          this.emit('bridge:filled', bridgeOrder);
          continue;
        }
        if (currentOrder.status === 'CANCELED' || currentOrder.status === 'EXPIRED') {
          bridgeOrder.status = 'cancelled';
          bridgeOrder.dydxOrder = currentOrder;
          bridgeOrder.updatedAt = Date.now();
          this.bridgeOrders.set(bridgeId, bridgeOrder);
          this.emit('bridge:cancelled', bridgeOrder);
        }
      } catch (err) {
        if (!(err instanceof DeluthiumError)) throw err;
      }
    }
    const pruneThreshold = Date.now() - 5 * 60_000;
    for (const [bridgeId, order] of this.bridgeOrders) {
      if (
        (order.status === 'filled' || order.status === 'cancelled' || order.status === 'error') &&
        order.updatedAt < pruneThreshold
      ) {
        this.bridgeOrders.delete(bridgeId);
      }
    }
  }

  private async cancelBridgeOrder(bridgeId: string): Promise<void> {
    const bridgeOrder = this.bridgeOrders.get(bridgeId);
    if (!bridgeOrder || !bridgeOrder.dydxOrder) return;
    try {
      await this.cosmosClient.cancelOrder(
        bridgeOrder.dydxOrder.orderId, bridgeOrder.ticker, bridgeOrder.dydxOrder.clientId,
      );
    } catch { /* best-effort */ }
    bridgeOrder.status = 'cancelled';
    bridgeOrder.updatedAt = Date.now();
    this.bridgeOrders.set(bridgeId, bridgeOrder);
    this.emit('bridge:cancelled', bridgeOrder);
  }

  private async cancelAllBridgeOrders(): Promise<void> {
    const active = Array.from(this.bridgeOrders.entries()).filter(([, o]) => o.status === 'placed');
    for (const [bridgeId] of active) {
      await this.cancelBridgeOrder(bridgeId);
    }
  }

  private calculateDeviationBps(priceA: string, priceB: string): number {
    const a = parseFloat(priceA);
    const b = parseFloat(priceB);
    if (a === 0) return Infinity;
    return Math.abs((b - a) / a) * 10_000;
  }

  private generateBridgeId(): string {
    this.nonceCounter++;
    const nonce = generateNonce();
    return BRIDGE_ID_PREFIX + Date.now() + '-' + nonce + '-' + this.nonceCounter;
  }

  private emit(event: DydxAdapterEvent, data: unknown): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try { handler(data); } catch { /* ignore */ }
      }
    }
  }
}
