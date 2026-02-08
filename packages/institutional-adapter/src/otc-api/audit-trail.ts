/**
 * Audit Trail System
 *
 * Provides compliance-grade logging for all institutional trading activity.
 * Supports pluggable sinks (in-memory, file, database) via the AuditSink interface.
 *
 * Features:
 * - Structured, queryable audit entries
 * - Automatic ID generation and timestamping
 * - In-memory sink with retention policy (default implementation)
 * - Event correlation via related IDs
 */

import type { AuditEntry, AuditQueryFilter, AuditSink } from '../types.js';
import { AuditEventType } from '../types.js';

// ============================================================================
// In-Memory Audit Sink (Default)
// ============================================================================

/**
 * Default audit sink that stores entries in memory.
 * Suitable for development and testing. For production, implement a
 * persistent AuditSink (database, file, cloud logging).
 */
export class InMemoryAuditSink implements AuditSink {
  private entries: AuditEntry[] = [];
  private readonly maxEntries: number;
  private readonly retentionMs: number;

  constructor(options?: { maxEntries?: number; retentionHours?: number }) {
    this.maxEntries = options?.maxEntries ?? 100_000;
    this.retentionMs = (options?.retentionHours ?? 24) * 60 * 60 * 1000;
  }

  async write(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);

    // Enforce max entries
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  async query(filter: AuditQueryFilter): Promise<AuditEntry[]> {
    let results = this.entries;

    // Apply filters
    if (filter.eventTypes?.length) {
      const types = new Set(filter.eventTypes);
      results = results.filter((e) => types.has(e.eventType));
    }

    if (filter.actor) {
      results = results.filter((e) => e.actor === filter.actor);
    }

    if (filter.requestId) {
      results = results.filter((e) => e.relatedIds.requestId === filter.requestId);
    }

    if (filter.quoteId) {
      results = results.filter((e) => e.relatedIds.quoteId === filter.quoteId);
    }

    if (filter.tradeId) {
      results = results.filter((e) => e.relatedIds.tradeId === filter.tradeId);
    }

    if (filter.counterpartyId) {
      results = results.filter((e) => e.relatedIds.counterpartyId === filter.counterpartyId);
    }

    if (filter.startTime) {
      const start = new Date(filter.startTime).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() >= start);
    }

    if (filter.endTime) {
      const end = new Date(filter.endTime).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() <= end);
    }

    // Apply pagination
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    results = results.slice(offset, offset + limit);

    return results;
  }

  /**
   * Get total count of stored entries.
   */
  getCount(): number {
    return this.entries.length;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Remove entries older than retention period.
   */
  prune(): number {
    const cutoff = Date.now() - this.retentionMs;
    const before = this.entries.length;
    this.entries = this.entries.filter(
      (e) => new Date(e.timestamp).getTime() >= cutoff,
    );
    return before - this.entries.length;
  }
}

// ============================================================================
// Audit Trail Logger
// ============================================================================

/**
 * High-level audit trail logger.
 *
 * Provides convenience methods for logging specific event types with
 * proper structure and correlation IDs.
 *
 * @example
 * ```typescript
 * const audit = new AuditTrail();
 *
 * await audit.logRFQReceived({
 *   requestId: 'req-123',
 *   counterpartyId: 'WINTERMUTE',
 *   description: 'RFQ for 100 BTC/USDT',
 * });
 *
 * const entries = await audit.query({
 *   counterpartyId: 'WINTERMUTE',
 *   eventTypes: [AuditEventType.RFQReceived],
 * });
 * ```
 */
export class AuditTrail {
  private readonly sink: AuditSink;
  private eventCounter = 0;

  constructor(sink?: AuditSink) {
    this.sink = sink ?? new InMemoryAuditSink();
  }

  // ─── Convenience Logging Methods ──────────────────────────────────────

