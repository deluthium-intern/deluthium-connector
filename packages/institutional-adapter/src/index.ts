/**
 * @deluthium/institutional-adapter
 *
 * Institutional MM adapter for Deluthium. Connects traditional finance market makers
 * (Wintermute, GSR, Jump Trading, Cumberland, B2C2) to Deluthium's RFQ liquidity
 * through three integration layers:
 *
 * **Layer 1 -- Aggregator Bridge**: Leverages existing 0x + 1inch adapters.
 *   Institutional MMs already use these protocols; Deluthium liquidity is
 *   automatically available to them through Phase 1C/1D adapters.
 *
 * **Layer 2 -- FIX Protocol Gateway**: Industry-standard financial messaging.
 *   FIX 4.4 TCP acceptor that translates QuoteRequest -> Deluthium firmQuote
 *   and NewOrderSingle -> on-chain execution.
 *
 * **Layer 3 -- Unified OTC API**: REST + WebSocket API for institutional RFQ.
 *   Multi-step workflow (request -> quote -> accept/reject -> execute -> settle)
 *   with full audit trail and compliance logging.
 *
 * @example
 * ```typescript
 * import {
 *   InstitutionalAdapter,
 *   RFQWorkflowManager,
 *   AuditTrail,
 *   FIXServer,
 *   OTCAPIServer,
 *   verify0xIntegration,
 *   verify1inchIntegration,
 * } from '@deluthium/institutional-adapter';
 * ```
 *
 * @packageDocumentation
 */

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  FIXVersion,
  FIXMessage,
  FIXQuoteRequestFields,
  FIXQuoteFields,
  FIXExecutionReportFields,
  FIXSessionConfig,
  FIXSessionState,
  FIXServerConfig,
  OTCRFQRequest,
  OTCQuoteResponse,
  OTCTradeRecord,
  AuditEntry,
  AuditQueryFilter,
  AuditSink,
  AggregatorVerificationResult,
  AggregatorCheck,
  TokenMapping,
  CounterpartyConfig,
  InstitutionalAdapterConfig,
  InstitutionalAdapterEvents,
  DeluthiumQuoteData,
} from './types.js';

export {
  FIXMsgType,
  FIXOrdStatus,
  FIXSide,
  FIXOrdType,
  FIXTimeInForce,
  RFQStatus,
  AuditEventType,
} from './types.js';

// ─── FIX Gateway ──────────────────────────────────────────────────────────────
export {
  parseFIXMessage,
  validateChecksum,
  FIXMessageBuilder,
  buildLogonMessage,
  buildHeartbeatMessage,
  buildLogoutMessage,
  buildQuoteMessage,
  buildExecutionReport,
  buildRejectMessage,
  buildBusinessRejectMessage,
  extractQuoteRequestFields,
  extractNewOrderSingleFields,
  formatFIXTimestamp,
  parseFIXTimestamp,
  generateFIXId,
  FIXParseError,
} from './fix-gateway/fix-messages.js';

export {
  FIXSessionManager,
  ManagedSession,
} from './fix-gateway/session-manager.js';

export {
  FIXServer,
} from './fix-gateway/fix-server.js';

export {
  FIXToDeluthiumBridge,
} from './fix-gateway/fix-to-deluthium.js';

// ─── OTC API ──────────────────────────────────────────────────────────────────
export {
  AuditTrail,
  InMemoryAuditSink,
} from './otc-api/audit-trail.js';

export {
  RFQWorkflowManager,
} from './otc-api/rfq-workflow.js';

export {
  OTCAPIServer,
} from './otc-api/server.js';

// ─── Aggregator Bridge ───────────────────────────────────────────────────────
export {
  verify0xIntegration,
} from './aggregator-bridge/verify-0x.js';

export {
  verify1inchIntegration,
} from './aggregator-bridge/verify-1inch.js';

// ─── Main Adapter (Orchestrator) ─────────────────────────────────────────────

import type {
  InstitutionalAdapterConfig,
  InstitutionalAdapterEvents,
  OTCRFQRequest,
  OTCQuoteResponse,
  OTCTradeRecord,
  AggregatorVerificationResult,
} from './types.js';
import { FIXServer } from './fix-gateway/fix-server.js';
import { FIXSessionManager } from './fix-gateway/session-manager.js';
import { FIXToDeluthiumBridge } from './fix-gateway/fix-to-deluthium.js';
import { AuditTrail, InMemoryAuditSink } from './otc-api/audit-trail.js';
import { RFQWorkflowManager } from './otc-api/rfq-workflow.js';
import { OTCAPIServer } from './otc-api/server.js';
import { verify0xIntegration } from './aggregator-bridge/verify-0x.js';
import { verify1inchIntegration } from './aggregator-bridge/verify-1inch.js';

