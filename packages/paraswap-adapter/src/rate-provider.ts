/**
 * @deluthium/paraswap-adapter - Rate Provider
 *
 * Periodically fetches indicative quotes from the Deluthium RFQ API and caches
 * them so that Paraswap's routing engine receives near-instant responses when
 * querying available liquidity from this pool.
 *
 * Design:
 *  1. On `start()`, the provider fetches all trading pairs from Deluthium,
 *     then begins a periodic loop that refreshes indicative quotes for each pair.
 *  2. Cached quotes are keyed by `"srcToken:destToken"` (lower-cased).
 *  3. When Paraswap requests a rate via `getRate()`, we return the cached quote
 *     (if fresh) or indicate no liquidity.
 *  4. A configurable markup is applied to quoted amounts so that the final
 *     execution (firm quote) can still be filled profitably.
 *
 * @packageDocumentation
 */

import {
  DeluthiumRestClient,
  normalizeAddress,
  resolveTokenAddress,
  retry,
  sleep,
  type TradingPair,
  type IndicativeQuoteRequest,
  type IndicativeQuoteResponse,
  type Token,
} from '@deluthium/sdk';

import type {
  ParaswapAdapterConfig,
  RateRequest,
  RateResponse,
  CachedRate,
  ParaswapAdapterEvent,
  RateUpdateEvent,
} from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default rate refresh interval: 5 seconds */
const DEFAULT_REFRESH_INTERVAL_MS = 5_000;

/** Default rate markup: 5 bps (0.05 %) */
const DEFAULT_RATE_MARKUP_BPS = 5;

/** Identifier used when reporting this pool to Paraswap */
const EXCHANGE_NAME = 'Deluthium';

/** Pool identifier prefix */
const POOL_ID_PREFIX = 'deluthium-rfq';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a canonical cache key for a token pair.
 *
 * @param srcToken - Source token address
 * @param destToken - Destination token address
 * @returns Lower-cased `"srcToken:destToken"` key
 */
function pairKey(srcToken: string, destToken: string): string {
  return `${srcToken.toLowerCase()}:${destToken.toLowerCase()}`;
}

/**
 * Apply a basis-point markup to an amount, reducing the quoted output so
 * that the firm quote can still fill at a better price.
 *
 * @param amount - Output amount in wei (string)
 * @param markupBps - Markup in basis points
 * @returns Adjusted amount (wei string)
 */
function applyMarkup(amount: string, markupBps: number): string {
  const value = BigInt(amount);
  const reduction = (value * BigInt(markupBps)) / 10_000n;
  return (value - reduction).toString();
}

// ─── RateProvider ────────────────────────────────────────────────────────────

/**
 * Provides rates to the Paraswap routing engine by periodically polling
 * Deluthium for indicative quotes and caching the results.
 *
 * @example
 * ```typescript
 * const provider = new RateProvider(config, client, emitter);
 * await provider.start();
 *
 * const rate = provider.getRate({
 *   srcToken: { address: '0xSRC', decimals: 18 },
 *   destToken: { address: '0xDST', decimals: 18 },
 *   srcAmount: '1000000000000000000',
 *   chainId: 56,
 *   side: 'SELL',
 * });
 * ```
 */
export class RateProvider {
  /** Deluthium REST client for API calls */
  private readonly client: DeluthiumRestClient;

  /** Chain ID this provider operates on */
  private readonly chainId: number;

  /** Rate refresh interval in milliseconds */
  private readonly refreshIntervalMs: number;

  /** Rate TTL in milliseconds */
  private readonly rateTtlMs: number;

  /** Markup applied to indicative quotes (basis points) */
  private readonly markupBps: number;

  /** Pool adapter contract address (included in rate responses) */
  private readonly poolAdapterAddress: string | undefined;

  /** Cached rates keyed by `srcToken:destToken` */
  private readonly rateCache: Map<string, CachedRate> = new Map();

  /** Known trading pairs from Deluthium */
  private pairs: TradingPair[] = [];

  /** Known tokens from Deluthium (indexed by lower-case address) */
  readonly tokenIndex: Map<string, Token> = new Map();

  /** Whether the rate loop is running */
  private running = false;

  /** Handle for the refresh loop (so we can break out on `stop()`) */
  private abortController: AbortController | null = null;

