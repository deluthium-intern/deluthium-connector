/**
 * @deluthium/dydx-adapter - Cosmos Client
 *
 * Wraps dYdX v4 chain interactions via the dYdX Indexer REST API.
 * Provides account management, order placement/cancellation, and
 * position queries without requiring `@dydxprotocol/v4-client-js`.
 *
 * All chain data flows through the Indexer API (REST), keeping
 * the dependency footprint minimal.
 *
 * @packageDocumentation
 */

import { retry, sleep } from '@deluthium/sdk';
import { APIError, TimeoutError, ValidationError } from '@deluthium/sdk';
import type {
  DydxAdapterConfig,
  DydxNetwork,
  DydxMarket,
  DydxOrderParams,
  DydxOrder,
  DydxSubaccount,
  DydxPosition,
  OrderSide,
  OrderStatus,
} from './types.js';
import { DYDX_ENDPOINTS } from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 3;
const USER_AGENT = '@deluthium/dydx-adapter';

// ─── Internal response shapes from the dYdX Indexer ──────────────────────────

/** Raw market from dYdX Indexer /v4/perpetualMarkets */
interface RawIndexerMarket {
  ticker: string;
  status: string;
  baseAsset: string;
  quoteAsset?: string;
  atomicResolution: number;
  quantumConversionExponent: number;
  stepBaseQuantums: number;
  subticksPerTick: number;
  oraclePrice: string;
  priceChange24H?: string;
  volume24H?: string;
  openInterest?: string;
  nextFundingRate?: string;
  initialMarginFraction: string;
  maintenanceMarginFraction: string;
}

/** Raw order from dYdX Indexer */
interface RawIndexerOrder {
  id: string;
  clientId: string;
  ticker: string;
  side: string;
  type: string;
  size: string;
  totalFilled: string;
  remainingSize: string;
  price: string;
  status: string;
  timeInForce: string;
  goodTilBlock?: number;
  goodTilBlockTime?: string;
  postOnly: boolean;
  reduceOnly: boolean;
  createdAtHeight?: string;
  createdAt?: string;
}

/** Raw subaccount from dYdX Indexer */
interface RawIndexerSubaccount {
  subaccountNumber: number;
  equity: string;
  freeCollateral: string;
  openPerpetualPositions: Record<string, RawIndexerPosition>;
  marginEnabled?: boolean;
}

/** Raw position from dYdX Indexer */
interface RawIndexerPosition {
  market: string;
  side: string;
  size: string;
  entryPrice: string;
  unrealizedPnl: string;
  realizedPnl: string;
}

// ─── CosmosClient ─────────────────────────────────────────────────────────────

/**
 * REST-based client for dYdX v4 chain interactions.
 *
 * Uses the dYdX Indexer API for reads (markets, orders, accounts) and
 * the Validator REST API for writes (order placement/cancellation).
 *
 * @example
 * ```typescript
 * const client = new CosmosClient({
 *   network: 'mainnet',
 *   mnemonic: 'your mnemonic ...',
 * });
 *
 * await client.initialize();
 * const markets = await client.getMarkets();
 * ```
 */
export class CosmosClient {
  private readonly network: DydxNetwork;
  private readonly indexerBaseUrl: string;
  private readonly validatorBaseUrl: string;
  private readonly wsEndpoint: string;
  private readonly chainId: string;
  private readonly subaccountNumber: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  /** Resolved dYdX address (from mnemonic or manual config) */
  private address: string | null = null;

  /** Whether the client has been initialized */
  private initialized = false;

  constructor(config: DydxAdapterConfig) {
    this.network = config.network;
    const endpoints = DYDX_ENDPOINTS[this.network];

    this.indexerBaseUrl = (config.restEndpoint ?? endpoints.indexerRest).replace(/\/$/, '');
    this.validatorBaseUrl = endpoints.rest.replace(/\/$/, '');
    this.wsEndpoint = config.wsEndpoint ?? endpoints.indexerWs;
    this.chainId = endpoints.chainId;
    this.subaccountNumber = config.subaccountNumber ?? 0;
    this.timeoutMs = DEFAULT_TIMEOUT_MS;
    this.maxRetries = DEFAULT_MAX_RETRIES;
  }

  // ─── Initialization ──────────────────────────────────────────────────

  /**
   * Initialize the client. Derives the dYdX address from the configured
   * mnemonic and verifies connectivity with the indexer.
   *
   * For now, address must be set manually via {@link setAddress} since
   * full Cosmos key derivation requires heavy dependencies.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Verify indexer connectivity with a lightweight request
    await this.indexerGet<unknown>('/v4/time');
    this.initialized = true;
  }

  /**
   * Set the dYdX address manually.
   * Required when mnemonic-based derivation is not available.
   *
   * @param address - The dYdX (Bech32) address, e.g. "dydx1abc..."
   */
  setAddress(address: string): void {
    if (!address.startsWith('dydx1')) {
      throw new ValidationError(
        `Invalid dYdX address: expected "dydx1..." prefix, got "${address.slice(0, 10)}..."`,
        'address',
      );
    }
    this.address = address;
  }

