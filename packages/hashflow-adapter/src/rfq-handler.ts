/**
 * @deluthium/hashflow-adapter - RFQ Handler
 *
 * Processes incoming Hashflow RFQ requests by proxying to Deluthium.
 */

import {
  DeluthiumRestClient,
  type FirmQuoteRequest,
  type FirmQuoteResponse,
  type ISigner,
  type Address,
} from '@deluthium/sdk';
import type {
  HashflowRFQRequest,
  HashflowRFQResponse,
  HashflowQuoteData,
  HashflowAdapterConfig,
} from './types.js';
import { HASHFLOW_CHAIN_IDS } from './types.js';
import { HashflowWSClient } from './ws-client.js';
import { signHashflowQuote, generateTxid, generateHashflowNonce } from './signer.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MAX_QUOTE_EXPIRY_SEC = 30;
const DEFAULT_SLIPPAGE_PERCENT = 0.5;

// ─── Event Types ────────────────────────────────────────────────────────────

type RFQEventHandler<T = unknown> = (data: T) => void;

interface RFQEvents {
  rfqResponded: RFQEventHandler<HashflowRFQResponse>;
  rfqDeclined: RFQEventHandler<{ rfqId: string; reason: string }>;
  error: RFQEventHandler<Error>;
}

// ─── RFQ Handler ────────────────────────────────────────────────────────────

/**
 * Handles incoming Hashflow RFQ requests by proxying to Deluthium.
 */
export class RFQHandler {
  private readonly deluthiumClient: DeluthiumRestClient;
  private readonly wsClient: HashflowWSClient;
  private readonly signer: ISigner;
  private readonly maxQuoteExpirySec: number;
  private readonly poolAddresses: Record<number, Address>;
  private readonly listeners = new Map<string, Set<RFQEventHandler<never>>>();

  constructor(
    deluthiumConfig: HashflowAdapterConfig['deluthiumConfig'],
    wsClient: HashflowWSClient,
    signer: ISigner,
    config: Pick<HashflowAdapterConfig, 'maxQuoteExpirySec' | 'poolAddresses'>,
  ) {
    this.deluthiumClient = new DeluthiumRestClient(deluthiumConfig);
    this.wsClient = wsClient;
    this.signer = signer;
    this.maxQuoteExpirySec = config.maxQuoteExpirySec ?? DEFAULT_MAX_QUOTE_EXPIRY_SEC;
    this.poolAddresses = config.poolAddresses ?? {};
  }

  /** Start listening for RFQ requests on the WebSocket. */
  startListening(): void {
    this.wsClient.on('rfq_request', ((request: HashflowRFQRequest) => {
      void this.handleRFQ(request);
    }) as never);
  }

  /** Process a single RFQ request. */
  async handleRFQ(request: HashflowRFQRequest): Promise<void> {
    try {
      const validation = this.validateRFQ(request);
      if (!validation.valid) {
        this.decline(request.rfqId, validation.reason!);
        return;
      }

      const chainId = request.chainId || HASHFLOW_CHAIN_IDS[request.chain] || 0;
      if (!chainId) {
        this.decline(request.rfqId, `Unsupported chain: ${request.chain}`);
        return;
      }

      const deluthiumQuote = await this.getDeluthiumQuote(request, chainId);
      if (!deluthiumQuote) {
        this.decline(request.rfqId, 'No Deluthium quote available');
        return;
      }

      const response = await this.buildResponse(request, deluthiumQuote, chainId);
      if (!response) {
        this.decline(request.rfqId, 'Failed to build quote response');
        return;
      }

      this.wsClient.sendRFQResponse(response);
      this.emit('rfqResponded', response as never);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.decline(request.rfqId, error.message);
      this.emit('error', error as never);
    }
  }

  // ─── Event Handling ───────────────────────────────────────────────