  /** Event emitter callback */
  private readonly emit: (event: ParaswapAdapterEvent, data: unknown) => void;

  /**
   * Create a new RateProvider.
   *
   * @param config - Adapter configuration
   * @param client - Initialised Deluthium REST client
   * @param emit - Callback to emit adapter events
   */
  constructor(
    config: ParaswapAdapterConfig,
    client: DeluthiumRestClient,
    emit: (event: ParaswapAdapterEvent, data: unknown) => void,
  ) {
    this.client = client;
    this.chainId = config.chainId ?? config.deluthium.chainId;
    this.refreshIntervalMs = config.rateRefreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    this.rateTtlMs = this.refreshIntervalMs * 2; // 2× refresh = safe staleness window
    this.markupBps = config.rateMarkupBps ?? DEFAULT_RATE_MARKUP_BPS;
    this.poolAdapterAddress = config.poolAdapterAddress;
    this.emit = emit;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  /**
   * Start the rate-refresh loop.
   *
   * Fetches pairs and tokens from Deluthium, performs an initial rate
   * refresh, then enters a periodic loop.
   *
   * @throws {DeluthiumError} If the initial pair/token fetch fails
   */
  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;
    this.abortController = new AbortController();

    // Fetch pairs and tokens with retry
    await this.refreshPairsAndTokens();

    // Initial rate fetch (best-effort — errors logged, not thrown)
    await this.refreshAllRates();

    // Enter the periodic loop
    this.runRefreshLoop();
  }

  /**
   * Stop the rate-refresh loop and clear the cache.
   */
  stop(): void {
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
    this.rateCache.clear();
  }

  /** Whether the provider is currently active. */
  get isRunning(): boolean {
    return this.running;
  }

  // ─── Rate Queries ────────────────────────────────────────────────────

  /**
   * Look up a cached rate for the given request.
   *
   * Returns `null` if no fresh rate is available (pair not supported,
   * cache expired, etc.).
   *
   * @param request - Rate request from Paraswap's routing engine
   * @returns Rate response or `null`
   */
  getRate(request: RateRequest): RateResponse | null {
    const srcAddr = normalizeAddress(request.srcToken.address).toLowerCase();
    const destAddr = normalizeAddress(request.destToken.address).toLowerCase();
    const key = pairKey(srcAddr, destAddr);

    const cached = this.rateCache.get(key);
    if (!cached) return null;

    // Check freshness
    if (Date.now() - cached.cachedAt > cached.ttlMs) {
      this.rateCache.delete(key);
      return null;
    }

    // Scale the cached rate to the requested amount
    return this.scaleRate(cached.response, request);
  }

  /**
   * Get all currently cached rates.
   *
   * @returns Array of cached rate entries (may include stale entries)
   */
  getAllCachedRates(): CachedRate[] {
    return Array.from(this.rateCache.values());
  }

  /**
   * Get the number of active (non-expired) cached rates.
   */
  get activeCacheSize(): number {
    const now = Date.now();
    let count = 0;
    for (const entry of this.rateCache.values()) {
      if (now - entry.cachedAt <= entry.ttlMs) count++;
    }
    return count;
  }

  /**
   * Return the list of known trading pairs.
   */
  getPairs(): TradingPair[] {
    return [...this.pairs];
  }

  // ─── Internal: Refresh Loop ──────────────────────────────────────────

  /**
   * Background refresh loop. Runs until `stop()` is called.
   */
  private async runRefreshLoop(): Promise<void> {
    const signal = this.abortController?.signal;

    while (this.running && !signal?.aborted) {
      await sleep(this.refreshIntervalMs);

      if (!this.running || signal?.aborted) break;

      try {
        await this.refreshAllRates();
      } catch (err) {
        // Non-fatal: log via event and continue
        this.emit('rate:error', {
          error: err instanceof Error ? err.message : String(err),
          timestamp: Date.now(),
        });
      }
    }
  }

  // ─── Internal: Pair & Token Fetch ────────────────────────────────────

  /**
   * Fetch (or re-fetch) trading pairs and tokens from Deluthium.
   */
  private async refreshPairsAndTokens(): Promise<void> {
    const [pairs, tokens] = await Promise.all([
      retry(() => this.client.getPairs(this.chainId), 3, 1_000),
      retry(() => this.client.getTokens(this.chainId), 3, 1_000),
    ]);

    this.pairs = pairs.filter((p) => p.active);
    this.tokenIndex.clear();
    for (const t of tokens) {
      this.tokenIndex.set(t.address.toLowerCase(), t);
    }
  }

