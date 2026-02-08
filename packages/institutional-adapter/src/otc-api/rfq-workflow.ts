/**
 * Multi-Step RFQ Workflow Engine
 *
 * Manages the lifecycle of OTC RFQ requests:
 *   Request -> Quote -> Accept/Reject -> Execute -> Settle
 *
 * Integrates with:
 * - Deluthium SDK for pricing and firm quotes
 * - Audit trail for compliance logging
 * - WebSocket notifications for real-time updates
 *
 * Thread-safe: each RFQ has its own state machine with transition guards.
 */

import {
  DeluthiumRestClient,
  type DeluthiumClientConfig,
  type ISigner,
} from '@deluthium/sdk';

import type {
  OTCRFQRequest,
  OTCQuoteResponse,
  OTCTradeRecord,
  TokenMapping,
  CounterpartyConfig,
} from '../types.js';
import { RFQStatus } from '../types.js';
import { AuditTrail } from './audit-trail.js';

// ============================================================================
// Workflow Events
// ============================================================================

type WorkflowEventHandler<T extends unknown[]> = (...args: T) => void;

interface WorkflowEventMap {
  quoteGenerated: WorkflowEventHandler<[quote: OTCQuoteResponse]>;
  quoteAccepted: WorkflowEventHandler<[quoteId: string, counterpartyId: string]>;
  quoteRejected: WorkflowEventHandler<[quoteId: string, counterpartyId: string, reason?: string]>;
  quoteExpired: WorkflowEventHandler<[quoteId: string]>;
  tradeExecuted: WorkflowEventHandler<[trade: OTCTradeRecord]>;
  tradeSettled: WorkflowEventHandler<[tradeId: string]>;
  tradeFailed: WorkflowEventHandler<[tradeId: string, error: string]>;
  error: WorkflowEventHandler<[error: Error]>;
}

// ============================================================================
// RFQ Workflow Manager
// ============================================================================

export class RFQWorkflowManager {
  private readonly client: DeluthiumRestClient;
  private readonly signer: ISigner;
  private readonly auditTrail: AuditTrail;
  private readonly defaultChainId: number;
  private readonly defaultQuoteValiditySec: number;
  private readonly defaultFeeRateBps: number;

  private readonly tokenMappings: Map<string, TokenMapping>;
  private readonly counterparties: Map<string, CounterpartyConfig>;

  /** Active RFQ requests indexed by requestId */
  private readonly activeRequests = new Map<string, OTCRFQRequest>();
  /** Generated quotes indexed by quoteId */
  private readonly activeQuotes = new Map<string, OTCQuoteResponse>();
  /** Executed trades indexed by tradeId */
  private readonly trades = new Map<string, OTCTradeRecord>();

  /** Request-to-quote mapping */
  private readonly requestToQuote = new Map<string, string>();

  private readonly listeners = new Map<string, Set<WorkflowEventHandler<never[]>>>();

  /** Counter for generating unique IDs */
  private idCounter = 0;

  constructor(config: {
    deluthiumConfig: DeluthiumClientConfig;
    signer: ISigner;
    auditTrail: AuditTrail;
    tokenMappings: TokenMapping[];
    counterparties: Record<string, CounterpartyConfig>;
    defaultChainId: number;
    defaultQuoteValiditySec?: number;
    defaultFeeRateBps?: number;
  }) {
    this.client = new DeluthiumRestClient(config.deluthiumConfig);
    this.signer = config.signer;
    this.auditTrail = config.auditTrail;
    this.defaultChainId = config.defaultChainId;
    this.defaultQuoteValiditySec = config.defaultQuoteValiditySec ?? 30;
    this.defaultFeeRateBps = config.defaultFeeRateBps ?? 5;

    this.tokenMappings = new Map();
    for (const tm of config.tokenMappings) {
      this.tokenMappings.set(tm.symbol.toUpperCase(), tm);
    }

    this.counterparties = new Map();
    for (const [id, cp] of Object.entries(config.counterparties)) {
      this.counterparties.set(id, cp);
    }
  }

  // ─── RFQ Lifecycle ────────────────────────────────────────────────────

