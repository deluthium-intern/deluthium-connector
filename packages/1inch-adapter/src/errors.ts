// ── Base Error ───────────────────────────────────────────────────────────────

export class AdapterError extends Error {
  public readonly code: string;
  public readonly timestamp: Date;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    this.timestamp = new Date();
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      timestamp: this.timestamp.toISOString(),
    };
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

export class ValidationError extends AdapterError {
  public readonly field?: string;
  public readonly value?: string;

  constructor(message: string, field?: string, value?: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), field: this.field, value: this.value };
  }
}

// ── Unsupported Chain ────────────────────────────────────────────────────────

export class UnsupportedChainError extends AdapterError {
  public readonly chainId: number;

  constructor(chainId: number) {
    super(`Unsupported chain ID: ${chainId}`, 'UNSUPPORTED_CHAIN');
    this.name = 'UnsupportedChainError';
    this.chainId = chainId;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), chainId: this.chainId };
  }
}

// ── Configuration ────────────────────────────────────────────────────────────

export class ConfigurationError extends AdapterError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR');
    this.name = 'ConfigurationError';
  }
}

// ── Signature ────────────────────────────────────────────────────────────────

export class SignatureError extends AdapterError {
  constructor(message: string) {
    super(message, 'SIGNATURE_ERROR');
    this.name = 'SignatureError';
  }
}

// ── API ──────────────────────────────────────────────────────────────────────

export class APIError extends AdapterError {
  public readonly httpStatus?: number;
  public readonly apiCode?: string;
  public readonly endpoint?: string;

  constructor(
    message: string,
    httpStatus?: number,
    apiCode?: string,
    endpoint?: string,
  ) {
    super(message, 'API_ERROR');
    this.name = 'APIError';
    this.httpStatus = httpStatus;
    this.apiCode = apiCode;
    this.endpoint = endpoint;
  }

  isRetryable(): boolean {
    if (this.httpStatus === undefined) return false;
    return this.httpStatus >= 500 || this.httpStatus === 429;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      httpStatus: this.httpStatus,
      apiCode: this.apiCode,
      endpoint: this.endpoint,
    };
  }
}

// ── Authentication ───────────────────────────────────────────────────────────

export class AuthenticationError extends APIError {
  constructor(message: string, endpoint?: string) {
    super(message, 401, 'AUTH_ERROR', endpoint);
    this.name = 'AuthenticationError';
  }
}

// ── Rate Limit ───────────────────────────────────────────────────────────────

export class RateLimitError extends APIError {
  public readonly retryAfterSeconds?: number;

  constructor(message: string, retryAfterSeconds?: number, endpoint?: string) {
    super(message, 429, 'RATE_LIMIT', endpoint);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), retryAfterSeconds: this.retryAfterSeconds };
  }
}

// ── Timeout ──────────────────────────────────────────────────────────────────

export class TimeoutError extends AdapterError {
  public readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message, 'TIMEOUT');
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), timeoutMs: this.timeoutMs };
  }
}

// ── Quote Expired ────────────────────────────────────────────────────────────

export class QuoteExpiredError extends ValidationError {
  public readonly deadline: number;
  public readonly currentTime: number;

  constructor(deadline: number, currentTime: number) {
    super(
      `Quote expired: deadline ${deadline} is in the past (current time: ${currentTime})`,
      'deadline',
      String(deadline),
    );
    this.name = 'QuoteExpiredError';
    this.deadline = deadline;
    this.currentTime = currentTime;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      deadline: this.deadline,
      currentTime: this.currentTime,
    };
  }
}

// ── Type Guards ──────────────────────────────────────────────────────────────

export function isAdapterError(error: unknown): error is AdapterError {
  return error instanceof AdapterError;
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof APIError) {
    return error.isRetryable();
  }
  if (error instanceof TimeoutError) {
    return true;
  }
  return false;
}