  /** Get the resolved dYdX address. */
  getAddress(): string | null {
    return this.address;
  }

  /** Get the WebSocket endpoint for market data connections. */
  getWsEndpoint(): string {
    return this.wsEndpoint;
  }

  /** Get the Cosmos chain ID (e.g. "dydx-mainnet-1"). */
  getChainId(): string {
    return this.chainId;
  }

  /** Get the network identifier. */
  getNetwork(): DydxNetwork {
    return this.network;
  }

  // ─── Markets ──────────────────────────────────────────────────────────

  /**
   * Fetch all perpetual markets from the dYdX indexer.
   *
   * @returns Array of {@link DydxMarket} objects
   */
  async getMarkets(): Promise<DydxMarket[]> {
    const resp = await this.indexerGet<{ markets: Record<string, RawIndexerMarket> }>(
      '/v4/perpetualMarkets',
    );

    return Object.values(resp.markets).map((m) => this.mapMarket(m));
  }

  /**
   * Fetch a single perpetual market by ticker.
   *
   * @param ticker - Market ticker (e.g. "BTC-USD")
   * @returns The {@link DydxMarket} or null if not found
   */
  async getMarket(ticker: string): Promise<DydxMarket | null> {
    try {
      const resp = await this.indexerGet<{ markets: Record<string, RawIndexerMarket> }>(
        '/v4/perpetualMarkets',
        { ticker },
      );
      const raw = resp.markets[ticker];
      return raw ? this.mapMarket(raw) : null;
    } catch {
      return null;
    }
  }

  // ─── Account & Positions ──────────────────────────────────────────────

  /**
   * Fetch the current subaccount information including equity,
   * collateral, and open positions.
   *
   * @returns The {@link DydxSubaccount} data
   * @throws ValidationError if address is not set
   */
  async getSubaccount(): Promise<DydxSubaccount> {
    this.requireAddress();

    const raw = await this.indexerGet<{ subaccount: RawIndexerSubaccount }>(
      `/v4/addresses/${this.address!}/subaccountNumber/${this.subaccountNumber}`,
    );

    return this.mapSubaccount(raw.subaccount);
  }

  /**
   * Fetch all open positions for the current subaccount.
   *
   * @returns Array of {@link DydxPosition} objects
   */
  async getPositions(): Promise<DydxPosition[]> {
    const subaccount = await this.getSubaccount();
    return subaccount.positions;
  }

  // ─── Orders ───────────────────────────────────────────────────────────

  /**
   * Fetch active orders for the current subaccount.
   *
   * @param ticker - Optional ticker filter
   * @param status - Optional status filter
   * @returns Array of {@link DydxOrder} objects
   */
  async getOrders(ticker?: string, status?: OrderStatus): Promise<DydxOrder[]> {
    this.requireAddress();

    const params: Record<string, string> = {};
    if (ticker) params.ticker = ticker;
    if (status) params.status = status;

    const raw = await this.indexerGet<RawIndexerOrder[]>(
      `/v4/orders?address=${this.address!}&subaccountNumber=${this.subaccountNumber}`,
      params,
    );

    return raw.map((o) => this.mapOrder(o));
  }

  /**
   * Fetch a specific order by ID.
   *
   * @param orderId - The dYdX order ID
   * @returns The {@link DydxOrder} or null if not found
   */
  async getOrder(orderId: string): Promise<DydxOrder | null> {
    try {
      const raw = await this.indexerGet<RawIndexerOrder>(`/v4/orders/${orderId}`);
      return this.mapOrder(raw);
    } catch {
      return null;
    }
  }

