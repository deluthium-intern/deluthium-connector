/**
 * @deluthium/hashflow-adapter
 *
 * Hashflow RFQ bridge adapter for Deluthium.
 */


import { HashflowWSClient } from './ws-client.js';
import { PricePublisher, type PairTokenMap } from './price-publisher.js';
import { RFQHandler } from './rfq-handler.js';
import type {
  HashflowAdapterConfig, HashflowAdapterEvents,
  HashflowRFQRequest, HashflowRFQResponse, PriceLevels,
} from './types.js';

type EventHandler<T extends unknown[]> = (...args: T) => void;

export class HashflowAdapter {
  private readonly wsClient: HashflowWSClient;
  private readonly pricePublisher: PricePublisher;
  private readonly rfqHandler: RFQHandler;
  
  private readonly listeners = new Map<string, Set<EventHandler<never[]>>>();
  private running = false;

  constructor(config: HashflowAdapterConfig) {
    
    this.wsClient = new HashflowWSClient(config.hashflowWsUrl, config.signer, config.marketMaker, config.autoReconnect ?? true);
    this.pricePublisher = new PricePublisher(config.deluthiumConfig, this.wsClient, {
      chains: config.chains, pairs: config.pairs,
      priceRefreshIntervalMs: config.priceRefreshIntervalMs, spreadBps: config.spreadBps,
      numLevels: config.numLevels, levelTtlSeconds: config.levelTtlSeconds,
    });
    this.rfqHandler = new RFQHandler(config.deluthiumConfig, this.wsClient, config.signer, {
      maxQuoteExpirySec: config.maxQuoteExpirySec, poolAddresses: config.poolAddresses,
    });
    this.setupInternalEvents();
  }

  async start(): Promise<void> {
    if (this.running) return;
    await this.wsClient.connect();
    this.running = true;
    this.pricePublisher.start();
    this.rfqHandler.startListening();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.pricePublisher.stop();
    await this.wsClient.disconnect();
  }

  get isRunning(): boolean { return this.running; }
  get isConnected(): boolean { return this.wsClient.isConnected && this.wsClient.isAuthenticated; }

  registerPairTokens(pair: string, chainId: number, tokenMap: PairTokenMap): void {
    this.pricePublisher.registerPairTokens(pair, chainId, tokenMap);
  }

  async refreshPrices(): Promise<PriceLevels[]> { return this.pricePublisher.publishAllPrices(); }
  async handleRFQ(request: HashflowRFQRequest): Promise<void> { return this.rfqHandler.handleRFQ(request); }

  on<K extends keyof HashflowAdapterEvents>(event: K, handler: HashflowAdapterEvents[K]): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler as EventHandler<never[]>);
  }

  off<K extends keyof HashflowAdapterEvents>(event: K, handler: HashflowAdapterEvents[K]): void {
    this.listeners.get(event)?.delete(handler as EventHandler<never[]>);
  }

  getWSClient(): HashflowWSClient { return this.wsClient; }
  getPricePublisher(): PricePublisher { return this.pricePublisher; }
  getRFQHandler(): RFQHandler { return this.rfqHandler; }

  private setupInternalEvents(): void {
    this.wsClient.on('connected', (() => { this.emit('connected'); }) as never);
    this.wsClient.on('disconnected', ((data: { code: number; reason: string }) => { this.emit('disconnected', data.code, data.reason); }) as never);
    this.wsClient.on('error', ((err: Error) => { this.emit('error', err); }) as never);
    this.wsClient.on('rfq_request', ((request: HashflowRFQRequest) => { this.emit('rfqReceived', request); }) as never);
    this.rfqHandler.on('rfqResponded', ((response: HashflowRFQResponse) => { this.emit('rfqResponded', response); }) as never);
    this.rfqHandler.on('rfqDeclined', ((data: { rfqId: string; reason: string }) => { this.emit('rfqDeclined', data.rfqId, data.reason); }) as never);
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try { (handler as (...a: unknown[]) => void)(...args); } catch { /* skip */ }
      }
    }
  }
}

// Re-exports
export { HashflowWSClient, DEFAULT_HASHFLOW_WS_URL } from './ws-client.js';
export { PricePublisher, type PairTokenMap } from './price-publisher.js';
export { RFQHandler } from './rfq-handler.js';
export { signHashflowQuote, signCrossChainQuote, hashQuoteData, hashCrossChainQuoteData, generateTxid, generateHashflowNonce, signAuthChallenge } from './signer.js';
export { registerRoute, getRoute, isRouteSupported, getAllRoutes, getRoutesFrom, getRoutesTo, validateCrossChainRFQ, buildCrossChainQuoteData, chainIdToHashflow, hashflowToChainId, isEVMChain, type CrossChainRoute } from './cross-chain.js';
export type { HashflowChain, HashflowMessageType, HashflowWSMessage, HashflowAuthRequest, HashflowAuthResponse, PriceLevel, PriceLevels, PriceLevelsMessage, HashflowRFQRequest, HashflowRFQResponse, HashflowQuoteData, CrossChainQuoteData, CrossChainProtocol, MarketMakerStatus, HashflowAdapterConfig, HashflowAdapterEvents } from './types.js';
export { HASHFLOW_CHAIN_IDS, CHAIN_ID_TO_HASHFLOW } from './types.js';
