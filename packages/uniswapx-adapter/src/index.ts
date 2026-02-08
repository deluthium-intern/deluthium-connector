/**
 * @deluthium/uniswapx-adapter
 *
 * UniswapX filler adapter for Deluthium.
 *
 * Enables Deluthium market makers to act as UniswapX fillers by:
 * - Parsing Dutch auction orders from the UniswapX order API
 * - Evaluating fill profitability against Deluthium liquidity
 * - Executing fills via Reactor contracts with Permit2 approvals
 *
 * @example
 * ```typescript
 * import { UniswapXAdapter } from '@deluthium/uniswapx-adapter';
 * import { PrivateKeySigner, ChainId } from '@deluthium/sdk';
 *
 * const adapter = new UniswapXAdapter({
 *   deluthiumConfig: { auth: 'your-jwt', chainId: ChainId.ETHEREUM },
 *   signer: new PrivateKeySigner('0x...'),
 *   chainId: ChainId.ETHEREUM,
 *   rpcUrl: 'https://eth.llamarpc.com',
 *   minProfitBps: 25,
 * });
 *
 * // Start polling for profitable orders
 * adapter.on('orderEvaluated', (evaluation) => {
 *   if (evaluation.profitable) {
 *     console.log(`Profitable order: ${evaluation.order.orderHash}`);
 *   }
 * });
 *
 * await adapter.start();
 * ```
 *
 * @packageDocumentation
 */

import type { HexString } from '@deluthium/sdk';
import { UniswapXFiller } from './filler.js';
import { parseOrders, type RawUniswapXOrder } from './order-parser.js';
import { ReactorClient } from './reactor-client.js';
import { Permit2Client } from './permit2.js';
import type {
  UniswapXAdapterConfig,
  UniswapXAdapterEvents,
  UniswapXOrder,
  FillEvaluation,
  FillResult,
} from './types.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default UniswapX order API endpoint */
const DEFAULT_ORDER_API = 'https://api.uniswap.org/v2/orders';

/** Default polling interval */
const DEFAULT_POLL_INTERVAL_MS = 2_000;

// ─── Event Emitter ──────────────────────────────────────────────────────────

type EventHandler<T extends unknown[]> = (...args: T) => void;

// ─── Main Adapter ───────────────────────────────────────────────────────────

/**
 * UniswapX adapter for Deluthium.
 *
 * Polls the UniswapX order API for open orders, evaluates fill
 * profitability against Deluthium liquidity, and optionally
 * auto-fills profitable orders.
 */