  /**
   * Place a new order via the Validator REST API.
   *
   * This is a simplified order placement using the Validator's broadcast
   * endpoint. For production use with signing, a full Cosmos SDK client
   * is recommended.
   *
   * @param params - Order parameters
   * @returns The placed order (from subsequent indexer query)
   * @throws ValidationError if parameters are invalid
   */
  async placeOrder(params: DydxOrderParams): Promise<DydxOrder> {
    this.requireAddress();
    this.validateOrderParams(params);

    // Generate a client ID if not provided
    const clientId = params.clientId ?? Math.floor(Math.random() * 2_147_483_647);

    // Place the order via Validator REST broadcast
    const orderPayload = {
      address: this.address,
      subaccountNumber: this.subaccountNumber,
      clientId,
      ticker: params.ticker,
      side: params.side,
      type: params.type,
      size: params.size,
      price: params.price,
      timeInForce: params.timeInForce,
      goodTilTimeSec: params.goodTilTimeSec,
      postOnly: params.postOnly ?? false,
      reduceOnly: params.reduceOnly ?? false,
    };

    await this.validatorPost('/dydxprotocol/clob/place_order', orderPayload);

    // Wait briefly for indexer to pick up the order, then retrieve it
    await sleep(500);

    // Attempt to find the placed order by clientId
    const orders = await this.getOrders(params.ticker);
    const placed = orders.find((o) => o.clientId === clientId);

    if (placed) return placed;

    // If not found yet, return a synthetic order object
    return {
      orderId: `pending-${clientId}`,
      clientId,
      ticker: params.ticker,
      side: params.side,
      type: params.type,
      size: params.size,
      filledSize: '0',
      remainingSize: params.size,
      price: params.price ?? '0',
      status: 'PENDING',
      timeInForce: params.timeInForce,
      goodTilTimeSec: params.goodTilTimeSec,
      postOnly: params.postOnly ?? false,
      reduceOnly: params.reduceOnly ?? false,
      createdAt: new Date().toISOString(),
    } as DydxOrder & { goodTilTimeSec?: number };
  }

  /**
   * Cancel an existing order.
   *
   * @param orderId - The dYdX order ID to cancel
   * @param ticker - Market ticker for the order
   * @param clientId - Client ID of the order
   * @returns True if the cancellation was broadcast successfully
   */
  async cancelOrder(orderId: string, ticker: string, clientId: number): Promise<boolean> {
    this.requireAddress();

    try {
      await this.validatorPost('/dydxprotocol/clob/cancel_order', {
        address: this.address,
        subaccountNumber: this.subaccountNumber,
        orderId,
        ticker,
        clientId,
      });
      return true;
    } catch (err) {
      if (err instanceof APIError && err.httpStatus === 404) {
        // Order already cancelled or filled
        return false;
      }
      throw err;
    }
  }

  /**
   * Cancel all open orders for a specific ticker (or all tickers).
   *
   * @param ticker - Optional: cancel orders only for this market
   * @returns Number of orders cancelled
   */
  async cancelAllOrders(ticker?: string): Promise<number> {
    const orders = await this.getOrders(ticker, 'OPEN');
    let cancelled = 0;

    for (const order of orders) {
      const success = await this.cancelOrder(order.orderId, order.ticker, order.clientId);
      if (success) cancelled++;
    }

    return cancelled;
  }

  // ─── Fills & History ──────────────────────────────────────────────────

  /**
   * Fetch recent fills for the current subaccount.
   *
   * @param ticker - Optional ticker filter
   * @param limit - Maximum number of fills to return (default: 100)
   * @returns Array of fill objects
   */
  async getFills(ticker?: string, limit = 100): Promise<unknown[]> {
    this.requireAddress();

    const params: Record<string, string> = {
      limit: String(limit),
    };
    if (ticker) params.ticker = ticker;

    const resp = await this.indexerGet<{ fills: unknown[] }>(
      `/v4/fills?address=${this.address!}&subaccountNumber=${this.subaccountNumber}`,
      params,
    );

    return resp.fills ?? [];
  }

  // ─── HTTP Helpers ─────────────────────────────────────────────────────

  /**
   * Perform a GET request against the dYdX Indexer API with retry.
   *
   * @param path - API path (e.g. "/v4/perpetualMarkets")
   * @param params - Optional query parameters
   * @returns Parsed JSON response
   */
  private async indexerGet<T>(
    path: string,
    params?: Record<string, string>,
  ): Promise<T> {
    return retry(
      () => this.httpGet<T>(this.indexerBaseUrl, path, params),
      this.maxRetries,
      500,
    );
  }

  /**
   * Perform a POST request against the Validator REST API with retry.
   *
   * @param path - API path
   * @param body - Request body
   * @returns Parsed JSON response
   */
  private async validatorPost<T>(path: string, body: unknown): Promise<T> {
    return retry(
      () => this.httpPost<T>(this.validatorBaseUrl, path, body),
      this.maxRetries,
      500,
    );
  }

