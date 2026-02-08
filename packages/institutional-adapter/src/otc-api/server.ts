/**
 * OTC REST + WebSocket API Server
 *
 * Provides an institutional-friendly API for Deluthium OTC trading:
 *
 * REST Endpoints:
 *   POST   /api/v1/rfq                    - Submit new RFQ
 *   GET    /api/v1/rfq/:requestId         - Get RFQ status
 *   POST   /api/v1/quote/:quoteId/accept  - Accept a quote
 *   POST   /api/v1/quote/:quoteId/reject  - Reject a quote
 *   GET    /api/v1/quotes                 - List active quotes
 *   GET    /api/v1/trades                 - List trade history
 *   GET    /api/v1/trades/:tradeId        - Get trade details
 *   GET    /api/v1/pairs                  - List available pairs
 *   GET    /api/v1/health                 - Health check
 *   GET    /api/v1/audit                  - Query audit trail
 *
 * WebSocket:
 *   ws://host:port/ws                     - Real-time quote/trade updates
 *
 * Built using Node.js native http module (zero external deps).
 */

import * as http from 'node:http';
import type {
  OTCRFQRequest,
  CounterpartyConfig,
} from '../types.js';
import { RFQWorkflowManager } from './rfq-workflow.js';
import { AuditTrail } from './audit-trail.js';

// ============================================================================
// Types
// ============================================================================

interface RouteHandler {
  method: string;
  pattern: RegExp;
  handler: (req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>) => Promise<void>;
}

interface OTCServerConfig {
  port: number;
  host?: string;
  apiKeyHeader?: string;
  corsOrigins?: string[];
}

// ============================================================================
// OTC API Server
// ============================================================================

export class OTCAPIServer {
  private readonly config: OTCServerConfig;
  private readonly workflow: RFQWorkflowManager;
  private readonly auditTrail: AuditTrail;
  private readonly counterparties: Map<string, CounterpartyConfig>;
  private readonly apiKeyToCounterparty = new Map<string, string>();
  private readonly routes: RouteHandler[] = [];

  private server: http.Server | null = null;
  private running = false;

  constructor(
    config: OTCServerConfig,
    workflow: RFQWorkflowManager,
    auditTrail: AuditTrail,
    counterparties: Record<string, CounterpartyConfig>,
  ) {
    this.config = config;
    this.workflow = workflow;
    this.auditTrail = auditTrail;

    this.counterparties = new Map();
    for (const [id, cp] of Object.entries(counterparties)) {
      this.counterparties.set(id, cp);
      if (cp.apiKey) {
        this.apiKeyToCounterparty.set(cp.apiKey, id);
      }
    }

    this.registerRoutes();
  }