type EventHandler<T extends unknown[]> = (...args: T) => void;

/**
 * Main orchestrator for the institutional adapter.
 *
 * Brings together all three layers:
 * 1. Aggregator Bridge (verification of 0x + 1inch paths)
 * 2. FIX Protocol Gateway (optional TCP server)
 * 3. OTC API (REST + WebSocket)
 *
 * @example
 * ```typescript
 * const adapter = new InstitutionalAdapter({
 *   deluthiumConfig: { auth: 'jwt-token', chainId: 56 },
 *   signer: new PrivateKeySigner('0x...'),
 *   counterparties: {
 *     wintermute: {
 *       id: 'wintermute',
 *       name: 'Wintermute',
 *       type: 'market-maker',
 *       apiKey: 'wm-api-key',
 *       defaultSettlement: 'on-chain',
 *       active: true,
 *     },
 *   },
 *   tokenMappings: [...],
 *   defaultChainId: 56,
 * });
 *
 * await adapter.start();
 * ```
 */
export class InstitutionalAdapter {
  private readonly config: InstitutionalAdapterConfig;
  private readonly auditTrail: AuditTrail;
  private readonly rfqWorkflow: RFQWorkflowManager;
  private readonly sessionManager: FIXSessionManager;
  private fixBridge: FIXToDeluthiumBridge | null = null;
  private fixServer: FIXServer | null = null;
  private otcServer: OTCAPIServer | null = null;
  private running = false;

  private readonly listeners = new Map<string, Set<EventHandler<never[]>>>();

  constructor(config: InstitutionalAdapterConfig) {
    this.config = config;

    // Initialize audit trail
    this.auditTrail = new AuditTrail(
      config.auditSink ?? new InMemoryAuditSink(),
    );

    // Initialize session manager
    this.sessionManager = new FIXSessionManager();

    // Initialize RFQ workflow
    this.rfqWorkflow = new RFQWorkflowManager({
      deluthiumConfig: config.deluthiumConfig,
      signer: config.signer,
      auditTrail: this.auditTrail,
      tokenMappings: config.tokenMappings,
      counterparties: config.counterparties,
      defaultChainId: config.defaultChainId,
      defaultQuoteValiditySec: config.defaultQuoteValiditySec,
      defaultFeeRateBps: config.defaultFeeRateBps,
    });

    // Wire up workflow events
    this.rfqWorkflow.on('quoteGenerated', ((quote: OTCQuoteResponse) => {
      this.emit('quoteGenerated', quote);
    }) as never);

    this.rfqWorkflow.on('quoteAccepted', ((quoteId: string, cpId: string) => {
      this.emit('quoteAccepted', quoteId, cpId);
    }) as never);

    this.rfqWorkflow.on('quoteRejected', ((quoteId: string, cpId: string, reason?: string) => {
      this.emit('quoteRejected', quoteId, cpId, reason);
    }) as never);

    this.rfqWorkflow.on('tradeExecuted', ((trade: OTCTradeRecord) => {
      this.emit('tradeExecuted', trade);
    }) as never);
  }

  /**
   * Start all configured services.
   */
  async start(): Promise<void> {
    if (this.running) return;

    // ── Start FIX Gateway (if configured) ──────────────────────────────
    if (this.config.fixConfig) {
      // Register sessions
      for (const [_compId, sessionConfig] of Object.entries(this.config.fixConfig.sessions)) {
        this.sessionManager.registerSession(sessionConfig);
      }

      // Create FIX-to-Deluthium bridge
      this.fixBridge = new FIXToDeluthiumBridge(
        this.config.deluthiumConfig,
        this.config.signer,
        this.config.tokenMappings,
        this.config.counterparties,
        {
          defaultChainId: this.config.defaultChainId,
          quoteValiditySec: this.config.defaultQuoteValiditySec,
        },
      );

      // Wire FIX messages to bridge
      this.sessionManager.on('message', (async (sessionId: string, msg: unknown) => {
        const session = this.sessionManager.getSession(sessionId);
        if (session && this.fixBridge) {
          const response = await this.fixBridge.handleFIXMessage(
            msg as import('./types.js').FIXMessage,
            session,
          );
          if (response) {
            session.sendRaw(response);
          }
        }
      }) as never);

      // Wire FIX session events to adapter events
      this.sessionManager.on('logon', ((sessionId: string) => {
        this.emit('fixSessionConnected', sessionId);
        void this.auditTrail.logFIXLogon({ sessionId, counterpartyId: sessionId });
      }) as never);

      this.sessionManager.on('logout', ((sessionId: string, reason: string) => {
        this.emit('fixSessionDisconnected', sessionId, reason);
        void this.auditTrail.logFIXLogout({ sessionId, counterpartyId: sessionId, reason });
      }) as never);

      // Start FIX server
      this.fixServer = new FIXServer(this.config.fixConfig, this.sessionManager);
      await this.fixServer.start();
    }

    // ── Start OTC API (if configured) ──────────────────────────────────
    if (this.config.otcApiConfig) {
      this.otcServer = new OTCAPIServer(
        {
          port: this.config.otcApiConfig.port,
          host: this.config.otcApiConfig.host,
          apiKeyHeader: this.config.otcApiConfig.apiKeyHeader,
          corsOrigins: this.config.otcApiConfig.corsOrigins,
        },
        this.rfqWorkflow,
        this.auditTrail,
        this.config.counterparties,
      );
      await this.otcServer.start();
    }

    this.running = true;
  }