  /**
   * Low-level HTTP GET with timeout.
   */
  private async httpGet<T>(
    baseUrl: string,
    path: string,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(path, baseUrl);
    if (params) {
      for (const [key, val] of Object.entries(params)) {
        url.searchParams.set(key, val);
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new APIError(
          `dYdX Indexer ${path}: HTTP ${response.status} - ${text}`,
          response.status,
          path,
          undefined,
          text,
        );
      }

      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new TimeoutError(
          `dYdX Indexer request to ${path} timed out after ${this.timeoutMs}ms`,
          this.timeoutMs,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Low-level HTTP POST with timeout.
   */
  private async httpPost<T>(
    baseUrl: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    const url = new URL(path, baseUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new APIError(
          `dYdX Validator ${path}: HTTP ${response.status} - ${text}`,
          response.status,
          path,
          undefined,
          text,
        );
      }

      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new TimeoutError(
          `dYdX Validator request to ${path} timed out after ${this.timeoutMs}ms`,
          this.timeoutMs,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ─── Mapping Helpers ──────────────────────────────────────────────────

  /** Map a raw Indexer market to our DydxMarket type. */
  private mapMarket(raw: RawIndexerMarket): DydxMarket {
    return {
      ticker: raw.ticker,
      status: raw.status as DydxMarket['status'],
      baseAsset: raw.baseAsset,
      quoteAsset: raw.quoteAsset ?? 'USD',
      atomicResolution: raw.atomicResolution,
      quantumConversionExponent: raw.quantumConversionExponent,
      stepBaseQuantums: raw.stepBaseQuantums,
      subticksPerTick: raw.subticksPerTick,
      oraclePrice: raw.oraclePrice,
      priceChange24h: raw.priceChange24H,
      volume24h: raw.volume24H,
      openInterest: raw.openInterest,
      nextFundingRate: raw.nextFundingRate,
      initialMarginFraction: raw.initialMarginFraction,
      maintenanceMarginFraction: raw.maintenanceMarginFraction,
    };
  }

  /** Map a raw Indexer order to our DydxOrder type. */
  private mapOrder(raw: RawIndexerOrder): DydxOrder {
    return {
      orderId: raw.id,
      clientId: parseInt(raw.clientId, 10),
      ticker: raw.ticker,
      side: raw.side as OrderSide,
      type: raw.type as DydxOrder['type'],
      size: raw.size,
      filledSize: raw.totalFilled,
      remainingSize: raw.remainingSize,
      price: raw.price,
      status: raw.status as OrderStatus,
      timeInForce: raw.timeInForce as DydxOrder['timeInForce'],
      goodTilBlock: raw.goodTilBlock,
      goodTilTime: raw.goodTilBlockTime,
      postOnly: raw.postOnly,
      reduceOnly: raw.reduceOnly,
      createdAt: raw.createdAt ?? new Date().toISOString(),
    };
  }

  /** Map a raw Indexer subaccount to our DydxSubaccount type. */
  private mapSubaccount(raw: RawIndexerSubaccount): DydxSubaccount {
    const positions = Object.entries(raw.openPerpetualPositions ?? {}).map(
      ([, pos]) => this.mapPosition(pos),
    );

    const totalPositionsValue = positions.reduce((sum, p) => {
      return sum + Math.abs(parseFloat(p.size) * parseFloat(p.entryPrice));
    }, 0);

    return {
      subaccountNumber: raw.subaccountNumber,
      equity: raw.equity,
      freeCollateral: raw.freeCollateral,
      openPositionsValue: totalPositionsValue.toFixed(2),
      marginUsage:
        parseFloat(raw.equity) > 0
          ? (
              (parseFloat(raw.equity) - parseFloat(raw.freeCollateral)) /
              parseFloat(raw.equity)
            ).toFixed(6)
          : '0',
      positions,
    };
  }

  /** Map a raw Indexer position to our DydxPosition type. */
  private mapPosition(raw: RawIndexerPosition): DydxPosition {
    return {
      ticker: raw.market,
      side: raw.side === 'SHORT' ? 'SHORT' : 'LONG',
      size: raw.size,
      entryPrice: raw.entryPrice,
      unrealizedPnl: raw.unrealizedPnl,
      realizedPnl: raw.realizedPnl,
    };
  }

  // ─── Validation ───────────────────────────────────────────────────────

  /** Ensure the address has been set before account-specific queries. */
  private requireAddress(): void {
    if (!this.address) {
      throw new ValidationError(
        'dYdX address not set. Call setAddress() with your dYdX address before performing account operations.',
        'address',
      );
    }
  }

  /** Validate order placement parameters. */
  private validateOrderParams(params: DydxOrderParams): void {
    if (!params.ticker) {
      throw new ValidationError('Order ticker is required', 'ticker');
    }
    if (!params.side) {
      throw new ValidationError('Order side is required', 'side');
    }
    if (!params.size || parseFloat(params.size) <= 0) {
      throw new ValidationError('Order size must be positive', 'size');
    }
    if (params.type === 'LIMIT' && (!params.price || parseFloat(params.price) <= 0)) {
      throw new ValidationError('Limit order requires a positive price', 'price');
    }
  }
}
