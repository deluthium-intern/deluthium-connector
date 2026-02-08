/**
 * @deluthium/sdk - WebSocket Client
 *
 * Manages persistent WebSocket connections to the Deluthium MM Hub.
 * Handles subscriptions, heartbeats, reconnection, and typed message parsing.
 */

import WebSocket from 'ws';
import type {
  DeluthiumClientConfig,
  WSMessage,
  DepthUpdate,
  WSRFQRequest,
  WSRFQResponse,
} from '../types/index.js';
import { WebSocketError, TimeoutError } from '../errors/index.js';
import { sleep } from '../utils/index.js';

// ─── Event Types ─────────────────────────────────────────────────────────────

export type WSEventHandler<T = unknown> = (data: T) => void | Promise<void>;

interface WSEventMap {
  depth: WSEventHandler<DepthUpdate>;
  rfq_request: WSEventHandler<WSRFQRequest>;
  connected: WSEventHandler<void>;
  disconnected: WSEventHandler<{ code: number; reason: string }>;
  error: WSEventHandler<Error>;
}

// ─── Configuration ───────────────────────────────────────────────────────────

interface WSClientOptions {
  /** WebSocket URL */
  url: string;
  /** Auth token or provider */
  auth: string | (() => string | Promise<string>);
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatIntervalMs?: number;
  /** Reconnection delay in ms (default: 1000, doubles each attempt) */
  reconnectBaseDelayMs?: number;
  /** Max reconnection attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Connection timeout in ms (default: 10000) */
  connectTimeoutMs?: number;
}

// ─── WebSocket Client ────────────────────────────────────────────────────────

export class DeluthiumWSClient {
  private ws: WebSocket | null = null;
  private readonly options: Required<WSClientOptions>;
  private readonly listeners = new Map<string, Set<WSEventHandler<never>>>();
  private readonly subscriptions = new Set<string>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private intentionallyClosed = false;
  private messageCounter = 0;
  /** Deduplicates concurrent connect() calls (HIGH-03) */
  private connectPromise: Promise<void> | null = null;

  constructor(config: DeluthiumClientConfig) {
    if (!config.wsUrl) {
      throw new WebSocketError('wsUrl is required for WebSocket client');
    }

    this.options = {
      url: config.wsUrl,
      auth: config.auth,
      heartbeatIntervalMs: 30_000,
      reconnectBaseDelayMs: 1_000,
      maxReconnectAttempts: 10,
      connectTimeoutMs: 10_000,
    };
  }

  // ─── Connection Management ─────────────────────────────────────────

  /**
   * Establish WebSocket connection.
   * Resolves when connection is open. Rejects on timeout or error.
   */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    // Deduplicate concurrent connect() calls (HIGH-03)
    if (this.connectPromise) return this.connectPromise;

    this.intentionallyClosed = false;