  /**
   * Stop all services gracefully.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    // Stop OTC API server
    if (this.otcServer) {
      await this.otcServer.stop();
      this.otcServer = null;
    }

    // Stop FIX server
    if (this.fixServer) {
      await this.fixServer.stop();
      this.fixServer = null;
    }

    this.running = false;
  }

  /**
   * Whether the adapter is currently running.
   */
  get isRunning(): boolean {
    return this.running;
  }

  // ─── RFQ API (pass-through to workflow) ─────────────────────────────

  /**
   * Submit an OTC RFQ request.
   */
  async submitRFQ(request: OTCRFQRequest): Promise<OTCQuoteResponse> {
    return this.rfqWorkflow.submitRFQ(request);
  }

  /**
   * Accept a quote.
   */
  async acceptQuote(quoteId: string): Promise<OTCTradeRecord> {
    return this.rfqWorkflow.acceptQuote(quoteId);
  }

  /**
   * Reject a quote.
   */
  async rejectQuote(quoteId: string, reason?: string): Promise<void> {
    return this.rfqWorkflow.rejectQuote(quoteId, reason);
  }

  // ─── Verification ───────────────────────────────────────────────────

  /**
   * Verify the 0x aggregator integration path.
   */
  async verify0xPath(chainId?: number): Promise<AggregatorVerificationResult> {
    return verify0xIntegration(this.config.deluthiumConfig, chainId);
  }

  /**
   * Verify the 1inch aggregator integration path.
   */
  async verify1inchPath(chainId?: number): Promise<AggregatorVerificationResult> {
    return verify1inchIntegration(this.config.deluthiumConfig, chainId);
  }

  /**
   * Verify all aggregator integration paths.
   */
  async verifyAllPaths(chainId?: number): Promise<AggregatorVerificationResult[]> {
    const [zeroX, oneInch] = await Promise.allSettled([
      this.verify0xPath(chainId),
      this.verify1inchPath(chainId),
    ]);

    const results: AggregatorVerificationResult[] = [];

    if (zeroX.status === 'fulfilled') {
      results.push(zeroX.value);
    } else {
      results.push({
        aggregator: '0x',
        operational: false,
        checks: [],
        verifiedAt: new Date().toISOString(),
        latencyMs: 0,
        error: zeroX.reason instanceof Error ? zeroX.reason.message : String(zeroX.reason),
      });
    }

    if (oneInch.status === 'fulfilled') {
      results.push(oneInch.value);
    } else {
      results.push({
        aggregator: '1inch',
        operational: false,
        checks: [],
        verifiedAt: new Date().toISOString(),
        latencyMs: 0,
        error: oneInch.reason instanceof Error ? oneInch.reason.message : String(oneInch.reason),
      });
    }

    return results;
  }

  // ─── Accessors ──────────────────────────────────────────────────────

  /** Get the underlying audit trail. */
  getAuditTrail(): AuditTrail {
    return this.auditTrail;
  }

  /** Get the RFQ workflow manager. */
  getRFQWorkflow(): RFQWorkflowManager {
    return this.rfqWorkflow;
  }

  /** Get the FIX session manager (if FIX is configured). */
  getSessionManager(): FIXSessionManager {
    return this.sessionManager;
  }

  /** Get workflow statistics. */
  getStats(): ReturnType<RFQWorkflowManager['getStats']> {
    return this.rfqWorkflow.getStats();
  }

  // ─── Event System ───────────────────────────────────────────────────

  on<K extends keyof InstitutionalAdapterEvents>(event: K, handler: InstitutionalAdapterEvents[K]): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as EventHandler<never[]>);
  }

  off<K extends keyof InstitutionalAdapterEvents>(event: K, handler: InstitutionalAdapterEvents[K]): void {
    this.listeners.get(event)?.delete(handler as EventHandler<never[]>);
  }

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
}
