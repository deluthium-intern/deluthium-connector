/**
 * @deluthium/dydx-adapter
 *
 * Deluthium adapter for dYdX v4 (Cosmos-based perpetuals).
 * Bridges Deluthium RFQ liquidity onto the dYdX order book, provides
 * real-time market data, and detects cross-venue arbitrage opportunities.
 *
 * @example
 * ```typescript
 * import { DydxAdapter } from '@deluthium/dydx-adapter';
 *
 * const adapter = new DydxAdapter({
 *   deluthium: { auth: 'jwt-token', chainId: 56 },
 *   signer: myEvmSigner,
 *   network: 'mainnet',
 * });
 *
 * await adapter.initialize();
 * adapter.on('orderbook:update', (book) => console.log(book));
 * adapter.subscribeMarket('BTC-USD');
 * ```
 *
 * @packageDocumentation
 */

import { DeluthiumRestClient } from '@deluthium/sdk';
import { ValidationError } from '@deluthium/sdk';
import type {
  DydxAdapterConfig,
  DydxMarket,
  OrderBook,
  DydxOrderParams,
  DydxOrder,
  DydxSubaccount,
  DydxPosition,
  BridgeOrder,
  ArbitrageOpportunity,
  DydxAdapterEvent,
  DydxEventHandler,
} from './types.js';
import { CosmosClient } from './cosmos-client.js';
import { MarketDataFeed } from './market-data.js';
import { OrderBridge } from './order-bridge.js';
import type { TokenTickerMapping } from './order-bridge.js';
import { ArbitrageDetector } from './arbitrage.js';
import type { ArbPairConfig } from './arbitrage.js';

// --- DydxAdapter ---

/**
 * Main adapter class that composes all dYdX integration components.
 *
 * Provides a unified interface for:
 * - Market data (order books, trades, market info)
 * - Account management (positions, equity, orders)
 * - Order bridge (Deluthium quotes to dYdX limit orders)
 * - Arbitrage detection (cross-venue price monitoring)
 *
 * @example
 * ```typescript
 * const adapter = new DydxAdapter({
 *   deluthium: { auth: 'jwt', chainId: 56 },
 *   signer: mySigner,
 *   network: 'mainnet',
 * });
 *
 * await adapter.initialize();
 * const markets = await adapter.getMarkets();
 * adapter.subscribeMarket('ETH-USD');
 * ```
 */
export class DydxAdapter {
  /** Low-level Cosmos chain client */
  readonly cosmos: CosmosClient;

  /** Real-time market data feed */
  readonly marketData: MarketDataFeed;

  /** Deluthium-to-dYdX order bridge */
  readonly orderBridge: OrderBridge;

  /** Cross-venue arbitrage detector */
  readonly arbitrage: ArbitrageDetector;

  /** Deluthium REST client */
  private readonly deluthiumClient: DeluthiumRestClient;

  /** Adapter configuration */
  readonly adapterConfig: DydxAdapterConfig;

  /** Event listeners (forwarded from sub-components) */
  private readonly listeners = new Map<string, Set<DydxEventHandler<unknown>>>();

  /** Initialization state */
  private initialized = false;

  constructor(config: DydxAdapterConfig) {
    this.adapterConfig = config;

    // Create Deluthium REST client
    this.deluthiumClient = new DeluthiumRestClient(config.deluthium);

    // Create sub-components
    this.cosmos = new CosmosClient(config);
    this.marketData = new MarketDataFeed(this.cosmos);
    this.orderBridge = new OrderBridge(config, this.cosmos, this.marketData, this.deluthiumClient);
    this.arbitrage = new ArbitrageDetector(this.marketData, this.deluthiumClient);

    // Forward events from sub-components
    this.forwardEvents(this.marketData);
    this.forwardEvents(this.orderBridge);
    this.forwardEvents(this.arbitrage);
  }

  // --- Initialization ---