    this.connectPromise = this._doConnect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async _doConnect(): Promise<void> {
    const token = typeof this.options.auth === 'string'
      ? this.options.auth
      : await this.options.auth();

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.ws?.close();
          reject(new TimeoutError(
            `WebSocket connection timed out after ${this.options.connectTimeoutMs}ms`,
            this.options.connectTimeoutMs,
          ));
        }
      }, this.options.connectTimeoutMs);

      this.ws = new WebSocket(this.options.url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      this.ws.on('open', () => {
        clearTimeout(timeoutId);
        if (!settled) {
          settled = true;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.resubscribeAll();
          this.emit('connected', undefined as never);
          resolve();
        }
      });

      this.ws.on('message', (raw: WebSocket.RawData) => {
        this.handleMessage(raw);
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        clearTimeout(timeoutId);
        this.stopHeartbeat();
        this.emit('disconnected', { code, reason: reason.toString() } as never);

        // Reject the connect promise if not yet settled (HIGH-02)
        if (!settled) {
          settled = true;
          reject(new WebSocketError(`WebSocket closed before open (code: ${code})`));
        }

        if (!this.intentionallyClosed) {
          void this.attemptReconnect();
        }
      });

      this.ws.on('error', (err: Error) => {
        clearTimeout(timeoutId);
        this.emit('error', err as never);
        // Reject the connect promise if not yet settled (HIGH-02)
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  }

  /**
   * Gracefully close the WebSocket connection.
   */
  async disconnect(): Promise<void> {
    this.intentionallyClosed = true;
    this.stopHeartbeat();
    this.subscriptions.clear();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  /**
   * Check if the connection is currently open.
   */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ─── Subscriptions ────────────────────────────────────────────────

  /**
   * Subscribe to depth updates for a trading pair.
   *
   * @param pair - Pair identifier (e.g. "BNB/USDT")
   */
  subscribe(pair: string): void {
    this.subscriptions.add(pair);
    if (this.isConnected) {
      this.send({ type: 'subscribe', channel: `depth:${pair}` });
    }
  }

  /**
   * Unsubscribe from depth updates for a trading pair.
   */
  unsubscribe(pair: string): void {
    this.subscriptions.delete(pair);
    if (this.isConnected) {
      this.send({ type: 'unsubscribe', channel: `depth:${pair}` });
    }
  }

  /**
   * Send an RFQ response back through the WebSocket.
   */
  sendRFQResponse(response: WSRFQResponse): void {
    this.send({
      type: 'rfq_response',
      data: response,
    });
  }

  // ─── Event Handling ───────────────────────────────────────────────

  /**
   * Register an event listener.
   */
  on<K extends keyof WSEventMap>(event: K, handler: WSEventMap[K]): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as WSEventHandler<never>);
  }

  /**
   * Remove an event listener.
   */
  off<K extends keyof WSEventMap>(event: K, handler: WSEventMap[K]): void {
    this.listeners.get(event)?.delete(handler as WSEventHandler<never>);
  }

  // ─── Internal Methods ─────────────────────────────────────────────

  private send(msg: WSMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new WebSocketError('WebSocket is not connected');
    }
    this.ws.send(JSON.stringify({ ...msg, id: ++this.messageCounter }));
  }

  private handleMessage(raw: WebSocket.RawData): void {
    try {
      const msg = JSON.parse(raw.toString()) as WSMessage;

      switch (msg.type) {
        case 'depth':
          this.emit('depth', msg.data as never);
          break;
        case 'rfq_request':
          this.emit('rfq_request', msg.data as never);
          break;
        case 'heartbeat':
          // Heartbeat acknowledged -- no action needed
          break;
        case 'error':
          this.emit('error', new WebSocketError(
            `Server error: ${JSON.stringify(msg.data)}`,
          ) as never);
          break;
        default:
          // Unknown message type -- ignore
          break;
      }
    } catch (parseErr) {
      // Emit parse errors instead of silently swallowing them
      this.emit('error', new WebSocketError(
        `Failed to parse WebSocket message: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      ) as never);
    }
  }

  private emit<K extends keyof WSEventMap>(event: K, data: never): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          // Handle both sync and async handler errors
          const result = handler(data);
          if (result && typeof (result as Promise<void>).catch === 'function') {
            (result as Promise<void>).catch((err) => {
              if (event !== 'error') {
                this.emit('error', (err instanceof Error ? err : new Error(String(err))) as never);
              }
            });
          }
        } catch (handlerErr) {
          // Don't let sync handler errors break the event loop, but report them
          if (event !== 'error') {
            this.emit('error', (handlerErr instanceof Error ? handlerErr : new Error(String(handlerErr))) as never);
          }
        }
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) {
        try {
          this.send({ type: 'heartbeat' });
        } catch {
          // Socket closed between isConnected check and send -- ignore
        }
      }
    }, this.options.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private resubscribeAll(): void {
    for (const pair of this.subscriptions) {
      this.send({ type: 'subscribe', channel: `depth:${pair}` });
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.emit('error', new WebSocketError(
        `Max reconnection attempts (${this.options.maxReconnectAttempts}) exceeded`,
      ) as never);
      return;
    }

    this.reconnectAttempts++;
    const delay = this.options.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempts - 1);
    const jitter = Math.random() * delay * 0.2;

    await sleep(delay + jitter);

    if (!this.intentionallyClosed) {
      try {
        await this.connect();
      } catch {
        // Connect failure will trigger close -> attemptReconnect again
      }
    }
  }
}
