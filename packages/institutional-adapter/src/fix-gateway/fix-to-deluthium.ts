/**
 * FIX-to-Deluthium Bridge
 *
 * Translates FIX QuoteRequest / NewOrderSingle messages into Deluthium
 * RFQ API calls. Returns results as FIX Quote / ExecutionReport messages.
 *
 * Flow:
 *   FIX QuoteRequest (R) -> Deluthium getIndicativeQuote -> FIX Quote (S)
 *   FIX NewOrderSingle (D) with QuoteID -> Deluthium getFirmQuote -> FIX ExecutionReport (8)
 */

import {
  DeluthiumRestClient,
  type DeluthiumClientConfig,
  type ISigner,
  type IndicativeQuoteResponse,
  type FirmQuoteResponse,
} from '@deluthium/sdk';

import type {
  FIXMessage,
  FIXQuoteFields,
  FIXExecutionReportFields,
  TokenMapping,
  CounterpartyConfig,
} from '../types.js';
import { FIXMsgType, FIXOrdStatus, FIXSide } from '../types.js';
import {
  extractQuoteRequestFields,
  extractNewOrderSingleFields,
  buildQuoteMessage,
  buildExecutionReport,
  buildBusinessRejectMessage,
  formatFIXTimestamp,
  generateFIXId,
} from './fix-messages.js';
import type { ManagedSession } from './session-manager.js';

// ============================================================================
// Quote Cache
// ============================================================================

interface CachedQuote {
  quoteId: string;
  indicative: IndicativeQuoteResponse;
  firm?: FirmQuoteResponse;
  symbol: string;
  side: FIXSide;
  quantity: string;
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  expiresAt: number;
  counterpartyId: string;
}

// ============================================================================
// FIX to Deluthium Bridge
// ============================================================================

export class FIXToDeluthiumBridge {
  private readonly client: DeluthiumRestClient;
  private readonly signer: ISigner;
  private readonly defaultChainId: number;
  private readonly tokenMappings: Map<string, TokenMapping>;
  private readonly counterparties: Map<string, CounterpartyConfig>;
  private readonly quoteCache = new Map<string, CachedQuote>();
  private readonly quoteValiditySec: number;
  constructor(
    deluthiumConfig: DeluthiumClientConfig,
    signer: ISigner,
    tokenMappings: TokenMapping[],
    counterparties: Record<string, CounterpartyConfig>,
    options?: {
      defaultChainId?: number;
      quoteValiditySec?: number;
    },
  ) {
    this.client = new DeluthiumRestClient(deluthiumConfig);
    this.signer = signer;
    this.defaultChainId = options?.defaultChainId ?? deluthiumConfig.chainId;
    this.quoteValiditySec = options?.quoteValiditySec ?? 30;

    this.tokenMappings = new Map();
    for (const tm of tokenMappings) {
      this.tokenMappings.set(tm.symbol.toUpperCase(), tm);
    }

    this.counterparties = new Map();
    for (const [id, config] of Object.entries(counterparties)) {
      this.counterparties.set(id, config);
      if (config.fixCompID) {
        this.counterparties.set(config.fixCompID, config);
      }
    }
  }

  /**
   * Handle an incoming FIX application message.
   * Routes to the appropriate handler based on MsgType.
   *
   * @returns Raw FIX response message to send back, or null if no response needed
   */
  async handleFIXMessage(
    msg: FIXMessage,
    session: ManagedSession,
  ): Promise<string | null> {
    switch (msg.msgType) {
      case FIXMsgType.QuoteRequest:
        return this.handleQuoteRequest(msg, session);

      case FIXMsgType.NewOrderSingle:
        return this.handleNewOrderSingle(msg, session);

      case FIXMsgType.QuoteCancel:
        return this.handleQuoteCancel(msg, session);

      case FIXMsgType.SecurityListRequest:
        return this.handleSecurityListRequest(msg, session);

      default:
        return this.buildBusinessReject(
          msg,
          session,
          3, // Unsupported Message Type
          `Unsupported message type: ${msg.msgType}`,
        );
    }
  }

  /**
   * Get cached quote by ID.
   */
  getCachedQuote(quoteId: string): CachedQuote | undefined {
    return this.quoteCache.get(quoteId);
  }

  // ─── QuoteRequest Handler ──────────────────────────────────────────────