  on<K extends keyof RFQEvents>(event: K, handler: RFQEvents[K]): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as RFQEventHandler<never>);
  }

  off<K extends keyof RFQEvents>(event: K, handler: RFQEvents[K]): void {
    this.listeners.get(event)?.delete(handler as RFQEventHandler<never>);
  }

  // ─── Internal ─────────────────────────────────────────────────────

  private validateRFQ(
    request: HashflowRFQRequest,
  ): { valid: boolean; reason?: string } {
    if (!request.rfqId) {
      return { valid: false, reason: 'Missing rfqId' };
    }
    if (!request.baseToken || !request.quoteToken) {
      return { valid: false, reason: 'Missing token addresses' };
    }
    if (!request.baseTokenAmount && !request.quoteTokenAmount) {
      return { valid: false, reason: 'Missing trade amount' };
    }
    if (!request.trader) {
      return { valid: false, reason: 'Missing trader address' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (request.responseDeadline && now > request.responseDeadline) {
      return { valid: false, reason: 'RFQ response deadline has passed' };
    }

    return { valid: true };
  }

  private async getDeluthiumQuote(
    request: HashflowRFQRequest,
    chainId: number,
  ): Promise<FirmQuoteResponse | null> {
    try {
      const signerAddress = await this.signer.getAddress();

      let tokenIn: string;
      let tokenOut: string;
      let amountIn: string;

      if (request.tradeDirection === 'sell') {
        tokenIn = request.baseToken;
        tokenOut = request.quoteToken;
        amountIn = request.baseTokenAmount ?? '0';
      } else {
        tokenIn = request.quoteToken;
        tokenOut = request.baseToken;
        amountIn = request.quoteTokenAmount ?? '0';
      }

      const firmQuoteRequest: FirmQuoteRequest = {
        src_chain_id: chainId,
        dst_chain_id: chainId,
        from_address: signerAddress,
        to_address: request.trader,
        token_in: tokenIn,
        token_out: tokenOut,
        amount_in: amountIn,
        slippage: DEFAULT_SLIPPAGE_PERCENT,
        expiry_time_sec: this.maxQuoteExpirySec,
      };

      return await this.deluthiumClient.getFirmQuote(firmQuoteRequest);
    } catch {
      return null;
    }
  }

  private async buildResponse(
    request: HashflowRFQRequest,
    deluthiumQuote: FirmQuoteResponse,
    chainId: number,
  ): Promise<HashflowRFQResponse | null> {
    try {
      const signerAddress = (await this.signer.getAddress()) as Address;
      const poolAddress = this.poolAddresses[chainId] ?? signerAddress;
      const txid = generateTxid();
      const nonce = generateHashflowNonce();
      const quoteExpiry = Math.floor(Date.now() / 1000) + this.maxQuoteExpirySec;

      let baseTokenAmount: string;
      let quoteTokenAmount: string;

      if (request.tradeDirection === 'sell') {
        baseTokenAmount = deluthiumQuote.amount_in;
        quoteTokenAmount = deluthiumQuote.amount_out;
      } else {
        baseTokenAmount = deluthiumQuote.amount_out;
        quoteTokenAmount = deluthiumQuote.amount_in;
      }

      const quoteData: HashflowQuoteData = {
        pool: poolAddress,
        externalAccount: request.trader,
        effectiveTrader: request.effectiveTrader ?? request.trader,
        baseToken: request.baseToken,
        quoteToken: request.quoteToken,
        baseTokenAmount: BigInt(baseTokenAmount),
        quoteTokenAmount: BigInt(quoteTokenAmount),
        nonce,
        txid,
        quoteExpiry,
      };

      const signature = await signHashflowQuote(this.signer, quoteData);

      const response: HashflowRFQResponse = {
        rfqId: request.rfqId,
        chain: request.chain,
        baseToken: request.baseToken,
        quoteToken: request.quoteToken,
        baseTokenAmount,
        quoteTokenAmount,
        quoteExpiry,
        signature,
        signerAddress,
        pool: poolAddress,
        nonce: nonce.toString(),
        txid,
      };

      if (request.isCrossChain && request.dstChain) {
        return { ...response, dstChain: request.dstChain };
      }

      return response;
    } catch {
      return null;
    }
  }

  private decline(rfqId: string, reason: string): void {
    this.emit('rfqDeclined', { rfqId, reason } as never);
  }

  private emit(event: string, data: never): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          void handler(data);
        } catch {
          // Don't let handler errors break the event loop
        }
      }
    }
  }
}