  async logRFQReceived(params: {
    requestId: string;
    counterpartyId: string;
    description: string;
    data?: Record<string, unknown>;
    sourceIp?: string;
  }): Promise<AuditEntry> {
    return this.log({
      eventType: AuditEventType.RFQReceived,
      actor: params.counterpartyId,
      description: params.description,
      relatedIds: {
        requestId: params.requestId,
        counterpartyId: params.counterpartyId,
      },
      data: params.data,
      sourceIp: params.sourceIp,
      severity: 'info',
    });
  }

  async logQuoteGenerated(params: {
    requestId: string;
    quoteId: string;
    counterpartyId: string;
    description: string;
    data?: Record<string, unknown>;
  }): Promise<AuditEntry> {
    return this.log({
      eventType: AuditEventType.QuoteGenerated,
      actor: 'system',
      description: params.description,
      relatedIds: {
        requestId: params.requestId,
        quoteId: params.quoteId,
        counterpartyId: params.counterpartyId,
      },
      data: params.data,
      severity: 'info',
    });
  }

  async logQuoteSent(params: {
    requestId: string;
    quoteId: string;
    counterpartyId: string;
    description: string;
    data?: Record<string, unknown>;
  }): Promise<AuditEntry> {
    return this.log({
      eventType: AuditEventType.QuoteSent,
      actor: 'system',
      description: params.description,
      relatedIds: {
        requestId: params.requestId,
        quoteId: params.quoteId,
        counterpartyId: params.counterpartyId,
      },
      data: params.data,
      severity: 'info',
    });
  }

  async logQuoteAccepted(params: {
    requestId: string;
    quoteId: string;
    counterpartyId: string;
    description: string;
    data?: Record<string, unknown>;
  }): Promise<AuditEntry> {
    return this.log({
      eventType: AuditEventType.QuoteAccepted,
      actor: params.counterpartyId,
      description: params.description,
      relatedIds: {
        requestId: params.requestId,
        quoteId: params.quoteId,
        counterpartyId: params.counterpartyId,
      },
      data: params.data,
      severity: 'info',
    });
  }

  async logQuoteRejected(params: {
    requestId: string;
    quoteId: string;
    counterpartyId: string;
    description: string;
    reason?: string;
  }): Promise<AuditEntry> {
    return this.log({
      eventType: AuditEventType.QuoteRejected,
      actor: params.counterpartyId,
      description: params.description,
      relatedIds: {
        requestId: params.requestId,
        quoteId: params.quoteId,
        counterpartyId: params.counterpartyId,
      },
      data: params.reason ? { reason: params.reason } : undefined,
      severity: 'info',
    });
  }

  async logQuoteExpired(params: {
    requestId: string;
    quoteId: string;
    counterpartyId: string;
    description: string;
  }): Promise<AuditEntry> {
    return this.log({
      eventType: AuditEventType.QuoteExpired,
      actor: 'system',
      description: params.description,
      relatedIds: {
        requestId: params.requestId,
        quoteId: params.quoteId,
        counterpartyId: params.counterpartyId,
      },
      severity: 'info',
    });
  }

  async logTradeExecuted(params: {
    requestId: string;
    quoteId: string;
    tradeId: string;
    counterpartyId: string;
    description: string;
    data?: Record<string, unknown>;
  }): Promise<AuditEntry> {
    return this.log({
      eventType: AuditEventType.TradeExecuted,
      actor: 'system',
      description: params.description,
      relatedIds: {
        requestId: params.requestId,
        quoteId: params.quoteId,
        tradeId: params.tradeId,
        counterpartyId: params.counterpartyId,
      },
      data: params.data,
      severity: 'info',
    });
  }

  async logTradeSettled(params: {
    tradeId: string;
    counterpartyId: string;
    description: string;
    data?: Record<string, unknown>;
  }): Promise<AuditEntry> {
    return this.log({
      eventType: AuditEventType.TradeSettled,
      actor: 'system',
      description: params.description,
      relatedIds: {
        tradeId: params.tradeId,
        counterpartyId: params.counterpartyId,
      },
      data: params.data,
      severity: 'info',
    });
  }

