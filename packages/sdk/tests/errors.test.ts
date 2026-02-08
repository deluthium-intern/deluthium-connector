import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DeluthiumError,
  ValidationError,
  APIError,
  AuthenticationError,
  RateLimitError,
  TimeoutError,
  QuoteExpiredError,
  WebSocketError,
  SigningError,
  ChainError,
} from '../src/errors/index.js';

describe('Error hierarchy', () => {
  it('DeluthiumError is an Error', () => {
    const err = new DeluthiumError('test');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof DeluthiumError);
    assert.equal(err.code, 'DELUTHIUM_ERROR');
    assert.ok(err.timestamp > 0);
  });

  it('ValidationError extends DeluthiumError', () => {
    const err = new ValidationError('bad input', 'field_name');
    assert.ok(err instanceof DeluthiumError);
    assert.equal(err.code, 'VALIDATION_ERROR');
    assert.equal(err.field, 'field_name');
  });

  it('APIError captures HTTP details', () => {
    const err = new APIError('Not Found', 404, '/api/v1/foo', 40400, { detail: 'missing' });
    assert.ok(err instanceof DeluthiumError);
    assert.equal(err.httpStatus, 404);
    assert.equal(err.endpoint, '/api/v1/foo');
    assert.equal(err.apiCode, 40400);
  });

  it('AuthenticationError has default message', () => {
    const err = new AuthenticationError();
    assert.ok(err.message.includes('Authentication'));
  });

  it('RateLimitError tracks retry-after', () => {
    const err = new RateLimitError('slow down', 5000);
    assert.equal(err.retryAfterMs, 5000);
  });

  it('TimeoutError tracks timeout duration', () => {
    const err = new TimeoutError('timed out', 30000);
    assert.equal(err.timeoutMs, 30000);
  });

  it('QuoteExpiredError tracks deadline', () => {
    const err = new QuoteExpiredError('expired', 1700000000, 'q-123');
    assert.equal(err.deadline, 1700000000);
    assert.equal(err.quoteId, 'q-123');
  });

  it('WebSocketError tracks close code', () => {
    const err = new WebSocketError('disconnected', 1006);
    assert.equal(err.closeCode, 1006);
  });

  it('SigningError has correct code', () => {
    const err = new SigningError('sign failed');
    assert.equal(err.code, 'SIGNING_ERROR');
  });

  it('ChainError tracks chain ID', () => {
    const err = new ChainError('unsupported', 999);
    assert.equal(err.chainId, 999);
  });
});
