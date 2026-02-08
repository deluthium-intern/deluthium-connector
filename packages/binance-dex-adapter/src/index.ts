/**
 * @deluthium/binance-dex-adapter
 *
 * Adapter for Binance DEX (PancakeSwap) integration with the Deluthium
 * RFQ protocol.  Provides:
 *
 * - AMM quoting via PancakeSwap V2 + V3
 * - Price comparison between Deluthium RFQ and PancakeSwap
 * - Split-route optimization (binary / grid search for optimal allocation)
 * - Event-driven price monitoring
 *
 * @example
 * ```ts
 * import { BinanceDexAdapter, BNB_CHAIN_TOKENS } from '@deluthium/binance-dex-adapter';
 * import { toWei } from '@deluthium/sdk';
 *
 * const adapter = new BinanceDexAdapter({ deluthium: { auth: 'jwt', chainId: 56 }, signer });
 * await adapter.initialize();
 *
 * const comparison = await adapter.comparePrice(
 *   BNB_CHAIN_TOKENS.WBNB, BNB_CHAIN_TOKENS.USDT, toWei('10', 18),
 * );
 * console.log('Best venue:', comparison.bestQuote.source);
 * ```
 *
 * @packageDocumentation
 */

import { DeluthiumRestClient, getChainConfig } from '@deluthium/sdk';
import { ValidationError } from '@deluthium/sdk';
import type {
  BinanceDexAdapterConfig,
  BinanceDexAdapterEvent,
  BinanceDexEventHandler,
  DexToken,
  PriceComparison,
  SplitRoute,
  SplitExecutionResult,
} from './types.js';
import { PancakeSwapClient } from './pancakeswap-client.js';
import { PriceComparator } from './price-comparator.js';
import { SplitRouter } from './split-router.js';

// ---- Re-exports ------------------------------------------------------------

export * from './types.js';
export { PancakeSwapClient } from './pancakeswap-client.js';
export type { PancakeSwapQuoteResult, SwapExecutionResult } from './pancakeswap-client.js';
export { PriceComparator } from './price-comparator.js';
export { SplitRouter } from './split-router.js';

// ---- BinanceDexAdapter -----------------------------------------------------

/**
 * High-level adapter that ties together PancakeSwap quoting,
 * Deluthium RFQ comparison, and split-route optimization.
 *
 * Lifecycle:
 * 1. Construct with a {@link BinanceDexAdapterConfig}.
 * 2. Call {@link initialize} to create sub-components.
 * 3. Use {@link comparePrice}, {@link getOptimalRoute}, {@link executeRoute}.
 * 4. Optionally call {@link startPriceMonitoring} for continuous updates.
 * 5. Call {@link destroy} when done.
 */
export class BinanceDexAdapter {
  private readonly config: BinanceDexAdapterConfig;
  private pancakeSwapClient: PancakeSwapClient | null = null;
  private priceComparatorInstance: PriceComparator | null = null;
  private splitRouterInstance: SplitRouter | null = null;
  private deluthiumClient: DeluthiumRestClient | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private readonly eventHandlers = new Map<
    BinanceDexAdapterEvent,
    Set<BinanceDexEventHandler>
  >();
  private initialized = false;

  constructor(config: BinanceDexAdapterConfig) {
    this.config = config;
  }

  // ---- Lifecycle -----------------------------------------------------------

  /**
   * Initialize the adapter: create the Deluthium REST client, PancakeSwap
   * client, price comparator, and split router.
   *
   * Must be called before any other method.
   *
   * @throws {ValidationError} if configuration is incomplete
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const chainId = this.config.chainId ?? 56;

    // Resolve RPC URL
    let rpcUrl = this.config.rpcUrl;
    if (!rpcUrl) {
      const chainConfig = getChainConfig(chainId);
      rpcUrl = chainConfig.rpcUrls[0];
      if (!rpcUrl) {
        throw new ValidationError(
          `No RPC URL available for chain ${chainId}`,
          'rpcUrl',
        );
      }
    }

    // Deluthium client
    this.deluthiumClient = new DeluthiumRestClient(this.config.deluthium);

    // PancakeSwap client
    this.pancakeSwapClient = new PancakeSwapClient({
      rpcUrl,
      chainId,
      useV2: this.config.useV2Pools ?? true,
      useV3: this.config.useV3Pools ?? true,
    });

    // Price comparator
    this.priceComparatorInstance = new PriceComparator({
      pancakeSwap: this.pancakeSwapClient,
      deluthium: this.deluthiumClient,
      chainId,
    });

    // Split router
    this.splitRouterInstance = new SplitRouter({
      pancakeSwap: this.pancakeSwapClient,
      deluthium: this.deluthiumClient,
      signer: this.config.signer,
      chainId,
      minDeluthiumSplitBps: this.config.minDeluthiumSplitBps,
      maxSlippageBps: this.config.maxSlippageBps,
    });

    this.initialized = true;
  }

  /**
   * Tear down the adapter: stop monitoring, clear event handlers,
   * and release resources.
   */
  destroy(): void {
    this.stopPriceMonitoring();
    this.eventHandlers.clear();
    this.pancakeSwapClient = null;
    this.priceComparatorInstance = null;
    this.splitRouterInstance = null;
    this.deluthiumClient = null;
    this.initialized = false;
  }