  private async handleQuoteRequest(
    msg: FIXMessage,
    session: ManagedSession,
  ): Promise<string | null> {
    const fields = extractQuoteRequestFields(msg);

    // Resolve symbol to tokens
    const { tokenIn, tokenOut, chainId } = this.resolveSymbol(fields.symbol, fields.side);
    if (!tokenIn || !tokenOut) {
      return this.buildBusinessReject(
        msg,
        session,
        2, // Unknown Symbol
        `Cannot resolve symbol ${fields.symbol} to token addresses`,
      );
    }

    try {
      // Get indicative quote from Deluthium
      const indicative = await this.client.getIndicativeQuote({
        src_chain_id: chainId,
        dst_chain_id: chainId,
        token_in: tokenIn,
        token_out: tokenOut,
        amount_in: fields.orderQty,
        side: fields.side === FIXSide.Buy ? 'buy' : 'sell',
      });

      // Cache the quote
      const quoteId = generateFIXId('QTE');
      const expiresAt = Date.now() + this.quoteValiditySec * 1000;

      this.quoteCache.set(quoteId, {
        quoteId,
        indicative,
        symbol: fields.symbol,
        side: fields.side,
        quantity: fields.orderQty,
        chainId,
        tokenIn,
        tokenOut,
        expiresAt,
        counterpartyId: msg.senderCompID,
      });

      // Schedule cache cleanup
      setTimeout(() => this.quoteCache.delete(quoteId), this.quoteValiditySec * 1000 + 5000);

      // Build FIX Quote response
      const now = formatFIXTimestamp(new Date());
      const validUntil = formatFIXTimestamp(new Date(expiresAt));

      const quoteFields: FIXQuoteFields = {
        quoteReqID: fields.quoteReqID,
        quoteID: quoteId,
        symbol: fields.symbol,
        transactTime: now,
        validUntilTime: validUntil,
        quoteType: '1', // Tradeable
      };

      // Set bid/offer based on side
      if (fields.side === FIXSide.Buy) {
        quoteFields.offerPx = indicative.price;
        quoteFields.offerSize = indicative.amount_out;
      } else {
        quoteFields.bidPx = indicative.price;
        quoteFields.bidSize = indicative.amount_out;
      }

      return buildQuoteMessage(
        session.config.fixVersion,
        session.config.senderCompID,
        session.config.targetCompID,
        session.nextOutSeqNum(),
        quoteFields,
      );
    } catch (err) {
      return this.buildBusinessReject(
        msg,
        session,
        4, // Application not available
        `Deluthium quote failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ─── NewOrderSingle Handler ────────────────────────────────────────────

  private async handleNewOrderSingle(
    msg: FIXMessage,
    session: ManagedSession,
  ): Promise<string> {
    const fields = extractNewOrderSingleFields(msg);
    const now = formatFIXTimestamp(new Date());

    // Check for previously quoted order (using QuoteID)
    if (fields.quoteID) {
      const cached = this.quoteCache.get(fields.quoteID);
      if (!cached) {
        return this.buildExecutionReportReject(
          session, fields.clOrdID, fields.symbol, fields.side, now,
          'Quote not found or expired',
        );
      }

      // Check quote expiry
      if (Date.now() > cached.expiresAt) {
        this.quoteCache.delete(fields.quoteID);
        return this.buildExecutionReportReject(
          session, fields.clOrdID, fields.symbol, fields.side, now,
          'Quote has expired',
        );
      }

      try {
        // Get firm quote from Deluthium
        const counterparty = this.counterparties.get(msg.senderCompID);
        const walletAddress = counterparty?.walletAddress ?? await this.signer.getAddress();

        const firm = await this.client.getFirmQuote({
          src_chain_id: cached.chainId,
          dst_chain_id: cached.chainId,
          from_address: walletAddress,
          to_address: walletAddress,
          token_in: cached.tokenIn,
          token_out: cached.tokenOut,
          amount_in: cached.quantity,
          slippage: 0.5,
          expiry_time_sec: this.quoteValiditySec,
        });

        // Update cache with firm quote
        cached.firm = firm;

        // Build filled execution report
        const execFields: FIXExecutionReportFields = {
          orderID: firm.quote_id,
          execID: generateFIXId('EXC'),
          execType: '2', // Trade
          ordStatus: FIXOrdStatus.Filled,
          symbol: cached.symbol,
          side: cached.side,
          leavesQty: '0',
          cumQty: fields.orderQty,
          avgPx: cached.indicative.price,
          lastQty: fields.orderQty,
          lastPx: cached.indicative.price,
          transactTime: now,
        };

        return buildExecutionReport(
          session.config.fixVersion,
          session.config.senderCompID,
          session.config.targetCompID,
          session.nextOutSeqNum(),
          execFields,
        );
      } catch (err) {
        return this.buildExecutionReportReject(
          session, fields.clOrdID, fields.symbol, fields.side, now,
          `Firm quote failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // No QuoteID -- reject
    return this.buildExecutionReportReject(
      session, fields.clOrdID, fields.symbol, fields.side, now,
      'NewOrderSingle requires a QuoteID (previously quoted orders only)',
    );
  }

  // ─── QuoteCancel Handler ───────────────────────────────────────────────

  private handleQuoteCancel(
    msg: FIXMessage,
    _session: ManagedSession,
  ): string | null {
    const quoteID = msg.fields.get(117);
    if (quoteID) {
      this.quoteCache.delete(quoteID);
    }
    // QuoteCancel does not require a response per FIX spec
    return null;
  }

  // ─── SecurityListRequest Handler ───────────────────────────────────────

  private async handleSecurityListRequest(
    msg: FIXMessage,
    session: ManagedSession,
  ): Promise<string> {
    const reqId = msg.fields.get(320) ?? generateFIXId('SLR');

    // Build security list from token mappings
    // We'll use a simplified representation
    const symbols: string[] = [];
    const tokenArray = Array.from(this.tokenMappings.values());

    // Generate pairs from available tokens
    const quoteSymbols = ['USDT', 'USDC', 'BUSD'];
    for (const token of tokenArray) {
      if (!quoteSymbols.includes(token.symbol.toUpperCase())) {
        for (const qs of quoteSymbols) {
          if (this.tokenMappings.has(qs.toUpperCase())) {
            symbols.push(`${token.symbol}/${qs}`);
          }
        }
      }
    }

    // Build Security List response (MsgType y)
    const { FIXMessageBuilder } = await import('./fix-messages.js');
    const builder = new FIXMessageBuilder(
      session.config.fixVersion,
      FIXMsgType.SecurityList,
      session.config.senderCompID,
      session.config.targetCompID,
      session.nextOutSeqNum(),
    );

    builder.setField(320, reqId); // SecurityReqID
    builder.setField(322, generateFIXId('SL')); // SecurityResponseID
    builder.setField(560, 0); // SecurityRequestResult = ValidRequest
    builder.setField(146, symbols.length); // NoRelatedSym

    // Note: In a full implementation, each symbol would be a repeating group.
    // For simplicity, we encode them as a text field.
    builder.setField(58, symbols.join(',')); // Text with available symbols

    return builder.build();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  /**
   * Resolve a FIX symbol (e.g. "BTC/USDT") into Deluthium token addresses.
   */
  private resolveSymbol(
    symbol: string,
    side: FIXSide,
  ): { tokenIn: string; tokenOut: string; chainId: number } {
    const parts = symbol.split('/');
    if (parts.length !== 2) {
      return { tokenIn: '', tokenOut: '', chainId: this.defaultChainId };
    }

    const [base, quote] = parts;
    const baseMapping = this.tokenMappings.get(base!.toUpperCase());
    const quoteMapping = this.tokenMappings.get(quote!.toUpperCase());

    if (!baseMapping || !quoteMapping) {
      return { tokenIn: '', tokenOut: '', chainId: this.defaultChainId };
    }

    const chainId = this.defaultChainId;
    const baseAddress = baseMapping.addresses[chainId];
    const quoteAddress = quoteMapping.addresses[chainId];

    if (!baseAddress || !quoteAddress) {
      return { tokenIn: '', tokenOut: '', chainId };
    }

    // Buy side: paying quote to get base (tokenIn=quote, tokenOut=base)
    // Sell side: paying base to get quote (tokenIn=base, tokenOut=quote)
    if (side === FIXSide.Buy) {
      return { tokenIn: quoteAddress, tokenOut: baseAddress, chainId };
    } else {
      return { tokenIn: baseAddress, tokenOut: quoteAddress, chainId };
    }
  }

  private buildBusinessReject(
    msg: FIXMessage,
    session: ManagedSession,
    reason: number,
    text: string,
  ): string {
    return buildBusinessRejectMessage(
      session.config.fixVersion,
      session.config.senderCompID,
      session.config.targetCompID,
      session.nextOutSeqNum(),
      msg.msgSeqNum,
      msg.msgType,
      reason,
      text,
    );
  }

  private buildExecutionReportReject(
    session: ManagedSession,
    clOrdID: string,
    symbol: string,
    side: FIXSide,
    transactTime: string,
    text: string,
  ): string {
    const fields: FIXExecutionReportFields = {
      orderID: clOrdID,
      execID: generateFIXId('EXC'),
      execType: '8', // Rejected
      ordStatus: FIXOrdStatus.Rejected,
      symbol,
      side,
      leavesQty: '0',
      cumQty: '0',
      avgPx: '0',
      transactTime,
      text,
    };

    return buildExecutionReport(
      session.config.fixVersion,
      session.config.senderCompID,
      session.config.targetCompID,
      session.nextOutSeqNum(),
      fields,
    );
  }
}