  /**
   * Submit a new RFQ request and generate a quote.
   *
   * @returns The generated quote response
   * @throws Error if counterparty is unknown or tokens cannot be resolved
   */
  async submitRFQ(request: OTCRFQRequest): Promise<OTCQuoteResponse> {
    // Validate counterparty
    const counterparty = this.counterparties.get(request.counterpartyId);
    if (!counterparty || !counterparty.active) {
      throw new Error(`Unknown or inactive counterparty: ${request.counterpartyId}`);
    }

    // Validate pair
    if (counterparty.enabledPairs?.length) {
      const pair = `${request.baseToken}/${request.quoteToken}`;
      if (!counterparty.enabledPairs.includes(pair)) {
        throw new Error(`Pair ${pair} not enabled for counterparty ${request.counterpartyId}`);
      }
    }

    // Log RFQ received
    await this.auditTrail.logRFQReceived({
      requestId: request.requestId,
      counterpartyId: request.counterpartyId,
      description: `RFQ: ${request.side} ${request.quantity} ${request.baseToken}/${request.quoteToken}`,
      data: {
        side: request.side,
        quantity: request.quantity,
        baseToken: request.baseToken,
        quoteToken: request.quoteToken,
        settlement: request.settlement,
      },
    });

    // Store request
    this.activeRequests.set(request.requestId, request);

    // Resolve tokens
    const { tokenIn, tokenOut, chainId } = this.resolveTokens(request);

    try {
      // Get indicative quote from Deluthium
      const indicative = await this.client.getIndicativeQuote({
        src_chain_id: chainId,
        dst_chain_id: chainId,
        token_in: tokenIn,
        token_out: tokenOut,
        amount_in: request.quantity,
        side: request.side,
      });

      // Determine fee rate
      const feeRateBps = counterparty.feeRateBps ?? this.defaultFeeRateBps;
      const notional = indicative.amount_out;
      const feeAmount = this.calculateFee(notional, feeRateBps);

      // Build quote
      const quoteValiditySec = request.quoteValiditySec ?? this.defaultQuoteValiditySec;
      const expiresAt = new Date(Date.now() + quoteValiditySec * 1000).toISOString();
      const quoteId = this.generateId('QTE');

      const quote: OTCQuoteResponse = {
        requestId: request.requestId,
        quoteId,
        counterpartyId: request.counterpartyId,
        status: RFQStatus.Quoted,
        price: indicative.price,
        quantity: request.quantity,
        notional,
        feeRateBps,
        feeAmount,
        expiresAt,
        createdAt: new Date().toISOString(),
      };

      // Store mappings
      this.activeQuotes.set(quoteId, quote);
      this.requestToQuote.set(request.requestId, quoteId);

      // Schedule expiry
      setTimeout(() => this.expireQuote(quoteId), quoteValiditySec * 1000);

      // Audit
      await this.auditTrail.logQuoteGenerated({
        requestId: request.requestId,
        quoteId,
        counterpartyId: request.counterpartyId,
        description: `Quote: ${indicative.price} for ${request.quantity} ${request.baseToken}/${request.quoteToken}`,
        data: {
          price: indicative.price,
          notional,
          feeRateBps,
          feeAmount,
          expiresAt,
        },
      });

      this.emit('quoteGenerated', quote);
      return quote;
    } catch (err) {
      await this.auditTrail.logError({
        description: 'Failed to generate quote',
        error: err instanceof Error ? err : new Error(String(err)),
        relatedIds: {
          requestId: request.requestId,
          counterpartyId: request.counterpartyId,
        },
      });
      throw err;
    }
  }

