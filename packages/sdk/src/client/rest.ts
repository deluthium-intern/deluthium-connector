/**
 * @deluthium/sdk - REST API Client
 *
 * Typed client for the Deluthium RFQ REST API.
 * Handles authentication, retries, error mapping, and response parsing.
 *
 * Base URL: https://rfq-api.deluthium.ai
 */

import type {
  DeluthiumClientConfig,
  APIResponse,
  TradingPair,
  Token,
  IndicativeQuoteRequest,
  IndicativeQuoteResponse,
  FirmQuoteRequest,
  FirmQuoteResponse,
} from '../types/index.js';
import { API_SUCCESS_CODE } from '../types/index.js';
import {
  APIError,
  AuthenticationError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from '../errors/index.js';
import { retry } from '../utils/index.js';

const DEFAULT_BASE_URL = 'https://rfq-api.deluthium.ai';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_USER_AGENT = '@deluthium/sdk';

export class DeluthiumRestClient {
  private readonly baseUrl: string;
  private readonly auth: string | (() => string | Promise<string>);
  private readonly chainId: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly userAgent: string;

  constructor(config: DeluthiumClientConfig) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.auth = config.auth;
    this.chainId = config.chainId;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
  }

  // ─── Token resolution ────────────────────────────────────────────────

  private async resolveToken(): Promise<string> {
    if (typeof this.auth === 'string') return this.auth;
    return await this.auth();
  }

  // ─── HTTP layer ──────────────────────────────────────────────────────

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    queryParams?: Record<string, string | number>,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (queryParams) {
      for (const [key, val] of Object.entries(queryParams)) {
        url.searchParams.set(key, String(val));
      }
    }

    const token = await this.resolveToken();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': this.userAgent,
      };

      const init: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      if (body && method === 'POST') {
        init.body = JSON.stringify(body);
      }

      const response = await fetch(url.toString(), init);

      // Handle specific HTTP errors before parsing body
      if (response.status === 401 || response.status === 403) {
        throw new AuthenticationError();
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined;
        throw new RateLimitError('Rate limit exceeded', retryMs);
      }

      const json = (await response.json()) as APIResponse<T>;

      if (!response.ok) {
        throw new APIError(
          json.message ?? `HTTP ${response.status}`,
          response.status,
          path,
          json.code,
          json,
        );
      }

      // Check business-logic success code
      const code = typeof json.code === 'string' ? parseInt(json.code, 10) : json.code;
      if (code !== API_SUCCESS_CODE) {
        throw new APIError(
          json.message ?? `API error code: ${json.code}`,
          response.status,
          path,
          json.code,
          json,
        );
      }

      return json.data as T;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new TimeoutError(`Request to ${path} timed out after ${this.timeoutMs}ms`, this.timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** HTTP request with automatic retry (exponential backoff). */
  private async requestWithRetry<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    queryParams?: Record<string, string | number>,
  ): Promise<T> {
    return retry(
      () => this.request<T>(method, path, body, queryParams),
      this.maxRetries,
    );
  }

  // ─── Public API Methods ──────────────────────────────────────────────

  /**
   * Fetch all listing pairs for a chain.
   *
   * @param chainId - Override default chain ID
   */
  async getPairs(chainId?: number): Promise<TradingPair[]> {
    return this.requestWithRetry<TradingPair[]>('GET', '/api/v1/listing-pairs', undefined, {
      chain_id: chainId ?? this.chainId,
    });
  }

  /**
   * Fetch all listing tokens for a chain.
   *
   * @param chainId - Override default chain ID
   */
  async getTokens(chainId?: number): Promise<Token[]> {
    return this.requestWithRetry<Token[]>('GET', '/api/v1/listing-tokens', undefined, {
      chain_id: chainId ?? this.chainId,
    });
  }

  /**
   * Request an indicative (non-binding) quote.
   * Use this for price discovery before committing to a firm quote.
   */
  async getIndicativeQuote(request: IndicativeQuoteRequest): Promise<IndicativeQuoteResponse> {
    this.validateQuoteRequest(request);
    return this.requestWithRetry<IndicativeQuoteResponse>(
      'POST',
      '/api/v1/indicative-quote',
      request,
    );
  }

  /**
   * Request a firm (binding) quote with on-chain calldata.
   * The returned calldata can be used to execute the swap.
   */
  async getFirmQuote(request: FirmQuoteRequest): Promise<FirmQuoteResponse> {
    this.validateFirmQuoteRequest(request);
    return this.requestWithRetry<FirmQuoteResponse>('POST', '/v1/quote/firm', request);
  }

  /**
   * Fetch market pair data (OHLCV compatible).
   */
  async getMarketPair(params: {
    base: string;
    quote: string;
    chainId?: number;
  }): Promise<unknown> {
    return this.requestWithRetry('GET', '/v1/market/pair', undefined, {
      base: params.base,
      quote: params.quote,
      chain_id: params.chainId ?? this.chainId,
    });
  }

  /**
   * Fetch kline (candlestick) data.
   */
  async getKlines(params: {
    pair: string;
    interval: string;
    limit?: number;
    chainId?: number;
  }): Promise<unknown> {
    return this.requestWithRetry('GET', '/v1/market/klines', undefined, {
      pair: params.pair,
      interval: params.interval,
      limit: params.limit ?? 100,
      chain_id: params.chainId ?? this.chainId,
    });
  }

  // ─── Validation ──────────────────────────────────────────────────────

  private validateQuoteRequest(req: IndicativeQuoteRequest): void {
    if (!req.token_in) throw new ValidationError('token_in is required', 'token_in');
    if (!req.token_out) throw new ValidationError('token_out is required', 'token_out');
    if (!req.amount_in || req.amount_in === '0')
      throw new ValidationError('amount_in must be a positive wei value', 'amount_in');
    if (!req.src_chain_id) throw new ValidationError('src_chain_id is required', 'src_chain_id');
    if (!req.dst_chain_id) throw new ValidationError('dst_chain_id is required', 'dst_chain_id');
  }

  private validateFirmQuoteRequest(req: FirmQuoteRequest): void {
    this.validateQuoteRequest(req);
    if (!req.from_address)
      throw new ValidationError('from_address is required', 'from_address');
    if (!req.to_address) throw new ValidationError('to_address is required', 'to_address');
    if (req.slippage == null || req.slippage < 0)
      throw new ValidationError('slippage must be a non-negative number', 'slippage');
    if (!req.expiry_time_sec || req.expiry_time_sec <= 0)
      throw new ValidationError('expiry_time_sec must be positive', 'expiry_time_sec');
  }
}
