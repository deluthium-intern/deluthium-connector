/**
 * @deluthium/dydx-adapter - Market Data Feed
 *
 * Provides real-time and snapshot market data from the dYdX v4 Indexer.
 * Connects via WebSocket for live order book and trade updates, with
 * REST fallback for snapshots.
 *
 * @packageDocumentation
 */

import WebSocket from 'ws';
import { sleep, retry } from '@deluthium/sdk';
import { TimeoutError, WebSocketError, APIError } from '@deluthium/sdk';
import type {
  DydxMarket,
  OrderBook,
  OrderBookLevel,
  DydxAdapterEvent,
  DydxEventHandler,
} from './types.js';
import type { CosmosClient } from './cosmos-client.js';

const WS_CONNECT_TIMEOUT_MS = 10_000;
const WS_HEARTBEAT_INTERVAL_MS = 30_000;
const WS_RECONNECT_BASE_DELAY_MS = 1_000;
const WS_MAX_RECONNECT_ATTEMPTS = 15;
const SNAPSHOT_STALE_MS = 60_000;

interface WSOrderBookMessage {
  type: 'subscribed' | 'channel_data' | 'channel_batch_data';
  channel: string;
  id: string;
  contents: WSOrderBookContents | WSOrderBookContents[];
}

interface WSOrderBookContents {
  bids?: WSBookLevel[];
  asks?: WSBookLevel[];
  trades?: WSTradeData[];
}

type WSBookLevel = [string, string];

interface WSTradeData {
  id: string;
  side: string;
  size: string;
  price: string;
  createdAt: string;
}

interface WSMarketsMessage {
  type: 'subscribed' | 'channel_data';
  channel: string;
  contents: {
    markets?: Record<string, Partial<RawMarketUpdate>>;
    trading?: Record<string, Partial<RawMarketUpdate>>;
  };
}

interface RawMarketUpdate {
  oraclePrice: string;
  priceChange24H: string;
  volume24H: string;
  nextFundingRate: string;
  openInterest: string;
}

/**
 * Real-time and snapshot market data feed for dYdX v4 perpetuals.
 *
 * Manages WebSocket connections for live order book and trade data,
 * maintains local order book snapshots, and emits events for downstream
 * consumers (order bridge, arbitrage detector, etc.).
 *
 * @example
 * ```typescript
 * const feed = new MarketDataFeed(cosmosClient);
 * feed.on('orderbook:update', (book) => {
 *   console.log('Best bid:', book.bids[0]?.price);
 * });
 * await feed.connect();
 * feed.subscribe('BTC-USD');
 * ```
 */
export class MarketDataFeed {
  private readonly cosmosClient: CosmosClient;
  private readonly wsEndpoint: string;
  private ws: WebSocket | null = null;
  private readonly orderBooks = new Map<string, OrderBook>();
  private readonly marketsCache = new Map<string, DydxMarket>();
  private readonly subscriptions = new Set<string>();
  private readonly listeners = new Map<string, Set<DydxEventHandler<unknown>>>();
  private connected = false;
  private intentionallyClosed = false;
  private reconnectAttempts = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private marketsCacheTime = 0;

  constructor(cosmosClient: CosmosClient) {
    this.cosmosClient = cosmosClient;
    this.wsEndpoint = cosmosClient.getWsEndpoint();
  }