  // ---- Price Comparison ----------------------------------------------------

  /**
   * Compare prices across Deluthium RFQ and PancakeSwap AMM.
   *
   * @param srcToken  Source token
   * @param destToken Destination token
   * @param srcAmount Input amount in wei (string)
   * @returns Price comparison with best quote and spread info
   */
  async comparePrice(
    srcToken: DexToken,
    destToken: DexToken,
    srcAmount: string,
  ): Promise<PriceComparison> {
    this.ensureInitialized();
    const comparison = await this.priceComparatorInstance!.compare(
      srcToken, destToken, srcAmount,
    );
    this.emit('comparison:ready', comparison);
    return comparison;
  }

  // ---- Split Routing -------------------------------------------------------

  /**
   * Compute the optimal split route between Deluthium and PancakeSwap.
   *
   * @param srcToken  Source token
   * @param destToken Destination token
   * @param srcAmount Input amount in wei (string)
   * @returns Optimized split route
   */
  async getOptimalRoute(
    srcToken: DexToken,
    destToken: DexToken,
    srcAmount: string,
  ): Promise<SplitRoute> {
    this.ensureInitialized();
    const route = await this.splitRouterInstance!.computeOptimalSplit(
      srcToken, destToken, srcAmount,
    );
    this.emit('route:computed', route);
    return route;
  }

  /**
   * Execute a previously computed split route.
   *
   * @param route The split route to execute
   * @returns Execution result
   */
  async executeRoute(route: SplitRoute): Promise<SplitExecutionResult> {
    this.ensureInitialized();
    try {
      const result = await this.splitRouterInstance!.executeSplit(route);
      this.emit('route:executed', result);
      return result;
    } catch (err) {
      this.emit('route:error', err);
      throw err;
    }
  }

  // ---- Price Monitoring ----------------------------------------------------

  /**
   * Start polling prices at the configured interval.
   *
   * Emits 'price:updated' and 'comparison:ready' events on each tick.
   * Emits 'price:error' if a tick fails.
   *
   * @param srcToken  Source token to monitor
   * @param destToken Destination token to monitor
   * @param srcAmount Input amount in wei
   */
  startPriceMonitoring(
    srcToken: DexToken,
    destToken: DexToken,
    srcAmount: string,
  ): void {
    this.ensureInitialized();
    this.stopPriceMonitoring();

    const intervalMs = this.config.priceRefreshIntervalMs ?? 3_000;

    // Guard against concurrent execution (MED-10)
    let isRefreshing = false;
    this.refreshInterval = setInterval(async () => {
      if (isRefreshing) return; // Skip if previous tick is still running
      isRefreshing = true;
      try {
        const comparison = await this.priceComparatorInstance!.compare(
          srcToken, destToken, srcAmount,
        );
        this.emit('price:updated', comparison);
        this.emit('comparison:ready', comparison);
      } catch (err) {
        this.emit('price:error', err);
      } finally {
        isRefreshing = false;
      }
    }, intervalMs);
  }

  /** Stop the price monitoring interval. */
  stopPriceMonitoring(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  // ---- Wallet Management ---------------------------------------------------

  /**
   * Connect a wallet to the PancakeSwap client for on-chain execution.
   *
   * @param privateKey Hex-encoded private key
   */
  connectWallet(privateKey: string): void {
    this.ensureInitialized();
    this.pancakeSwapClient!.connectWallet(privateKey);
  }

  // ---- Event System --------------------------------------------------------

  /**
   * Subscribe to an adapter event.
   *
   * @param event   Event name
   * @param handler Callback function
   */
  on<T = unknown>(event: BinanceDexAdapterEvent, handler: BinanceDexEventHandler<T>): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler as BinanceDexEventHandler);
  }

  /**
   * Unsubscribe from an adapter event.
   *
   * @param event   Event name
   * @param handler Previously registered callback
   */
  off<T = unknown>(event: BinanceDexAdapterEvent, handler: BinanceDexEventHandler<T>): void {
    this.eventHandlers.get(event)?.delete(handler as BinanceDexEventHandler);
  }

  // ---- Sub-component Accessors ---------------------------------------------

  /** Get the underlying PancakeSwap client (after initialization). */
  get pancakeSwap(): PancakeSwapClient {
    this.ensureInitialized();
    return this.pancakeSwapClient!;
  }

  /** Get the price comparator (after initialization). */
  get comparator(): PriceComparator {
    this.ensureInitialized();
    return this.priceComparatorInstance!;
  }

  /** Get the split router (after initialization). */
  get router(): SplitRouter {
    this.ensureInitialized();
    return this.splitRouterInstance!;
  }

  /** Whether the adapter has been initialized. */
  get isInitialized(): boolean {
    return this.initialized;
  }

  // ---- Private Helpers -----------------------------------------------------

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new ValidationError(
        'BinanceDexAdapter not initialized. Call initialize() first.',
        'initialized',
      );
    }
  }

  private emit(event: BinanceDexAdapterEvent, data?: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(data);
      } catch {
        // Swallow handler errors to avoid breaking the adapter
      }
    }
  }
}
