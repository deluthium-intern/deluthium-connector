/**
 * @deluthium/dydx-adapter - Arbitrage Detector
 *
 * Monitors both dYdX perpetuals and Deluthium spot prices for cross-venue
 * price discrepancies. Identifies opportunities where the price difference
 * exceeds configurable thresholds after accounting for estimated costs.
 *
 * @packageDocumentation
 */

import {
  DeluthiumRestClient,
  retry,
} from '@deluthium/sdk';
import type { IndicativeQuoteRequest } from '@deluthium/sdk';
import type {
  ArbitrageOpportunity,
  ArbitrageConfig,
  DydxAdapterEvent,
  DydxEventHandler,
} from './types.js';
import type { MarketDataFeed } from './market-data.js';

// --- Default configuration ---

const DEFAULT_ARB_CONFIG: ArbitrageConfig = {
  minSpreadBps: 30,
  maxPositionUsd: 10_000,
  minProfitUsd: 5,
  autoExecute: false,
  pairs: [],
};

const DEFAULT_SCAN_INTERVAL_MS = 5_000;
const ESTIMATED_GAS_COST_USD = 2.0;
const ESTIMATED_DYDX_FEE_BPS = 5;
const ESTIMATED_DELUTHIUM_FEE_BPS = 10;

// --- Pair configuration for arb scanning ---

/**
 * Configuration for a single arbitrage pair, linking a Deluthium
 * token pair to a dYdX perpetual market.
 */
export interface ArbPairConfig {
  /** dYdX market ticker (e.g. "BTC-USD") */
  ticker: string;
  /** Deluthium token_in address (quote token, e.g. USDT) */
  deluthiumTokenIn: string;
  /** Deluthium token_out address (base token, e.g. WBTC) */
  deluthiumTokenOut: string;
  /** Deluthium chain ID */
  chainId: number;
  /** Token decimals for the base asset */
  baseDecimals: number;
  /** Quote amount (in wei) to use for price discovery */
  quoteAmountWei: string;
}

// --- ArbitrageDetector ---

/**
 * Cross-venue arbitrage detector for dYdX perps vs Deluthium spot.
 *
 * Scans configured pairs at regular intervals, comparing the dYdX
 * perpetual best bid/ask with the Deluthium indicative quote price.
 * When a spread exceeding the minimum threshold is found, an
 * {@link ArbitrageOpportunity} is emitted.
 *
 * @example
 * ```typescript
 * const arb = new ArbitrageDetector(marketData, deluthiumClient, {
 *   minSpreadBps: 25,
 *   maxPositionUsd: 5000,
 *   minProfitUsd: 3,
 *   autoExecute: false,
 *   pairs: ['BTC-USD'],
 * });
 *
 * arb.addPair({
 *   ticker: 'BTC-USD',
 *   deluthiumTokenIn: '0xUSDT...',
 *   deluthiumTokenOut: '0xWBTC...',
 *   chainId: 56,
 *   baseDecimals: 18,
 *   quoteAmountWei: '1000000000000000000',
 * });
 *
 * arb.on('arbitrage:detected', (opp) => {
 *   console.log('Opportunity:', opp.spreadBps, 'bps');
 * });
 *
 * await arb.start();
 * ```
 */
export class ArbitrageDetector {
  private readonly marketData: MarketDataFeed;
  private readonly deluthiumClient: DeluthiumRestClient;
  private readonly config: ArbitrageConfig;
  private readonly pairConfigs: ArbPairConfig[] = [];
  private readonly listeners = new Map<string, Set<DydxEventHandler<unknown>>>();
  private readonly recentOpportunities: ArbitrageOpportunity[] = [];

  private running = false;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private scanIntervalMs: number;
  private opportunityCounter = 0;

  constructor(
    marketData: MarketDataFeed,
    deluthiumClient: DeluthiumRestClient,
    config?: Partial<ArbitrageConfig>,
  ) {
    this.marketData = marketData;
    this.deluthiumClient = deluthiumClient;
    this.config = { ...DEFAULT_ARB_CONFIG, ...config };
    this.scanIntervalMs = DEFAULT_SCAN_INTERVAL_MS;
  }

  // --- Configuration ---

  /** Add an arbitrage pair to monitor. */
  addPair(pair: ArbPairConfig): void {
    this.pairConfigs.push(pair);
  }

  /** Remove an arbitrage pair by ticker. */
  removePair(ticker: string): void {
    const idx = this.pairConfigs.findIndex((p) => p.ticker === ticker);
    if (idx >= 0) this.pairConfigs.splice(idx, 1);
  }

  /** Set the scan interval in milliseconds. */
  setScanInterval(ms: number): void {
    this.scanIntervalMs = ms;
  }

  /** Get all recent arbitrage opportunities (last 100). */
  getRecentOpportunities(): ArbitrageOpportunity[] {
    return [...this.recentOpportunities];
  }

  /** Get the current arbitrage config. */
  getConfig(): ArbitrageConfig {
    return { ...this.config };
  }

  // --- Lifecycle ---

