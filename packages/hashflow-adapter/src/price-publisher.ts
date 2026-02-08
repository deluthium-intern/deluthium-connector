/**
 * @deluthium/hashflow-adapter - Price Publisher
 *
 * Periodically fetches indicative quotes from Deluthium and
 * publishes them as price levels to the Hashflow network.
 */

import {
  DeluthiumRestClient,
  type IndicativeQuoteRequest,
  type IndicativeQuoteResponse,
  type Address,
  toWei,
} from '@deluthium/sdk';
import type {
  PriceLevels,
  PriceLevel,
  HashflowChain,
  HashflowAdapterConfig,
} from './types.js';
import { CHAIN_ID_TO_HASHFLOW } from './types.js';
import { HashflowWSClient } from './ws-client.js';

const DEFAULT_REFRESH_INTERVAL_MS = 5_000;
const DEFAULT_SPREAD_BPS = 5;
const DEFAULT_NUM_LEVELS = 5;
const DEFAULT_TTL_SECONDS = 10;
const LEVEL_MULTIPLIERS = [1, 2, 5, 10, 25];

/** Mapping of pair strings to token addresses per chain */
export interface PairTokenMap {
  readonly baseToken: Address;
  readonly quoteToken: Address;
  readonly baseDecimals: number;
  readonly quoteDecimals: number;
}

/**
 * Publishes Deluthium-sourced price levels to the Hashflow network.
 */
export class PricePublisher {
  private readonly deluthiumClient: DeluthiumRestClient;
  private readonly wsClient: HashflowWSClient;
  private readonly chains: number[];
  private readonly pairs: string[];
  private readonly refreshIntervalMs: number;
  private readonly spreadBps: number;
  private readonly numLevels: number;
  private readonly ttlSeconds: number;
  private readonly pairTokenMaps = new Map<string, PairTokenMap>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    deluthiumConfig: HashflowAdapterConfig['deluthiumConfig'],
    wsClient: HashflowWSClient,
    config: Pick<
      HashflowAdapterConfig,
      'chains' | 'pairs' | 'priceRefreshIntervalMs' | 'spreadBps' | 'numLevels' | 'levelTtlSeconds'
    >,
  ) {
    this.deluthiumClient = new DeluthiumRestClient(deluthiumConfig);
    this.wsClient = wsClient;
    this.chains = config.chains;
    this.pairs = config.pairs;
    this.refreshIntervalMs = config.priceRefreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    this.spreadBps = config.spreadBps ?? DEFAULT_SPREAD_BPS;
    this.numLevels = config.numLevels ?? DEFAULT_NUM_LEVELS;
    this.ttlSeconds = config.levelTtlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  registerPairTokens(pair: string, chainId: number, tokenMap: PairTokenMap): void {
    this.pairTokenMaps.set(`${pair}:${chainId}`, tokenMap);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.publishAllPrices();
    this.refreshTimer = setInterval(() => { void this.publishAllPrices(); }, this.refreshIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
  }

  get isRunning(): boolean { return this.running; }

  async publishAllPrices(): Promise<PriceLevels[]> {
    const allLevels: PriceLevels[] = [];
    for (const chainId of this.chains) {
      const hashflowChain = CHAIN_ID_TO_HASHFLOW[chainId];
      if (!hashflowChain) continue;
      for (const pair of this.pairs) {
        try {
          const levels = await this.buildPriceLevels(pair, chainId, hashflowChain);
          if (levels) { this.publishLevels(levels); allLevels.push(levels); }
        } catch { /* Skip failing pairs */ }
      }
    }
    return allLevels;
  }

  async buildPriceLevels(pair: string, chainId: number, hashflowChain: HashflowChain): Promise<PriceLevels | null> {
    const tokenMap = this.pairTokenMaps.get(`${pair}:${chainId}`);
    if (!tokenMap) return null;
    const baseAmount = toWei('1', tokenMap.baseDecimals);
    const quoteRequest: IndicativeQuoteRequest = {
      src_chain_id: chainId, dst_chain_id: chainId,
      token_in: tokenMap.baseToken, token_out: tokenMap.quoteToken, amount_in: baseAmount,
    };
    let indicativeQuote: IndicativeQuoteResponse;
    try { indicativeQuote = await this.deluthiumClient.getIndicativeQuote(quoteRequest); } catch { return null; }
    const midPrice = parseFloat(indicativeQuote.price);
    if (midPrice <= 0 || isNaN(midPrice)) return null;
    return {
      pair, chain: hashflowChain,
      baseToken: tokenMap.baseToken, quoteToken: tokenMap.quoteToken,
      bids: this.buildLevels(midPrice, 'bid'), asks: this.buildLevels(midPrice, 'ask'),
      timestamp: Date.now(), ttlSeconds: this.ttlSeconds,
    };
  }

  private buildLevels(midPrice: number, side: 'bid' | 'ask'): PriceLevel[] {
    const levels: PriceLevel[] = [];
    const spreadMultiplier = this.spreadBps / 10_000;
    const multipliers = LEVEL_MULTIPLIERS.slice(0, this.numLevels);
    for (let i = 0; i < multipliers.length; i++) {
      const levelSpread = spreadMultiplier * (1 + i * 0.5);
      const price = side === 'bid' ? midPrice * (1 - levelSpread) : midPrice * (1 + levelSpread);
      levels.push({ price: price.toFixed(8), quantity: (multipliers[i] ?? 1).toString() });
    }
    return levels;
  }

  private publishLevels(levels: PriceLevels): void {
    if (!this.wsClient.isConnected || !this.wsClient.isAuthenticated) return;
    this.wsClient.publishPriceLevels({
      pair: levels.pair, chain: levels.chain,
      baseToken: levels.baseToken, quoteToken: levels.quoteToken,
      bids: levels.bids, asks: levels.asks, ttlSeconds: levels.ttlSeconds,
    });
  }
}