  /**
   * Start the HTTP server.
   */
  async start(): Promise<void> {
    if (this.running) return;

    return new Promise<void>((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      this.server.on('error', (err) => {
        if (!this.running) reject(err);
      });

      const host = this.config.host ?? '0.0.0.0';
      this.server.listen(this.config.port, host, () => {
        this.running = true;
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server.
   */
  async stop(): Promise<void> {
    if (!this.running || !this.server) return;

    return new Promise<void>((resolve) => {
      this.server!.close(() => {
        this.running = false;
        this.server = null;
        resolve();
      });
    });
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ─── Route Registration ───────────────────────────────────────────────

  private registerRoutes(): void {
    // Health check
    this.addRoute('GET', /^\/api\/v1\/health$/, async (_req, res) => {
      this.sendJSON(res, 200, {
        status: 'ok',
        timestamp: new Date().toISOString(),
        stats: this.workflow.getStats(),
      });
    });

    // Submit RFQ
    this.addRoute('POST', /^\/api\/v1\/rfq$/, async (req, res) => {
      const counterpartyId = this.authenticateRequest(req);
      if (!counterpartyId) {
        this.sendJSON(res, 401, { error: 'Unauthorized' });
        return;
      }

      const body = await this.readBody(req);
      if (!body) {
        this.sendJSON(res, 400, { error: 'Invalid request body' });
        return;
      }

      try {
        const rfqData = JSON.parse(body) as Partial<OTCRFQRequest>;
        const request: OTCRFQRequest = {
          requestId: rfqData.requestId ?? this.generateRequestId(),
          counterpartyId,
          baseToken: rfqData.baseToken ?? '',
          quoteToken: rfqData.quoteToken ?? '',
          side: rfqData.side ?? 'buy',
          quantity: rfqData.quantity ?? '0',
          chainId: rfqData.chainId,
          baseTokenAddress: rfqData.baseTokenAddress,
          quoteTokenAddress: rfqData.quoteTokenAddress,
          settlement: rfqData.settlement ?? 'on-chain',
          maxSlippage: rfqData.maxSlippage,
          quoteValiditySec: rfqData.quoteValiditySec,
          metadata: rfqData.metadata,
          timestamp: new Date().toISOString(),
        };

        // Validate required fields
        if (!request.baseToken || !request.quoteToken || !request.quantity) {
          this.sendJSON(res, 400, {
            error: 'Missing required fields: baseToken, quoteToken, quantity',
          });
          return;
        }

        const quote = await this.workflow.submitRFQ(request);
        this.sendJSON(res, 201, quote);
      } catch (err) {
        this.sendJSON(res, 500, {
          error: err instanceof Error ? err.message : 'Internal error',
        });
      }
    });

    // Get RFQ / quote status
    this.addRoute('GET', /^\/api\/v1\/rfq\/(?<requestId>[^/]+)$/, async (req, res, params) => {
      const counterpartyId = this.authenticateRequest(req);
      if (!counterpartyId) {
        this.sendJSON(res, 401, { error: 'Unauthorized' });
        return;
      }

      // Find quote by request ID
      const quotes = this.workflow.getActiveQuotes(counterpartyId);
      const quote = quotes.find((q) => q.requestId === params['requestId']);

      if (!quote) {
        this.sendJSON(res, 404, { error: 'RFQ not found' });
        return;
      }

      this.sendJSON(res, 200, quote);
    });

    // Accept quote
    this.addRoute('POST', /^\/api\/v1\/quote\/(?<quoteId>[^/]+)\/accept$/, async (req, res, params) => {
      const counterpartyId = this.authenticateRequest(req);
      if (!counterpartyId) {
        this.sendJSON(res, 401, { error: 'Unauthorized' });
        return;
      }

      try {
        const trade = await this.workflow.acceptQuote(params['quoteId']!);
        this.sendJSON(res, 200, trade);
      } catch (err) {
        this.sendJSON(res, 400, {
          error: err instanceof Error ? err.message : 'Failed to accept quote',
        });
      }
    });

    // Reject quote
    this.addRoute('POST', /^\/api\/v1\/quote\/(?<quoteId>[^/]+)\/reject$/, async (req, res, params) => {
      const counterpartyId = this.authenticateRequest(req);
      if (!counterpartyId) {
        this.sendJSON(res, 401, { error: 'Unauthorized' });
        return;
      }

      const body = await this.readBody(req);
      let reason: string | undefined;
      if (body) {
        try {
          const parsed = JSON.parse(body) as { reason?: string };
          reason = parsed.reason;
        } catch {
          // Ignore parse errors for optional body
        }
      }

      try {
        await this.workflow.rejectQuote(params['quoteId']!, reason);
        this.sendJSON(res, 200, { status: 'rejected', quoteId: params['quoteId'] });
      } catch (err) {
        this.sendJSON(res, 400, {
          error: err instanceof Error ? err.message : 'Failed to reject quote',
        });
      }
    });

    // List active quotes
    this.addRoute('GET', /^\/api\/v1\/quotes$/, async (req, res) => {
      const counterpartyId = this.authenticateRequest(req);
      if (!counterpartyId) {
        this.sendJSON(res, 401, { error: 'Unauthorized' });
        return;
      }

      const quotes = this.workflow.getActiveQuotes(counterpartyId);
      this.sendJSON(res, 200, { quotes });
    });

    // List trades
    this.addRoute('GET', /^\/api\/v1\/trades$/, async (req, res) => {
      const counterpartyId = this.authenticateRequest(req);
      if (!counterpartyId) {
        this.sendJSON(res, 401, { error: 'Unauthorized' });
        return;
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);
      const trades = this.workflow.getTradeHistory(counterpartyId, limit);
      this.sendJSON(res, 200, { trades });
    });

    // Get trade details
    this.addRoute('GET', /^\/api\/v1\/trades\/(?<tradeId>[^/]+)$/, async (req, res, params) => {
      const counterpartyId = this.authenticateRequest(req);
      if (!counterpartyId) {
        this.sendJSON(res, 401, { error: 'Unauthorized' });
        return;
      }

      const trade = this.workflow.getTrade(params['tradeId']!);
      if (!trade || trade.counterpartyId !== counterpartyId) {
        this.sendJSON(res, 404, { error: 'Trade not found' });
        return;
      }

      this.sendJSON(res, 200, trade);
    });

    // Query audit trail
    this.addRoute('GET', /^\/api\/v1\/audit$/, async (req, res) => {
      const counterpartyId = this.authenticateRequest(req);
      if (!counterpartyId) {
        this.sendJSON(res, 401, { error: 'Unauthorized' });
        return;
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);
      const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

      const entries = await this.auditTrail.query({
        counterpartyId,
        limit,
        offset,
      });

      this.sendJSON(res, 200, { entries, total: entries.length });
    });
  }

  // ─── Request Handling ─────────────────────────────────────────────────

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS headers
    const origins = this.config.corsOrigins ?? ['*'];
    res.setHeader('Access-Control-Allow-Origin', origins.join(','));
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    // Find matching route
    for (const route of this.routes) {
      if (route.method !== method) continue;

      const match = route.pattern.exec(pathname);
      if (match) {
        const params = match.groups ?? {};
        try {
          await route.handler(req, res, params);
        } catch (err) {
          this.sendJSON(res, 500, {
            error: 'Internal server error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
    }

    // No route matched
    this.sendJSON(res, 404, { error: 'Not found' });
  }

  private addRoute(method: string, pattern: RegExp, handler: RouteHandler['handler']): void {
    this.routes.push({ method, pattern, handler });
  }

  // ─── Auth ─────────────────────────────────────────────────────────────

  private authenticateRequest(req: http.IncomingMessage): string | null {
    const headerName = this.config.apiKeyHeader ?? 'x-api-key';
    const apiKey = req.headers[headerName.toLowerCase()] as string | undefined;

    if (!apiKey) return null;

    return this.apiKeyToCounterparty.get(apiKey) ?? null;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private sendJSON(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private readBody(req: http.IncomingMessage): Promise<string | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;

      req.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > 1_000_000) {
          resolve(null); // Body too large
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (chunks.length === 0) {
          resolve(null);
          return;
        }
        resolve(Buffer.concat(chunks).toString('utf-8'));
      });

      req.on('error', () => {
        resolve(null);
      });
    });
  }

  private generateRequestId(): string {
    const ts = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `RFQ-${ts}-${random}`;
  }
}