  /**
   * Accept a previously generated quote.
   * Triggers firm quote and on-chain execution (if applicable).
   */
  async acceptQuote(quoteId: string): Promise<OTCTradeRecord> {
    const quote = this.activeQuotes.get(quoteId);
    if (!quote) {
      throw new Error(`Quote not found: ${quoteId}`);
    }

    if (quote.status !== RFQStatus.Quoted) {
      throw new Error(`Quote ${quoteId} is not in Quoted status (current: ${quote.status})`);
    }

    // Check expiry
    if (new Date(quote.expiresAt).getTime() < Date.now()) {
      quote.status = RFQStatus.Expired;
      throw new Error(`Quote ${quoteId} has expired`);
    }

    // Transition to Accepted
    quote.status = RFQStatus.Accepted;

    await this.auditTrail.logQuoteAccepted({
      requestId: quote.requestId,
      quoteId,
      counterpartyId: quote.counterpartyId,
      description: `Quote ${quoteId} accepted by ${quote.counterpartyId}`,
    });

    this.emit('quoteAccepted', quoteId, quote.counterpartyId);

    // Get the original request for token info
    const request = this.activeRequests.get(quote.requestId);
    if (!request) {
      throw new Error(`Original request ${quote.requestId} not found`);
    }

    try {
      // Get firm quote for on-chain execution
      const { tokenIn, tokenOut, chainId } = this.resolveTokens(request);
      const counterparty = this.counterparties.get(request.counterpartyId);
      const walletAddress = counterparty?.walletAddress ?? await this.signer.getAddress();

      if (request.settlement === 'on-chain') {
        const firmQuote = await this.client.getFirmQuote({
          src_chain_id: chainId,
          dst_chain_id: chainId,
          from_address: walletAddress,
          to_address: walletAddress,
          token_in: tokenIn,
          token_out: tokenOut,
          amount_in: request.quantity,
          slippage: request.maxSlippage ?? 0.5,
          expiry_time_sec: this.defaultQuoteValiditySec,
        });

        // Store on-chain data in quote
        quote.onChainData = {
          chainId,
          routerAddress: firmQuote.router_address,
          calldata: firmQuote.calldata,
          firmQuoteId: firmQuote.quote_id,
        };
      }

      // Create trade record
      const tradeId = this.generateId('TRD');
      const trade: OTCTradeRecord = {
        tradeId,
        quoteId,
        requestId: quote.requestId,
        counterpartyId: quote.counterpartyId,
        baseToken: request.baseToken,
        quoteToken: request.quoteToken,
        side: request.side,
        price: quote.price,
        quantity: quote.quantity,
        notional: quote.notional,
        feeAmount: quote.feeAmount,
        executedAt: new Date().toISOString(),
        settlementStatus: request.settlement === 'on-chain' ? 'pending' : 'settling',
        chainId: request.chainId,
      };

      this.trades.set(tradeId, trade);
      quote.status = RFQStatus.Executed;

      await this.auditTrail.logTradeExecuted({
        requestId: quote.requestId,
        quoteId,
        tradeId,
        counterpartyId: quote.counterpartyId,
        description: `Trade executed: ${request.side} ${request.quantity} ${request.baseToken}/${request.quoteToken} @ ${quote.price}`,
        data: {
          price: quote.price,
          notional: quote.notional,
          feeAmount: quote.feeAmount,
          settlement: request.settlement,
        },
      });

      this.emit('tradeExecuted', trade);
      return trade;
    } catch (err) {
      quote.status = RFQStatus.Failed;
      await this.auditTrail.logTradeFailed({
        tradeId: 'N/A',
        counterpartyId: quote.counterpartyId,
        description: 'Trade execution failed',
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Reject a previously generated quote.
   */
  async rejectQuote(quoteId: string, reason?: string): Promise<void> {
    const quote = this.activeQuotes.get(quoteId);
    if (!quote) {
      throw new Error(`Quote not found: ${quoteId}`);
    }

    if (quote.status !== RFQStatus.Quoted) {
      throw new Error(`Quote ${quoteId} is not in Quoted status (current: ${quote.status})`);
    }

    quote.status = RFQStatus.Rejected;

    await this.auditTrail.logQuoteRejected({
      requestId: quote.requestId,
      quoteId,
      counterpartyId: quote.counterpartyId,
      description: `Quote ${quoteId} rejected${reason ? `: ${reason}` : ''}`,
      reason,
    });

    this.emit('quoteRejected', quoteId, quote.counterpartyId, reason);
  }

  /**
   * Cancel an active RFQ request.
   */
  async cancelRFQ(requestId: string): Promise<void> {
    const quoteId = this.requestToQuote.get(requestId);
    if (quoteId) {
      const quote = this.activeQuotes.get(quoteId);
      if (quote && quote.status === RFQStatus.Quoted) {
        quote.status = RFQStatus.Cancelled;
      }
    }
    this.activeRequests.delete(requestId);
  }

  /**
   * Mark a trade as settled.
   */
  async settleTrade(tradeId: string, txHash?: string): Promise<void> {
    const trade = this.trades.get(tradeId);
    if (!trade) {
      throw new Error(`Trade not found: ${tradeId}`);
    }

    trade.settlementStatus = 'settled';
    if (txHash) {
      trade.txHash = txHash;
    }

    await this.auditTrail.logTradeSettled({
      tradeId,
      counterpartyId: trade.counterpartyId,
      description: `Trade ${tradeId} settled${txHash ? ` (tx: ${txHash})` : ''}`,
      data: { txHash },
    });

    this.emit('tradeSettled', tradeId);
  }

  // ─── Query Methods ────────────────────────────────────────────────────

  /**
   * Get a quote by ID.
   */
  getQuote(quoteId: string): OTCQuoteResponse | undefined {
    return this.activeQuotes.get(quoteId);
  }

  /**
   * Get a trade by ID.
   */
  getTrade(tradeId: string): OTCTradeRecord | undefined {
    return this.trades.get(tradeId);
  }

  /**
   * Get all active quotes for a counterparty.
   */
  getActiveQuotes(counterpartyId?: string): OTCQuoteResponse[] {
    const quotes = Array.from(this.activeQuotes.values());
    if (counterpartyId) {
      return quotes.filter(
        (q) => q.counterpartyId === counterpartyId && q.status === RFQStatus.Quoted,
      );
    }
    return quotes.filter((q) => q.status === RFQStatus.Quoted);
  }

  /**
   * Get trade history for a counterparty.
   */
  getTradeHistory(counterpartyId?: string, limit = 100): OTCTradeRecord[] {
    let trades = Array.from(this.trades.values());
    if (counterpartyId) {
      trades = trades.filter((t) => t.counterpartyId === counterpartyId);
    }
    return trades.slice(-limit);
  }

  /**
   * Get summary statistics.
   */
  getStats(): {
    activeRequests: number;
    activeQuotes: number;
    totalTrades: number;
    pendingSettlements: number;
  } {
    return {
      activeRequests: this.activeRequests.size,
      activeQuotes: Array.from(this.activeQuotes.values()).filter(
        (q) => q.status === RFQStatus.Quoted,
      ).length,
      totalTrades: this.trades.size,
      pendingSettlements: Array.from(this.trades.values()).filter(
        (t) => t.settlementStatus === 'pending' || t.settlementStatus === 'settling',
      ).length,
    };
  }

  // ─── Event System ─────────────────────────────────────────────────────

  on<K extends keyof WorkflowEventMap>(event: K, handler: WorkflowEventMap[K]): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as WorkflowEventHandler<never[]>);
  }

  off<K extends keyof WorkflowEventMap>(event: K, handler: WorkflowEventMap[K]): void {
    this.listeners.get(event)?.delete(handler as WorkflowEventHandler<never[]>);
  }

  // ─── Internal Helpers ─────────────────────────────────────────────────

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          (handler as (...a: unknown[]) => void)(...args);
        } catch {
          /* skip */
        }
      }
    }
  }

  private expireQuote(quoteId: string): void {
    const quote = this.activeQuotes.get(quoteId);
    if (quote && quote.status === RFQStatus.Quoted) {
      quote.status = RFQStatus.Expired;
      void this.auditTrail.logQuoteExpired({
        requestId: quote.requestId,
        quoteId,
        counterpartyId: quote.counterpartyId,
        description: `Quote ${quoteId} expired`,
      });
      this.emit('quoteExpired', quoteId);
    }
  }

  private resolveTokens(request: OTCRFQRequest): {
    tokenIn: string;
    tokenOut: string;
    chainId: number;
  } {
    const chainId = request.chainId ?? this.defaultChainId;

    // If addresses are provided directly, use them
    if (request.baseTokenAddress && request.quoteTokenAddress) {
      if (request.side === 'buy') {
        return { tokenIn: request.quoteTokenAddress, tokenOut: request.baseTokenAddress, chainId };
      } else {
        return { tokenIn: request.baseTokenAddress, tokenOut: request.quoteTokenAddress, chainId };
      }
    }

    // Resolve from symbol mappings
    const baseMapping = this.tokenMappings.get(request.baseToken.toUpperCase());
    const quoteMapping = this.tokenMappings.get(request.quoteToken.toUpperCase());

    if (!baseMapping || !quoteMapping) {
      throw new Error(`Cannot resolve tokens: ${request.baseToken}/${request.quoteToken}`);
    }

    const baseAddress = baseMapping.addresses[chainId];
    const quoteAddress = quoteMapping.addresses[chainId];

    if (!baseAddress || !quoteAddress) {
      throw new Error(
        `Tokens ${request.baseToken}/${request.quoteToken} not available on chain ${chainId}`,
      );
    }

    if (request.side === 'buy') {
      return { tokenIn: quoteAddress, tokenOut: baseAddress, chainId };
    } else {
      return { tokenIn: baseAddress, tokenOut: quoteAddress, chainId };
    }
  }

  private calculateFee(notional: string, feeRateBps: number): string {
    try {
      const amount = BigInt(notional);
      const fee = (amount * BigInt(feeRateBps)) / 10000n;
      return fee.toString();
    } catch {
      // If notional is a decimal string, use floating point
      const amount = parseFloat(notional);
      return (amount * feeRateBps / 10000).toFixed(8);
    }
  }

  private generateId(prefix: string): string {
    this.idCounter++;
    const ts = Date.now().toString(36);
    const counter = this.idCounter.toString(36).padStart(4, '0');
    return `${prefix}-${ts}-${counter}`;
  }
}