export class UniswapXAdapter {
  private readonly filler: UniswapXFiller;
  private readonly permit2Client: Permit2Client;
  private readonly config: UniswapXAdapterConfig;
  private readonly orderApiUrl: string;
  private readonly pollIntervalMs: number;
  private readonly autoFill: boolean;
  private readonly seenOrders = new Set<string>();
  private readonly listeners = new Map<string, Set<EventHandler<never[]>>>();
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: UniswapXAdapterConfig) {
    this.config = config;
    this.filler = new UniswapXFiller(config);
    this.permit2Client = new Permit2Client(config.rpcUrl, config.chainId);
    this.orderApiUrl = config.orderApiUrl ?? DEFAULT_ORDER_API;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.autoFill = config.autoFill ?? false;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────

  /**
   * Start polling for UniswapX orders.
   *
   * Will continuously fetch open orders, evaluate profitability,
   * and optionally auto-fill profitable ones.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.poll();
  }

  /**
   * Stop polling for orders.
   */
  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Whether the adapter is currently running.
   */
  get isRunning(): boolean {
    return this.running;
  }

  // ─── Manual Operations ────────────────────────────────────────────

  /**
   * Manually evaluate a single order for fill profitability.
   *
   * @param order - UniswapX order to evaluate
   * @returns Fill evaluation result
   */
  async evaluateOrder(order: UniswapXOrder): Promise<FillEvaluation> {
    return this.filler.evaluate(order);
  }

  /**
   * Manually evaluate multiple orders.
   *
   * @param orders - Array of orders to evaluate
   * @returns Profitable evaluations sorted by net profit
   */
  async evaluateOrders(orders: UniswapXOrder[]): Promise<FillEvaluation[]> {
    return this.filler.evaluateBatch(orders);
  }

  /**
   * Manually execute a fill for an order.
   *
   * @param order - Order to fill
   * @returns Fill result
   */
  async fillOrder(order: UniswapXOrder): Promise<FillResult> {
    return this.filler.getReactorClient().execute(order);
  }

  /**
   * Fetch open orders from the UniswapX API for the configured chain.
   *
   * @param limit - Maximum number of orders to fetch (default: 50)
   * @returns Parsed UniswapX orders
   */
  async fetchOpenOrders(limit = 50): Promise<UniswapXOrder[]> {
    try {
      const url = new URL(this.orderApiUrl);
      url.searchParams.set('chainId', String(this.config.chainId));
      url.searchParams.set('orderStatus', 'open');
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('sortKey', 'createdAt');
      url.searchParams.set('sort', 'lt(9999999999)');

      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`UniswapX API returned ${response.status}`);
      }

      const data = await response.json() as { orders?: RawUniswapXOrder[] };
      return parseOrders(data.orders ?? []);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('error', error);
      return [];
    }
  }

  // ─── Event Handling ───────────────────────────────────────────────

  /**
   * Register an event listener.
   */
  on<K extends keyof UniswapXAdapterEvents>(
    event: K,
    handler: UniswapXAdapterEvents[K],
  ): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as EventHandler<never[]>);
  }

  /**
   * Remove an event listener.
   */
  off<K extends keyof UniswapXAdapterEvents>(
    event: K,
    handler: UniswapXAdapterEvents[K],
  ): void {
    this.listeners.get(event)?.delete(handler as EventHandler<never[]>);
  }

  // ─── Accessors ────────────────────────────────────────────────────

  /** Get the underlying UniswapXFiller instance. */
  getFiller(): UniswapXFiller {
    return this.filler;
  }

  /** Get the Permit2Client instance. */
  getPermit2Client(): Permit2Client {
    return this.permit2Client;
  }

  /** Get the ReactorClient instance. */
  getReactorClient(): ReactorClient {
    return this.filler.getReactorClient();
  }

  // ─── Internal ─────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      const orders = await this.fetchOpenOrders();

      // Filter out already-seen orders
      const newOrders = orders.filter((o) => !this.seenOrders.has(o.orderHash));
      for (const order of newOrders) {
        this.seenOrders.add(order.orderHash);
        this.emit('orderDiscovered', order);
      }

      // Evaluate new orders
      if (newOrders.length > 0) {
        const evaluations = await this.filler.evaluateBatch(newOrders);

        for (const evaluation of evaluations) {
          this.emit('orderEvaluated', evaluation);
        }

        // Auto-fill profitable orders if enabled
        if (this.autoFill) {
          for (const evaluation of evaluations) {
            if (evaluation.profitable) {
              await this.attemptFill(evaluation);
            }
          }
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('error', error);
    }

    // Prune seen orders to prevent memory leak (HIGH-06)
    this.pruneSeenOrders();

    // Schedule next poll
    if (this.running) {
      this.pollTimer = setTimeout(() => void this.poll(), this.pollIntervalMs);
    }
  }

  private async attemptFill(evaluation: FillEvaluation): Promise<void> {
    const { order } = evaluation;

    try {
      const result = await this.filler.getReactorClient().execute(order);

      if (result.success) {
        // Emit fillSubmitted with the real txHash after the transaction is broadcast (HIGH-07)
        this.emit('fillSubmitted', order.orderHash, (result.txHash ?? '0x') as HexString);
        this.emit('fillConfirmed', result);
      } else {
        this.emit('fillFailed', order.orderHash, new Error(result.error ?? 'Fill failed'));
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('fillFailed', order.orderHash, error);
    }
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          (handler as (...a: unknown[]) => void)(...args);
        } catch {
          // Don't let handler errors break the event loop
        }
      }
    }
  }

  /**
   * Prune old order hashes from the seen set to prevent memory leaks.
   * Called automatically; keeps the most recent 10,000 hashes.
   */
  pruneSeenOrders(maxSize = 10_000): void {
    if (this.seenOrders.size > maxSize) {
      const toRemove = this.seenOrders.size - maxSize;
      const iterator = this.seenOrders.values();
      for (let i = 0; i < toRemove; i++) {
        const val = iterator.next().value;
        if (val !== undefined) {
          this.seenOrders.delete(val);
        }
      }
    }
  }
}

// ─── Re-exports ─────────────────────────────────────────────────────────────

// Core adapter
export { UniswapXFiller } from './filler.js';

// Order parsing
export {
  parseOrder,
  parseOrders,
  getOrderStatus,
  computeCurrentInput,
  computeCurrentOutput,
  computeDecayAmount,
  computeOrderHash,
} from './order-parser.js';
export type { RawUniswapXOrder } from './order-parser.js';

// Reactor
export {
  ReactorClient,
  registerReactorDeployment,
  getReactorDeployment,
  getSupportedChains,
} from './reactor-client.js';

// Permit2
export {
  Permit2Client,
  PERMIT2_ADDRESS,
  MAX_UINT160,
  MAX_UINT48,
  PERMIT_SINGLE_TYPES,
  PERMIT_BATCH_TYPES,
  validatePermitDeadline,
  isAllowanceSufficient,
} from './permit2.js';

// Types
export type {
  UniswapXOrderType,
  OrderStatus,
  DutchInput,
  DutchOutput,
  CosignerData,
  DutchOrderV2,
  ExclusiveDutchOrder,
  PriorityOrder,
  UniswapXOrder,
  ReactorDeployment,
  FillResult,
  FillEvaluation,
  PermitSingle,
  PermitBatch,
  PermitWitnessTransfer,
  UniswapXAdapterConfig,
  UniswapXAdapterEvents,
} from './types.js';