  /**
   * Initialize the adapter. Verifies connectivity with the dYdX indexer.
   *
   * @param dydxAddress - Optional dYdX address (Bech32). Required for
   *                      account operations if not set later.
   */
  async initialize(dydxAddress?: string): Promise<void> {
    if (this.initialized) return;

    await this.cosmos.initialize();

    if (dydxAddress) {
      this.cosmos.setAddress(dydxAddress);
    }

    this.initialized = true;
  }

  /**
   * Set the dYdX address for account operations.
   *
   * @param address - The dYdX (Bech32) address
   */
  setDydxAddress(address: string): void {
    this.cosmos.setAddress(address);
  }

  /** Whether the adapter has been initialized. */
  get isInitialized(): boolean {
    return this.initialized;
  }

  // --- Market Data ---

  /**
   * Connect to the dYdX WebSocket for real-time data.
   */
  async connectMarketData(): Promise<void> {
    this.requireInit();
    await this.marketData.connect();
  }

  /**
   * Disconnect from the dYdX WebSocket.
   */
  async disconnectMarketData(): Promise<void> {
    await this.marketData.disconnect();
  }

  /**
   * Subscribe to order book and trade data for a market.
   *
   * @param ticker - Market ticker (e.g. "BTC-USD")
   */
  subscribeMarket(ticker: string): void {
    this.marketData.subscribe(ticker);
  }

  /**
   * Unsubscribe from a market.
   *
   * @param ticker - Market ticker
   */
  unsubscribeMarket(ticker: string): void {
    this.marketData.unsubscribe(ticker);
  }

  /**
   * Get all perpetual markets.
   */
  async getMarkets(): Promise<DydxMarket[]> {
    this.requireInit();
    return this.cosmos.getMarkets();
  }

  /**
   * Get a single market by ticker.
   */
  async getMarket(ticker: string): Promise<DydxMarket | null> {
    this.requireInit();
    return this.cosmos.getMarket(ticker);
  }

  /**
   * Get the current order book for a ticker.
   */
  async getOrderBook(ticker: string): Promise<OrderBook> {
    return this.marketData.getOrderBook(ticker);
  }

  /**
   * Get the mid-price for a ticker.
   */
  getMidPrice(ticker: string): string | null {
    return this.marketData.getMidPrice(ticker);
  }

  /**
   * Get the bid-ask spread in basis points.
   */
  getSpreadBps(ticker: string): number | null {
    return this.marketData.getSpreadBps(ticker);
  }

  // --- Account ---

  /**
   * Get subaccount information (equity, collateral, positions).
   */
  async getSubaccount(): Promise<DydxSubaccount> {
    this.requireInit();
    return this.cosmos.getSubaccount();
  }

  /**
   * Get all open positions.
   */
  async getPositions(): Promise<DydxPosition[]> {
    this.requireInit();
    return this.cosmos.getPositions();
  }

  // --- Orders ---

  /**
   * Place an order on dYdX.
   *
   * @param params - Order parameters
   * @returns The placed order
   */
  async placeOrder(params: DydxOrderParams): Promise<DydxOrder> {
    this.requireInit();
    return this.cosmos.placeOrder(params);
  }

  /**
   * Cancel an order.
   *
   * @param orderId - dYdX order ID
   * @param ticker - Market ticker
   * @param clientId - Client order ID
   */
  async cancelOrder(orderId: string, ticker: string, clientId: number): Promise<boolean> {
    this.requireInit();
    return this.cosmos.cancelOrder(orderId, ticker, clientId);
  }

  /**
   * Cancel all open orders (optionally filtered by ticker).
   */
  async cancelAllOrders(ticker?: string): Promise<number> {
    this.requireInit();
    return this.cosmos.cancelAllOrders(ticker);
  }

  /**
   * Get open orders.
   */
  async getOrders(ticker?: string): Promise<DydxOrder[]> {
    this.requireInit();
    return this.cosmos.getOrders(ticker);
  }

  // --- Order Bridge ---

  /**
   * Add a token-to-ticker mapping for the order bridge.
   */
  addBridgeMapping(mapping: TokenTickerMapping): void {
    this.orderBridge.addMapping(mapping);
  }

