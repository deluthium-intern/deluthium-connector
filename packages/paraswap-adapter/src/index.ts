/**
 * @deluthium/paraswap-adapter
 *
 * Register Deluthium as a liquidity source on the Paraswap aggregator.
 *
 * This package provides:
 * - **RateProvider** -- periodically publishes indicative rates from Deluthium
 *   so Paraswap's routing engine can discover our liquidity.
 * - **Executor** -- builds and submits swap transactions through the Augustus
 *   Swapper, wrapping Deluthium firm-quote calldata.
 * - **ParaswapAdapter** -- high-level orchestrator that composes the rate
 *   provider and executor, manages lifecycle, and emits events.
 *
 * @example
 * ```typescript
 * import { ParaswapAdapter } from '@deluthium/paraswap-adapter';
 * import { PrivateKeySigner, ChainId } from '@deluthium/sdk';
 *
 * const adapter = new ParaswapAdapter({
 *   deluthium: { auth: 'jwt-token', chainId: ChainId.BSC },
 *   signer: new PrivateKeySigner(process.env.PRIVATE_KEY!),
 *   poolAdapterAddress: '0xYourDeployedPoolAdapter',
 * });
 *
 * adapter.on('rate:updated', (event) => console.log('Rate updated:', event));
 * await adapter.start();
 * ```
 *
 * @packageDocumentation
 */

import {
  DeluthiumRestClient,
  ValidationError,
  type TradingPair,
} from '@deluthium/sdk';

import { JsonRpcProvider } from 'ethers';

import type {
  ParaswapAdapterConfig,
  RateRequest,
  RateResponse,
  BuildTxRequest,
  BuiltTransaction,
  CachedRate,
  PoolRegistrationStatus,
  ParaswapAdapterEvent,
  ParaswapEventHandler,
} from './types.js';

import { RateProvider } from './rate-provider.js';
import { Executor } from './executor.js';

// ---- ParaswapAdapter --------------------------------------------------------

/**
 * High-level adapter that registers Deluthium as a liquidity source on Paraswap.
 *
 * Composes a RateProvider (for publishing rates to the routing engine)
 * and an Executor (for building/submitting swap transactions through
 * Augustus), managing their lifecycle and surfacing events to the caller.
 *
 * @example
 * ```typescript
 * const adapter = new ParaswapAdapter({
 *   deluthium: { auth: 'jwt', chainId: 56 },
 *   signer: new PrivateKeySigner(key),
 *   poolAdapterAddress: '0x...',
 *   rateRefreshIntervalMs: 3000,
 *   maxSlippageBps: 30,
 * });
 *
 * // Subscribe to events
 * adapter.on('rate:updated', (e) => console.log(e));
 * adapter.on('swap:executed', (e) => console.log(e));
 *
 * // Start rate publishing
 * await adapter.start();
 *
 * // Query a rate
 * const rate = adapter.getRate({ ... });
 *
 * // Build a swap transaction
 * const tx = await adapter.buildSwapTransaction({ ... });
 *
 * // Stop when done
 * adapter.stop();
 * ```
 */
export class ParaswapAdapter {
  /** Adapter configuration (immutable after construction) */
  private readonly config: ParaswapAdapterConfig;

  /** Deluthium REST client shared by rate provider and executor */
  private readonly client: DeluthiumRestClient;

  /** Rate provider instance */
  private readonly rateProvider: RateProvider;

  /** Executor instance */
  private readonly executor: Executor;

  /** Resolved chain ID */
  private readonly chainId: number;

  /** Event listeners keyed by event name */
  private readonly listeners: Map<ParaswapAdapterEvent, Set<ParaswapEventHandler>>;

  /** Whether the adapter is currently running */
  private started = false;

  /**
   * Create a new ParaswapAdapter.
   *
   * @param config - Full adapter configuration
   * @throws ValidationError if required configuration is missing
   */
  constructor(config: ParaswapAdapterConfig) {
    this.validateConfig(config);
    this.config = config;
    this.chainId = config.chainId ?? config.deluthium.chainId;

    // Initialise event listener map
    this.listeners = new Map();

    // Create the shared REST client
    this.client = new DeluthiumRestClient(config.deluthium);

    // Create sub-components, passing in the event emitter
    const emitter = this.emitEvent.bind(this);
    this.rateProvider = new RateProvider(config, this.client, emitter);
    this.executor = new Executor(config, this.client, emitter);
  }

  // ---- Lifecycle ------------------------------------------------------------

  /**
   * Start the adapter: begins periodic rate publishing.
   *
   * @throws DeluthiumError if initial pair/token fetch fails
   */
  async start(): Promise<void> {
    if (this.started) return;

    this.started = true;
    await this.rateProvider.start();
  }

  /**
   * Stop the adapter: halts rate publishing and clears caches.
   */
  stop(): void {
    this.started = false;
    this.rateProvider.stop();
  }

  /**
   * Whether the adapter is currently running.
   */
  get isRunning(): boolean {
    return this.started && this.rateProvider.isRunning;
  }

  // ---- Rate Queries ---------------------------------------------------------

  /**
   * Query the cached rate for a token pair.
   *
   * @param request - Rate request from Paraswap routing engine
   * @returns Rate response or null if no fresh rate is available
   */
  getRate(request: RateRequest): RateResponse | null {
    return this.rateProvider.getRate(request);
  }

  /**
   * Get all cached rates (may include stale entries).
   */
  getAllRates(): CachedRate[] {
    return this.rateProvider.getAllCachedRates();
  }

  /**
   * Get the number of actively cached (non-expired) rates.
   */
  get activeCacheSize(): number {
    return this.rateProvider.activeCacheSize;
  }