  // ─── Internal: Rate Refresh ──────────────────────────────────────────

  /**
   * Refresh indicative quotes for every active pair.
   *
   * Requests are issued in parallel (bounded by `Promise.allSettled`).
   * Failures for individual pairs do not abort the entire refresh.
   */
  private async refreshAllRates(): Promise<void> {
    if (this.pairs.length === 0) return;

    const quotePromises = this.pairs.map((pair) =>
      this.fetchAndCacheRate(pair),
    );

    await Promise.allSettled(quotePromises);
  }

  /**
   * Fetch an indicative quote for a single pair and cache the result.
   *
   * @param pair - Trading pair to quote
   */
  private async fetchAndCacheRate(pair: TradingPair): Promise<void> {
    const srcToken = pair.baseToken;
    const destToken = pair.quoteToken;

    // Use a standard 1-unit quote to establish the rate
    const oneUnit = BigInt(10) ** BigInt(srcToken.decimals);

    const request: IndicativeQuoteRequest = {
      src_chain_id: this.chainId,
      dst_chain_id: this.chainId,
      token_in: resolveTokenAddress(srcToken.address, this.chainId),
      token_out: resolveTokenAddress(destToken.address, this.chainId),
      amount_in: oneUnit.toString(),
      side: 'sell',
    };

    let quote: IndicativeQuoteResponse;
    try {
      quote = await this.client.getIndicativeQuote(request);
    } catch (err) {
      // Emit per-pair error but don't rethrow (handled at caller level)
      this.emit('rate:error', {
        pair: `${srcToken.symbol}/${destToken.symbol}`,
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      });
      return;
    }

    // Apply markup to the quoted output
    const adjustedAmountOut = applyMarkup(quote.amount_out, this.markupBps);

    const poolId = `${POOL_ID_PREFIX}-${srcToken.address.toLowerCase()}-${destToken.address.toLowerCase()}`;

    const rateResponse: RateResponse = {
      srcToken: srcToken.address,
      destToken: destToken.address,
      srcAmount: quote.amount_in,
      destAmount: adjustedAmountOut,
      exchange: EXCHANGE_NAME,
      poolId,
      data: this.encodePoolData(srcToken.address, destToken.address),
      gasCost: '120000', // Estimated gas for RFQ settlement
    };

    const key = pairKey(srcToken.address, destToken.address);

    const cachedEntry: CachedRate = {
      request: {
        srcToken: { address: srcToken.address, decimals: srcToken.decimals, symbol: srcToken.symbol },
        destToken: { address: destToken.address, decimals: destToken.decimals, symbol: destToken.symbol },
        srcAmount: quote.amount_in,
        chainId: this.chainId,
        side: 'SELL',
      },
      response: rateResponse,
      cachedAt: Date.now(),
      ttlMs: this.rateTtlMs,
    };

    this.rateCache.set(key, cachedEntry);

    // Also cache the reverse direction
    await this.fetchAndCacheReverseRate(pair);

    // Emit rate update event
    const updateEvent: RateUpdateEvent = {
      pair: `${srcToken.symbol}/${destToken.symbol}`,
      srcToken: srcToken.address,
      destToken: destToken.address,
      rate: quote.price,
      timestamp: Date.now(),
    };
    this.emit('rate:updated', updateEvent);
  }