  /**
   * Start the order bridge.
   */
  async startBridge(): Promise<void> {
    this.requireInit();
    await this.orderBridge.start();
  }

  /**
   * Stop the order bridge.
   */
  async stopBridge(): Promise<void> {
    await this.orderBridge.stop();
  }

  /**
   * Get all active bridge orders.
   */
  getBridgeOrders(): BridgeOrder[] {
    return this.orderBridge.getBridgeOrders();
  }

  // --- Arbitrage ---

  /**
   * Add an arbitrage pair to monitor.
   */
  addArbitragePair(pair: ArbPairConfig): void {
    this.arbitrage.addPair(pair);
  }

  /**
   * Start the arbitrage scanner.
   */
  async startArbitrage(): Promise<void> {
    this.requireInit();
    await this.arbitrage.start();
  }

  /**
   * Stop the arbitrage scanner.
   */
  async stopArbitrage(): Promise<void> {
    await this.arbitrage.stop();
  }

  /**
   * Get recent arbitrage opportunities.
   */
  getArbitrageOpportunities(): ArbitrageOpportunity[] {
    return this.arbitrage.getRecentOpportunities();
  }

  // --- Events ---

  /**
   * Register an event listener.
   *
   * @param event - One of the {@link DydxAdapterEvent} values
   * @param handler - Callback function
   */
  on(event: DydxAdapterEvent, handler: DydxEventHandler<unknown>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  /**
   * Remove an event listener.
   */
  off(event: DydxAdapterEvent, handler: DydxEventHandler<unknown>): void {
    this.listeners.get(event)?.delete(handler);
  }

  // --- Shutdown ---

  /**
   * Gracefully shut down the adapter and all sub-components.
   */
  async shutdown(): Promise<void> {
    await this.orderBridge.stop();
    await this.arbitrage.stop();
    await this.marketData.disconnect();
    this.initialized = false;
  }

  // --- Internal ---

  private requireInit(): void {
    if (!this.initialized) {
      throw new ValidationError(
        'DydxAdapter not initialized. Call initialize() first.',
        'initialized',
      );
    }
  }

  /**
   * Forward events from a sub-component to this adapter's listeners.
   */
  private forwardEvents(source: { on: (event: DydxAdapterEvent, handler: DydxEventHandler<unknown>) => void }): void {
    const events: DydxAdapterEvent[] = [
      'orderbook:update', 'bridge:placed', 'bridge:filled',
      'bridge:cancelled', 'bridge:error', 'arbitrage:detected',
      'arbitrage:executed', 'market:update', 'connected', 'disconnected',
    ];

    for (const event of events) {
      source.on(event, (data: unknown) => {
        const handlers = this.listeners.get(event);
        if (handlers) {
          for (const handler of handlers) {
            try { handler(data); } catch { /* ignore */ }
          }
        }
      });
    }
  }
}

// --- Re-exports ---

export { CosmosClient } from './cosmos-client.js';
export { MarketDataFeed } from './market-data.js';
export { OrderBridge } from './order-bridge.js';
export type { TokenTickerMapping } from './order-bridge.js';
export { ArbitrageDetector } from './arbitrage.js';
export type { ArbPairConfig } from './arbitrage.js';

// Re-export all types
export type {
  DydxAdapterConfig,
  DydxNetwork,
  OrderSide,
  OrderType,
  TimeInForce,
  OrderStatus,
  DydxMarket,
  OrderBookLevel,
  OrderBook,
  DydxOrderParams,
  DydxOrder,
  OrderBridgeStrategy,
  BridgeOrder,
  ArbitrageOpportunity,
  ArbitrageConfig,
  DydxSubaccount,
  DydxPosition,
  DydxAdapterEvent,
  DydxEventHandler,
} from './types.js';

export { DYDX_ENDPOINTS } from './types.js';

// Re-export commonly needed SDK types
export type {
  DeluthiumClientConfig,
  ISigner,
  IndicativeQuoteRequest,
  IndicativeQuoteResponse,
  FirmQuoteRequest,
  FirmQuoteResponse,
} from '@deluthium/sdk';