  /**
   * Establish WebSocket connection to the dYdX Indexer.
   * Resolves when the connection is open and ready.
   */
  async connect(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) return;
    this.intentionallyClosed = false;

    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.ws?.close();
        reject(new TimeoutError(
          'dYdX WS connection timed out after ' + WS_CONNECT_TIMEOUT_MS + 'ms',
          WS_CONNECT_TIMEOUT_MS,
        ));
      }, WS_CONNECT_TIMEOUT_MS);

      this.ws = new WebSocket(this.wsEndpoint);

      this.ws.on('open', () => {
        clearTimeout(timeoutId);
        this.connected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.resubscribeAll();
        this.emit('connected', undefined);
        resolve();
      });

      this.ws.on('message', (raw: WebSocket.RawData) => {
        this.handleMessage(raw);
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        clearTimeout(timeoutId);
        this.connected = false;
        this.stopHeartbeat();
        this.emit('disconnected', { code, reason: reason.toString() });
        if (!this.intentionallyClosed) {
          void this.attemptReconnect();
        }
      });

      this.ws.on('error', (err: Error) => {
        clearTimeout(timeoutId);
        if (!this.connected) {
          reject(new WebSocketError('dYdX WS error: ' + err.message));
        }
      });
    });
  }

  /** Gracefully disconnect from the WebSocket. */
  async disconnect(): Promise<void> {
    this.intentionallyClosed = true;
    this.connected = false;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  /** Whether the WebSocket is currently connected. */
  get isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Subscribe to order book updates for a market. */
  subscribe(ticker: string): void {
    this.subscriptions.add(ticker);
    if (this.isConnected) {
      this.sendSubscription('subscribe', 'v4_orderbook', ticker);
      this.sendSubscription('subscribe', 'v4_trades', ticker);
    }
  }

  /** Unsubscribe from a market data feed. */
  unsubscribe(ticker: string): void {
    this.subscriptions.delete(ticker);
    this.orderBooks.delete(ticker);
    if (this.isConnected) {
      this.sendSubscription('unsubscribe', 'v4_orderbook', ticker);
      this.sendSubscription('unsubscribe', 'v4_trades', ticker);
    }
  }

  /** Subscribe to global market updates (oracle prices, funding rates). */
  subscribeMarkets(): void {
    if (this.isConnected) {
      this.sendRaw({ type: 'subscribe', channel: 'v4_markets' });
    }
  }

  /**
   * Get the current order book snapshot for a ticker.
   * Returns local cache if fresh, otherwise fetches from REST.
   */
  async getOrderBook(ticker: string): Promise<OrderBook> {
    const cached = this.orderBooks.get(ticker);
    if (cached && Date.now() - cached.timestamp < SNAPSHOT_STALE_MS) {
      return cached;
    }
    return this.fetchOrderBookSnapshot(ticker);
  }

  /** Get the best bid price for a ticker. */
  getBestBid(ticker: string): string | null {
    const book = this.orderBooks.get(ticker);
    return book?.bids[0]?.price ?? null;
  }

  /** Get the best ask price for a ticker. */
  getBestAsk(ticker: string): string | null {
    const book = this.orderBooks.get(ticker);
    return book?.asks[0]?.price ?? null;
  }

  /** Get the mid-price for a ticker. */
  getMidPrice(ticker: string): string | null {
    const bestBid = this.getBestBid(ticker);
    const bestAsk = this.getBestAsk(ticker);
    if (!bestBid || !bestAsk) return null;
    return ((parseFloat(bestBid) + parseFloat(bestAsk)) / 2).toString();
  }

  /** Get the bid-ask spread in basis points. */
  getSpreadBps(ticker: string): number | null {
    const bestBid = this.getBestBid(ticker);
    const bestAsk = this.getBestAsk(ticker);
    if (!bestBid || !bestAsk) return null;
    const bid = parseFloat(bestBid);
    const ask = parseFloat(bestAsk);
    const mid = (bid + ask) / 2;
    if (mid === 0) return null;
    return ((ask - bid) / mid) * 10_000;
  }

  /** Get all available markets (cached, refreshed periodically). */
  async getMarkets(): Promise<Map<string, DydxMarket>> {
    if (this.marketsCache.size === 0 || Date.now() - this.marketsCacheTime > SNAPSHOT_STALE_MS) {
      await this.refreshMarketsCache();
    }
    return new Map(this.marketsCache);
  }

  /** Get a single market by ticker (cached). */
  async getMarket(ticker: string): Promise<DydxMarket | null> {
    const markets = await this.getMarkets();
    return markets.get(ticker) ?? null;
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

  // --- Internal ---

  private handleMessage(raw: WebSocket.RawData): void {
    try {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      const channel = msg.channel as string | undefined;
      if (!channel) return;
      if (channel === 'v4_orderbook') {
        this.handleOrderBookMessage(msg as unknown as WSOrderBookMessage);
      } else if (channel === 'v4_trades') {
        this.handleTradeMessage(msg as unknown as WSOrderBookMessage);
      } else if (channel === 'v4_markets') {
        this.handleMarketsMessage(msg as unknown as WSMarketsMessage);
      }
    } catch {
      // ignore malformed messages
    }
  }

  private handleOrderBookMessage(msg: WSOrderBookMessage): void {
    const ticker = msg.id;
    if (!ticker) return;
    if (msg.type === 'subscribed') {
      const contents = Array.isArray(msg.contents) ? msg.contents[0] : msg.contents;
      if (!contents) return;
      const book: OrderBook = {
        ticker,
        bids: this.parseBookLevels(contents.bids),
        asks: this.parseBookLevels(contents.asks),
        timestamp: Date.now(),
      };
      this.orderBooks.set(ticker, book);
      this.emit('orderbook:update', book);
    } else if (msg.type === 'channel_data' || msg.type === 'channel_batch_data') {
      const contentsList = Array.isArray(msg.contents) ? msg.contents : [msg.contents];
      for (const contents of contentsList) {
        this.applyOrderBookDelta(ticker, contents);
      }
    }
  }

  private handleTradeMessage(msg: WSOrderBookMessage): void {
    const ticker = msg.id;
    if (!ticker) return;
    const contents = Array.isArray(msg.contents) ? msg.contents[0] : msg.contents;
    if (contents?.trades && contents.trades.length > 0) {
      this.emit('market:update', { ticker, trades: contents.trades, timestamp: Date.now() });
    }
  }

  private handleMarketsMessage(msg: WSMarketsMessage): void {
    if (msg.type !== 'channel_data') return;
    const updates = msg.contents.trading ?? msg.contents.markets;
    if (!updates) return;
    for (const [ticker, update] of Object.entries(updates)) {
      const existing = this.marketsCache.get(ticker);
      if (existing && update) {
        if (update.oraclePrice) existing.oraclePrice = update.oraclePrice;
        if (update.priceChange24H) existing.priceChange24h = update.priceChange24H;
        if (update.volume24H) existing.volume24h = update.volume24H;
        if (update.nextFundingRate) existing.nextFundingRate = update.nextFundingRate;
        if (update.openInterest) existing.openInterest = update.openInterest;
        this.marketsCache.set(ticker, existing);
      }
    }
  }

  private applyOrderBookDelta(ticker: string, contents: WSOrderBookContents): void {
    let book = this.orderBooks.get(ticker);
    if (!book) {
      book = { ticker, bids: [], asks: [], timestamp: Date.now() };
    }
    if (contents.bids) {
      book.bids = this.mergeLevels(book.bids, this.parseBookLevels(contents.bids));
    }
    if (contents.asks) {
      book.asks = this.mergeLevels(book.asks, this.parseBookLevels(contents.asks));
    }
    book.timestamp = Date.now();
    this.orderBooks.set(ticker, book);
    this.emit('orderbook:update', book);
  }

  private parseBookLevels(levels?: WSBookLevel[]): OrderBookLevel[] {
    if (!levels) return [];
    return levels.map(([price, size]) => ({ price, size }));
  }

  private mergeLevels(existing: OrderBookLevel[], deltas: OrderBookLevel[]): OrderBookLevel[] {
    const map = new Map<string, string>();
    for (const level of existing) map.set(level.price, level.size);
    for (const delta of deltas) {
      if (delta.size === '0' || parseFloat(delta.size) === 0) {
        map.delete(delta.price);
      } else {
        map.set(delta.price, delta.size);
      }
    }
    return Array.from(map.entries())
      .map(([price, size]) => ({ price, size }))
      .sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
  }

  private async fetchOrderBookSnapshot(ticker: string): Promise<OrderBook> {
    const endpoint = this.cosmosClient.getWsEndpoint().replace('/ws', '');
    const baseUrl = endpoint.replace('wss://', 'https://').replace('ws://', 'http://');

    const resp = await retry(
      async () => {
        const url = baseUrl + '/v4/orderbooks/perpetualMarket/' + ticker;
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) {
          throw new APIError(
            'Failed to fetch order book for ' + ticker + ': HTTP ' + response.status,
            response.status,
            url,
          );
        }
        return response.json() as Promise<{
          bids: Array<{ price: string; size: string }>;
          asks: Array<{ price: string; size: string }>;
        }>;
      },
      3,
      500,
    );

    const book: OrderBook = {
      ticker,
      bids: resp.bids.map((b) => ({ price: b.price, size: b.size })),
      asks: resp.asks.map((a) => ({ price: a.price, size: a.size })),
      timestamp: Date.now(),
    };
    this.orderBooks.set(ticker, book);
    return book;
  }

  private async refreshMarketsCache(): Promise<void> {
    try {
      const markets = await this.cosmosClient.getMarkets();
      this.marketsCache.clear();
      for (const market of markets) {
        this.marketsCache.set(market.ticker, market);
      }
      this.marketsCacheTime = Date.now();
    } catch {
      // Keep stale cache on failure
    }
  }

  private sendSubscription(action: 'subscribe' | 'unsubscribe', channel: string, id: string): void {
    this.sendRaw({ type: action, channel, id });
  }

  private sendRaw(msg: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new WebSocketError('dYdX WebSocket is not connected');
    }
    this.ws.send(JSON.stringify(msg));
  }

  private resubscribeAll(): void {
    for (const ticker of this.subscriptions) {
      this.sendSubscription('subscribe', 'v4_orderbook', ticker);
      this.sendSubscription('subscribe', 'v4_trades', ticker);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.ping();
    }, WS_HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= WS_MAX_RECONNECT_ATTEMPTS) {
      this.emit('disconnected', {
        code: -1,
        reason: 'Max reconnection attempts (' + WS_MAX_RECONNECT_ATTEMPTS + ') exceeded',
      });
      return;
    }
    this.reconnectAttempts++;
    const delay = WS_RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);
    const jitter = Math.random() * delay * 0.2;
    await sleep(delay + jitter);
    if (!this.intentionallyClosed) {
      try {
        await this.connect();
      } catch {
        // close event will trigger another attemptReconnect
      }
    }
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
