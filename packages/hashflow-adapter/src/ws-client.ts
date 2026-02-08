/**
 * @deluthium/hashflow-adapter - WebSocket Client
 *
 * Manages the persistent WebSocket connection to the Hashflow
 * maker API (v3). Handles authentication, heartbeats, reconnection.
 */

import WebSocket from 'ws';
import { WebSocketError, TimeoutError, sleep } from '@deluthium/sdk';
import type { ISigner, Address } from '@deluthium/sdk';
import type {
  HashflowWSMessage,
  HashflowAuthRequest,
  HashflowAuthResponse,
  PriceLevelsMessage,
  HashflowRFQRequest,
  HashflowRFQResponse,
} from './types.js';

/** Default Hashflow maker WebSocket URL */
export const DEFAULT_HASHFLOW_WS_URL = 'wss://maker-ws.hashflow.com/v3';

const HEARTBEAT_INTERVAL_MS = 15_000;
const CONNECT_TIMEOUT_MS = 10_000;
const MAX_RECONNECT_ATTEMPTS = 15;
const RECONNECT_BASE_DELAY_MS = 1_000;

type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

interface WSEventMap {
  auth_response: EventHandler<HashflowAuthResponse>;
  rfq_request: EventHandler<HashflowRFQRequest>;
  market_maker_status: EventHandler<unknown>;
  connected: EventHandler<void>;
  disconnected: EventHandler<{ code: number; reason: string }>;
  error: EventHandler<Error>;
}

/**
 * WebSocket client for the Hashflow maker API v3.
 */
export class HashflowWSClient {
  private ws: WebSocket | null = null;
  private readonly wsUrl: string;
  private readonly signer: ISigner;
  private readonly marketMaker: string;
  private readonly autoReconnect: boolean;
  private readonly listeners = new Map<string, Set<EventHandler<never>>>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private intentionallyClosed = false;
  private authenticated = false;
  private _sessionId: string | null = null;
  private messageCounter = 0;

  constructor(
    wsUrl: string | undefined,
    signer: ISigner,
    marketMaker: string,
    autoReconnect = true,
  ) {
    this.wsUrl = wsUrl ?? DEFAULT_HASHFLOW_WS_URL;
    this.signer = signer;
    this.marketMaker = marketMaker;
    this.autoReconnect = autoReconnect;
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.intentionallyClosed = false;
    this.authenticated = false;

    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.ws?.close();
        reject(new TimeoutError(`Hashflow WS connection timed out after ${CONNECT_TIMEOUT_MS}ms`, CONNECT_TIMEOUT_MS));
      }, CONNECT_TIMEOUT_MS);

      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        clearTimeout(timeoutId);
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.emit('connected', undefined as never);
        void this.authenticate().then(resolve).catch(reject);
      });

      this.ws.on('message', (raw: WebSocket.RawData) => { this.handleMessage(raw); });

      this.ws.on('close', (code: number, reason: Buffer) => {
        clearTimeout(timeoutId);
        this.stopHeartbeat();
        this.authenticated = false;
        this._sessionId = null;
        this.emit('disconnected', { code, reason: reason.toString() } as never);
        if (!this.intentionallyClosed && this.autoReconnect) { void this.attemptReconnect(); }
      });

      this.ws.on('error', (err: Error) => {
        clearTimeout(timeoutId);
        this.emit('error', err as never);
      });
    });
  }

  async disconnect(): Promise<void> {
    this.intentionallyClosed = true;
    this.stopHeartbeat();
    this.authenticated = false;
    this._sessionId = null;
    if (this.ws) { this.ws.close(1000, 'Client disconnect'); this.ws = null; }
  }

  get isConnected(): boolean { return this.ws?.readyState === WebSocket.OPEN; }
  get isAuthenticated(): boolean { return this.authenticated; }
  get currentSessionId(): string | null { return this._sessionId; }

  publishPriceLevels(levels: PriceLevelsMessage): void {
    this.send({ type: 'price_levels', data: levels });
  }

  sendRFQResponse(response: HashflowRFQResponse): void {
    this.send({ type: 'rfq_response', data: response });
  }

  sendStatusUpdate(active: boolean, pairs: string[], chains: string[]): void {
    this.send({ type: 'market_maker_status', data: { active, supportedPairs: pairs, supportedChains: chains } });
  }

  on<K extends keyof WSEventMap>(event: K, handler: WSEventMap[K]): void {
    if (!this.listeners.has(event)) { this.listeners.set(event, new Set()); }
    this.listeners.get(event)!.add(handler as EventHandler<never>);
  }

  off<K extends keyof WSEventMap>(event: K, handler: WSEventMap[K]): void {
    this.listeners.get(event)?.delete(handler as EventHandler<never>);
  }

  private async authenticate(): Promise<void> {
    const address = await this.signer.getAddress();
    const challenge = `Hashflow MM Auth: ${this.marketMaker}`;
    const signature = await this.signer.signMessage(challenge);
    const authRequest: HashflowAuthRequest = {
      marketMaker: this.marketMaker, signature, signerAddress: address as Address,
    };

    return new Promise<void>((resolve, reject) => {
      const authTimeout = setTimeout(() => {
        reject(new TimeoutError('Hashflow authentication timed out', 10_000));
      }, 10_000);

      const handler: EventHandler<HashflowAuthResponse> = (response) => {
        clearTimeout(authTimeout);
        this.off('auth_response', handler as WSEventMap['auth_response']);
        if (response.success) {
          this.authenticated = true;
          this._sessionId = response.sessionId ?? null;
          resolve();
        } else {
          reject(new WebSocketError(`Hashflow auth failed: ${response.error ?? 'unknown'}`));
        }
      };

      this.on('auth_response', handler as WSEventMap['auth_response']);
      this.send({ type: 'auth', data: authRequest });
    });
  }

  private send(msg: HashflowWSMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new WebSocketError('Hashflow WebSocket is not connected');
    }
    this.ws.send(JSON.stringify({
      ...msg, messageId: `msg_${++this.messageCounter}_${Date.now()}`, timestamp: Date.now(),
    }));
  }

  private handleMessage(raw: WebSocket.RawData): void {
    try {
      const msg = JSON.parse(raw.toString()) as HashflowWSMessage;
      switch (msg.type) {
        case 'auth_response': this.emit('auth_response', msg.data as never); break;
        case 'rfq_request': this.emit('rfq_request', msg.data as never); break;
        case 'market_maker_status': this.emit('market_maker_status', msg.data as never); break;
        case 'heartbeat': break;
        case 'error':
          this.emit('error', new WebSocketError(`Hashflow server error: ${msg.error ?? JSON.stringify(msg.data)}`) as never);
          break;
        default: break;
      }
    } catch { /* Ignore malformed messages */ }
  }

  private emit(event: string, data: never): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) { try { void handler(data); } catch { /* skip */ } }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) { this.send({ type: 'heartbeat' }); }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.emit('error', new WebSocketError(`Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) exceeded`) as never);
      return;
    }
    this.reconnectAttempts++;
    const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);
    const jitter = Math.random() * delay * 0.2;
    await sleep(delay + jitter);
    if (!this.intentionallyClosed) { try { await this.connect(); } catch { /* retry loop */ } }
  }
}
