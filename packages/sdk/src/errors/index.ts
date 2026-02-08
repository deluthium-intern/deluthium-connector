/**
 * @deluthium/sdk - Error hierarchy
 *
 * Structured error types for Deluthium API interactions.
 * All errors extend the base DeluthiumError class.
 */

export class DeluthiumError extends Error {
  public readonly code: string;
  public readonly timestamp: number;

  constructor(message: string, code = 'DELUTHIUM_ERROR') {
    super(message);
    this.name = 'DeluthiumError';
    this.code = code;
    this.timestamp = Date.now();
    // Restore prototype chain (required for instanceof checks with TS targets < ES2022)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when input validation fails before making an API call */
export class ValidationError extends DeluthiumError {
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    this.field = field;
  }
}

/** Thrown when an API call fails with an HTTP or business-logic error */
export class APIError extends DeluthiumError {
  public readonly httpStatus: number;
  public readonly apiCode: number | string | undefined;
  public readonly endpoint: string;
  public readonly responseBody?: unknown;

  constructor(
    message: string,
    httpStatus: number,
    endpoint: string,
    apiCode?: number | string,
    responseBody?: unknown,
  ) {
    super(message, 'API_ERROR');
    this.name = 'APIError';
    this.httpStatus = httpStatus;
    this.apiCode = apiCode;
    this.endpoint = endpoint;
    this.responseBody = responseBody;
  }
}

/** Thrown on 401/403 or token expiry */
export class AuthenticationError extends DeluthiumError {
  constructor(message = 'Authentication failed -- check your API key or JWT token') {
    super(message, 'AUTH_ERROR');
    this.name = 'AuthenticationError';
  }
}

/** Thrown on 429 rate limit responses */
export class RateLimitError extends DeluthiumError {
  public readonly retryAfterMs: number | undefined;

  constructor(message = 'Rate limit exceeded', retryAfterMs?: number) {
    super(message, 'RATE_LIMIT_ERROR');
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** Thrown when request or WebSocket operation times out */
export class TimeoutError extends DeluthiumError {
  public readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message, 'TIMEOUT_ERROR');
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** Thrown when a quote has passed its deadline */
export class QuoteExpiredError extends DeluthiumError {
  public readonly quoteId?: string;
  public readonly deadline: number;

  constructor(message: string, deadline: number, quoteId?: string) {
    super(message, 'QUOTE_EXPIRED_ERROR');
    this.name = 'QuoteExpiredError';
    this.quoteId = quoteId;
    this.deadline = deadline;
  }
}

/** Thrown when a WebSocket connection fails or is disrupted */
export class WebSocketError extends DeluthiumError {
  public readonly closeCode?: number;

  constructor(message: string, closeCode?: number) {
    super(message, 'WEBSOCKET_ERROR');
    this.name = 'WebSocketError';
    this.closeCode = closeCode;
  }
}

/** Thrown when EIP-712 or other signing operations fail */
export class SigningError extends DeluthiumError {
  constructor(message: string) {
    super(message, 'SIGNING_ERROR');
    this.name = 'SigningError';
  }
}

/** Thrown when a chain is not supported or misconfigured */
export class ChainError extends DeluthiumError {
  public readonly chainId: number;

  constructor(message: string, chainId: number) {
    super(message, 'CHAIN_ERROR');
    this.name = 'ChainError';
    this.chainId = chainId;
  }
}