  async logTradeFailed(params: {
    tradeId: string;
    counterpartyId: string;
    description: string;
    error: string;
    data?: Record<string, unknown>;
  }): Promise<AuditEntry> {
    return this.log({
      eventType: AuditEventType.TradeFailed,
      actor: 'system',
      description: params.description,
      relatedIds: {
        tradeId: params.tradeId,
        counterpartyId: params.counterpartyId,
      },
      data: { ...params.data, error: params.error },
      severity: 'error',
    });
  }

  async logFIXLogon(params: {
    sessionId: string;
    counterpartyId: string;
    sourceIp?: string;
  }): Promise<AuditEntry> {
    return this.log({
      eventType: AuditEventType.FIXLogon,
      actor: params.counterpartyId,
      description: `FIX session logon: ${params.sessionId}`,
      relatedIds: {
        sessionId: params.sessionId,
        counterpartyId: params.counterpartyId,
      },
      sourceIp: params.sourceIp,
      severity: 'info',
    });
  }

  async logFIXLogout(params: {
    sessionId: string;
    counterpartyId: string;
    reason: string;
  }): Promise<AuditEntry> {
    return this.log({
      eventType: AuditEventType.FIXLogout,
      actor: params.counterpartyId,
      description: `FIX session logout: ${params.sessionId} -- ${params.reason}`,
      relatedIds: {
        sessionId: params.sessionId,
        counterpartyId: params.counterpartyId,
      },
      data: { reason: params.reason },
      severity: 'info',
    });
  }

  async logError(params: {
    description: string;
    error: Error | string;
    relatedIds?: AuditEntry['relatedIds'];
    data?: Record<string, unknown>;
  }): Promise<AuditEntry> {
    const errorMsg = params.error instanceof Error ? params.error.message : params.error;
    const errorStack = params.error instanceof Error ? params.error.stack : undefined;

    return this.log({
      eventType: AuditEventType.Error,
      actor: 'system',
      description: params.description,
      relatedIds: params.relatedIds ?? {},
      data: { ...params.data, error: errorMsg, stack: errorStack },
      severity: 'error',
    });
  }

  // ─── Query ────────────────────────────────────────────────────────────

  /**
   * Query audit entries with filtering.
   */
  async query(filter: AuditQueryFilter): Promise<AuditEntry[]> {
    return this.sink.query(filter);
  }

  /**
   * Get all entries for a specific counterparty.
   */
  async getCounterpartyHistory(counterpartyId: string, limit = 100): Promise<AuditEntry[]> {
    return this.query({ counterpartyId, limit });
  }

  /**
   * Get all entries related to a specific trade.
   */
  async getTradeHistory(tradeId: string): Promise<AuditEntry[]> {
    return this.query({ tradeId, limit: 1000 });
  }

  /**
   * Get all entries related to a specific RFQ.
   */
  async getRFQHistory(requestId: string): Promise<AuditEntry[]> {
    return this.query({ requestId, limit: 1000 });
  }

  // ─── Core Logging ─────────────────────────────────────────────────────

  /**
   * Log a raw audit entry.
   */
  async log(params: {
    eventType: AuditEventType;
    actor: string;
    description: string;
    relatedIds: AuditEntry['relatedIds'];
    data?: Record<string, unknown>;
    sourceIp?: string;
    severity: AuditEntry['severity'];
  }): Promise<AuditEntry> {
    const entry: AuditEntry = {
      eventId: this.generateEventId(),
      eventType: params.eventType,
      timestamp: new Date().toISOString(),
      actor: params.actor,
      description: params.description,
      relatedIds: params.relatedIds,
      data: params.data,
      sourceIp: params.sourceIp,
      severity: params.severity,
    };

    await this.sink.write(entry);
    return entry;
  }

  /**
   * Get the underlying sink (for testing or direct access).
   */
  getSink(): AuditSink {
    return this.sink;
  }

  private generateEventId(): string {
    this.eventCounter++;
    const ts = Date.now().toString(36);
    const counter = this.eventCounter.toString(36).padStart(4, '0');
    const random = Math.random().toString(36).substring(2, 6);
    return `aud-${ts}-${counter}-${random}`;
  }
}