  /** Start the arbitrage scanning loop. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.scanCycle();
  }

  /** Stop the arbitrage scanner. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
  }

  /** Whether the scanner is currently running. */
  get isRunning(): boolean {
    return this.running;
  }

  // --- Events ---

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

  // --- Core Scanning Logic ---

  private async scanCycle(): Promise<void> {
    if (!this.running) return;

    try {
      await this.scanAllPairs();
    } catch {
      // Scan errors are non-fatal; continue scanning
    }

    if (this.running) {
      this.scanTimer = setTimeout(() => { void this.scanCycle(); }, this.scanIntervalMs);
    }
  }

  private async scanAllPairs(): Promise<void> {
    for (const pair of this.pairConfigs) {
      if (!this.running) break;
      try {
        await this.scanPair(pair);
      } catch {
        // Skip individual pair errors
      }
    }
  }

  private async scanPair(pair: ArbPairConfig): Promise<void> {
    // Get dYdX best bid and ask
    const dydxBid = this.marketData.getBestBid(pair.ticker);
    const dydxAsk = this.marketData.getBestAsk(pair.ticker);
    if (!dydxBid || !dydxAsk) return;

    // Get Deluthium indicative price (buy direction: tokenIn -> tokenOut)
    const buyQuoteReq: IndicativeQuoteRequest = {
      src_chain_id: pair.chainId,
      dst_chain_id: pair.chainId,
      token_in: pair.deluthiumTokenIn,
      token_out: pair.deluthiumTokenOut,
      amount_in: pair.quoteAmountWei,
    };

    const buyQuote = await retry(
      () => this.deluthiumClient.getIndicativeQuote(buyQuoteReq),
      1, 1000,
    );

    const deluthiumBuyPrice = parseFloat(buyQuote.price);
    if (!deluthiumBuyPrice || deluthiumBuyPrice <= 0) return;

    const dydxBidPrice = parseFloat(dydxBid);
    const dydxAskPrice = parseFloat(dydxAsk);

    // Check opportunity: buy on Deluthium, sell on dYdX
    // (If Deluthium buy price < dYdX bid, we can profit)
    this.evaluateOpportunity(
      pair,
      'buy_deluthium_sell_dydx',
      dydxBidPrice,
      deluthiumBuyPrice,
    );

    // Check opportunity: buy on dYdX, sell on Deluthium
    // (If dYdX ask < Deluthium sell price, we can profit)
    // For sell direction, we approximate using inverse of buy price
    const deluthiumSellPrice = deluthiumBuyPrice; // Simplified; real impl would fetch sell quote
    this.evaluateOpportunity(
      pair,
      'buy_dydx_sell_deluthium',
      dydxAskPrice,
      deluthiumSellPrice,
    );
  }

  private evaluateOpportunity(
    pair: ArbPairConfig,
    direction: ArbitrageOpportunity['direction'],
    dydxPrice: number,
    deluthiumPrice: number,
  ): void {
    let spreadBps: number;
    let estimatedSize: number;

    if (direction === 'buy_deluthium_sell_dydx') {
      // Profit when deluthiumPrice < dydxPrice
      spreadBps = ((dydxPrice - deluthiumPrice) / deluthiumPrice) * 10_000;
      estimatedSize = this.config.maxPositionUsd / deluthiumPrice;
    } else {
      // Profit when dydxPrice < deluthiumPrice
      spreadBps = ((deluthiumPrice - dydxPrice) / dydxPrice) * 10_000;
      estimatedSize = this.config.maxPositionUsd / dydxPrice;
    }

    if (spreadBps < this.config.minSpreadBps) return;

    // Calculate costs
    const totalFeeBps = ESTIMATED_DYDX_FEE_BPS + ESTIMATED_DELUTHIUM_FEE_BPS;
    const netSpreadBps = spreadBps - totalFeeBps;
    if (netSpreadBps <= 0) return;

    const grossProfit = (netSpreadBps / 10_000) * this.config.maxPositionUsd;
    const netProfit = grossProfit - ESTIMATED_GAS_COST_USD;

    if (netProfit < this.config.minProfitUsd) return;

    this.opportunityCounter++;
    const opportunity: ArbitrageOpportunity = {
      id: 'arb-' + Date.now() + '-' + this.opportunityCounter,
      pair: pair.ticker,
      direction,
      dydxPrice: dydxPrice.toFixed(6),
      deluthiumPrice: deluthiumPrice.toFixed(6),
      spreadBps: Math.round(spreadBps * 100) / 100,
      estimatedProfitUsd: grossProfit.toFixed(2),
      maxSize: estimatedSize.toFixed(8),
      detectedAt: Date.now(),
      valid: true,
      estimatedCostUsd: (ESTIMATED_GAS_COST_USD + (totalFeeBps / 10_000) * this.config.maxPositionUsd).toFixed(2),
      netProfitUsd: netProfit.toFixed(2),
    };

    // Track and emit
    this.recentOpportunities.push(opportunity);
    if (this.recentOpportunities.length > 100) {
      this.recentOpportunities.shift();
    }

    this.emit('arbitrage:detected', opportunity);
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