  /**
   * Get the list of supported trading pairs from Deluthium.
   */
  getSupportedPairs(): TradingPair[] {
    return this.rateProvider.getPairs();
  }

  // ---- Swap Transactions ----------------------------------------------------

  /**
   * Build a swap transaction targeting the Augustus Swapper.
   *
   * @param request - Transaction build parameters
   * @returns Ready-to-sign transaction
   * @throws ValidationError on invalid input
   * @throws DeluthiumError on firm-quote failure
   */
  async buildSwapTransaction(request: BuildTxRequest): Promise<BuiltTransaction> {
    return this.executor.buildTransaction(request);
  }

  /**
   * Build and execute a swap in a single call.
   *
   * @param request - Transaction parameters
   * @param rpcUrl - JSON-RPC endpoint URL for the target chain
   * @returns Transaction hash
   * @throws DeluthiumError on failure
   */
  async executeSwap(request: BuildTxRequest, rpcUrl: string): Promise<string> {
    const provider = new JsonRpcProvider(rpcUrl);
    return this.executor.executeSwap(request, provider);
  }

  /**
   * Estimate gas for a swap transaction.
   *
   * @param request - Transaction parameters
   * @param rpcUrl - JSON-RPC endpoint URL
   * @returns Gas estimate as string
   */
  async estimateGas(request: BuildTxRequest, rpcUrl: string): Promise<string> {
    const provider = new JsonRpcProvider(rpcUrl);
    return this.executor.estimateGas(request, provider);
  }

  // ---- Pool Registration Info -----------------------------------------------

  /**
   * Get the current pool registration status.
   *
   * This reflects the adapter configuration -- actual on-chain registration
   * must be performed separately via Paraswap governance process.
   */
  getRegistrationStatus(): PoolRegistrationStatus {
    const pairs = this.rateProvider.getPairs();
    return {
      registered: !!this.config.poolAdapterAddress,
      adapterAddress: this.config.poolAdapterAddress,
      chainId: this.chainId,
      supportedPairs: pairs.map((p) => ({
        srcToken: p.baseToken.address,
        destToken: p.quoteToken.address,
      })),
      registeredAt: this.started ? Date.now() : undefined,
    };
  }

  /**
   * Get the Augustus Swapper address being used.
   */
  getAugustusAddress(): string {
    return this.executor.getAugustusAddress();
  }

  /**
   * Get the configured chain ID.
   */
  getChainId(): number {
    return this.chainId;
  }

  // ---- Events ---------------------------------------------------------------

  /**
   * Subscribe to an adapter event.
   *
   * @param event - Event name
   * @param handler - Callback function
   * @returns this for chaining
   *
   * @example
   * ```typescript
   * adapter.on('rate:updated', (event: RateUpdateEvent) => {
   *   console.log(`${event.pair}: ${event.rate}`);
   * });
   * ```
   */
  on<T = unknown>(event: ParaswapAdapterEvent, handler: ParaswapEventHandler<T>): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as ParaswapEventHandler);
    return this;
  }

  /**
   * Unsubscribe from an adapter event.
   *
   * @param event - Event name
   * @param handler - Handler to remove
   * @returns this for chaining
   */
  off<T = unknown>(event: ParaswapAdapterEvent, handler: ParaswapEventHandler<T>): this {
    this.listeners.get(event)?.delete(handler as ParaswapEventHandler);
    return this;
  }

  /**
   * Subscribe to an event for a single invocation.
   *
   * @param event - Event name
   * @param handler - One-shot callback
   * @returns this for chaining
   */
  once<T = unknown>(event: ParaswapAdapterEvent, handler: ParaswapEventHandler<T>): this {
    const wrapper: ParaswapEventHandler = (data) => {
      this.off(event, wrapper);
      (handler as ParaswapEventHandler)(data);
    };
    return this.on(event, wrapper);
  }

  /**
   * Remove all listeners for an event (or all events if omitted).
   */
  removeAllListeners(event?: ParaswapAdapterEvent): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }

  // ---- Internal: Event Emission ---------------------------------------------

  /**
   * Emit an event to all registered listeners.
   *
   * @param event - Event name
   * @param data - Event payload
   */
  private emitEvent(event: ParaswapAdapterEvent, data: unknown): void {
    const handlers = this.listeners.get(event);
    if (!handlers || handlers.size === 0) return;

    for (const handler of handlers) {
      try {
        handler(data);
      } catch {
        // Swallow listener errors to prevent cascading failures
      }
    }
  }

  // ---- Internal: Validation -------------------------------------------------

  /**
   * Validate the adapter configuration at construction time.
   *
   * @throws ValidationError if required fields are missing
   */
  private validateConfig(config: ParaswapAdapterConfig): void {
    if (!config.deluthium) {
      throw new ValidationError('deluthium client config is required', 'deluthium');
    }
    if (!config.deluthium.auth) {
      throw new ValidationError('deluthium.auth (JWT token) is required', 'deluthium.auth');
    }
    if (!config.deluthium.chainId && !config.chainId) {
      throw new ValidationError(
        'Either deluthium.chainId or chainId must be provided',
        'chainId',
      );
    }
    if (!config.signer) {
      throw new ValidationError('signer is required for transaction signing', 'signer');
    }
  }
}

// ---- Re-exports -------------------------------------------------------------

export { RateProvider } from './rate-provider.js';
export { Executor } from './executor.js';

export type {
  ParaswapAdapterConfig,
  ParaswapToken,
  RateRequest,
  RateResponse,
  BuildTxRequest,
  BuiltTransaction,
  CachedRate,
  PoolRegistrationStatus,
  ParaswapAdapterEvent,
  ParaswapEventHandler,
  RateUpdateEvent,
  SwapExecutedEvent,
} from './types.js';

export { AUGUSTUS_ADDRESSES } from './types.js';