  /**
   * Fetch and cache the reverse direction for a pair (destToken → srcToken).
   *
   * @param pair - The original trading pair (reverse will be derived)
   */
  private async fetchAndCacheReverseRate(pair: TradingPair): Promise<void> {
    const srcToken = pair.quoteToken; // reversed
    const destToken = pair.baseToken;

    const oneUnit = BigInt(10) ** BigInt(srcToken.decimals);

    const request: IndicativeQuoteRequest = {
      src_chain_id: this.chainId,
      dst_chain_id: this.chainId,
      token_in: resolveTokenAddress(srcToken.address, this.chainId),
      token_out: resolveTokenAddress(destToken.address, this.chainId),
      amount_in: oneUnit.toString(),
      side: 'sell',
    };

    let quote: IndicativeQuoteResponse;
    try {
      quote = await this.client.getIndicativeQuote(request);
    } catch {
      // Silently skip reverse — the forward direction is more important
      return;
    }

    const adjustedAmountOut = applyMarkup(quote.amount_out, this.markupBps);
    const poolId = `${POOL_ID_PREFIX}-${srcToken.address.toLowerCase()}-${destToken.address.toLowerCase()}`;

    const rateResponse: RateResponse = {
      srcToken: srcToken.address,
      destToken: destToken.address,
      srcAmount: quote.amount_in,
      destAmount: adjustedAmountOut,
      exchange: EXCHANGE_NAME,
      poolId,
      data: this.encodePoolData(srcToken.address, destToken.address),
      gasCost: '120000',
    };

    const key = pairKey(srcToken.address, destToken.address);

    this.rateCache.set(key, {
      request: {
        srcToken: { address: srcToken.address, decimals: srcToken.decimals, symbol: srcToken.symbol },
        destToken: { address: destToken.address, decimals: destToken.decimals, symbol: destToken.symbol },
        srcAmount: quote.amount_in,
        chainId: this.chainId,
        side: 'SELL',
      },
      response: rateResponse,
      cachedAt: Date.now(),
      ttlMs: this.rateTtlMs,
    });
  }

  // ─── Internal: Rate Scaling ──────────────────────────────────────────

  /**
   * Scale a cached rate response to match the requested `srcAmount`.
   *
   * The cache stores a rate for a 1-unit trade. This method linearly
   * scales the `destAmount` to the requested `srcAmount`.
   *
   * @param cached - Cached rate response (for 1 unit)
   * @param request - Incoming rate request with the actual amount
   * @returns Scaled rate response
   */
  /**
   * Scale a cached rate response to match the requested `srcAmount`.
   *
   * WARNING (MED-09): This uses linear scaling, which does NOT account for
   * AMM price impact or RFQ amount-dependent pricing. For large orders
   * relative to the cached amount, the scaled rate may be significantly
   * more optimistic than the actual rate. Use fresh quotes for accuracy.
   */
  private scaleRate(cached: RateResponse, request: RateRequest): RateResponse {
    const cachedSrc = BigInt(cached.srcAmount);
    const cachedDest = BigInt(cached.destAmount);
    const requestedSrc = BigInt(request.srcAmount);

    // Avoid division by zero
    if (cachedSrc === 0n) return { ...cached, srcAmount: request.srcAmount, destAmount: '0' };

    // Warn if scaling factor is large (>10x the cached amount)
    if (requestedSrc > cachedSrc * 10n) {
      this.emit('rate:error', {
        error: `WARNING: Linear rate scaling applied for ${requestedSrc.toString()} (${(requestedSrc / cachedSrc).toString()}x cached amount). Actual rate may differ significantly for ${cached.srcToken}/${cached.destToken}.`,
        timestamp: Date.now(),
      });
    }

    // Linear scaling: destAmount = cachedDest × requestedSrc / cachedSrc
    const scaledDest = (cachedDest * requestedSrc) / cachedSrc;

    return {
      ...cached,
      srcAmount: request.srcAmount,
      destAmount: scaledDest.toString(),
      data: this.encodePoolData(cached.srcToken, cached.destToken),
    };
  }

  // ─── Internal: Pool Data Encoding ────────────────────────────────────

  /**
   * Encode opaque data blob that Augustus passes to the pool adapter
   * contract during execution. Contains the token addresses and the
   * pool adapter address so the on-chain contract can identify the trade.
   *
   * @param srcToken - Source token address
   * @param destToken - Destination token address
   * @returns ABI-encoded hex string
   */
  private encodePoolData(srcToken: string, destToken: string): string {
    // Simple encoding: poolAdapterAddress + srcToken + destToken
    // Augustus will forward this `data` field to our pool adapter's swap function.
    const adapterAddr = this.poolAdapterAddress ?? '0x0000000000000000000000000000000000000000';
    // Pack as: adapter(20 bytes) + srcToken(20 bytes) + destToken(20 bytes)
    const pack = (addr: string) => addr.toLowerCase().replace('0x', '').padStart(40, '0');
    return '0x' + pack(adapterAddr) + pack(srcToken) + pack(destToken);
  }
}
