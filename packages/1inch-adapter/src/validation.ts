import { isAddress } from 'ethers';
import type { DeluthiumQuote, OneInchOrderV4, ValidationErrorInfo } from './types.js';
import { NATIVE_TOKEN_ADDRESS, DEFAULTS } from './constants.js';
import { ValidationError, QuoteExpiredError } from './errors.js';

// ── Result Type ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: ValidationErrorInfo[];
}

// ── Atomic Helpers ───────────────────────────────────────────────────────────

/**
 * Returns `true` when the string is a valid Ethereum address.
 */
export function isValidAddress(address: string): boolean {
  return isAddress(address);
}

/**
 * Returns `true` when the address matches the well-known native-token sentinel.
 */
export function isNativeToken(address: string): boolean {
  return address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
}

// ── Deluthium Quote Validation ───────────────────────────────────────────────

/**
 * Validates a Deluthium quote, returning all errors found.
 */
export function validateDeluthiumQuote(quote: DeluthiumQuote): ValidationResult {
  const errors: ValidationErrorInfo[] = [];

  if (!quote.quoteId || quote.quoteId.trim() === '') {
    errors.push({ field: 'quoteId', message: 'quoteId is required' });
  }

  if (typeof quote.srcChainId !== 'number' || quote.srcChainId <= 0) {
    errors.push({
      field: 'srcChainId',
      message: 'srcChainId must be a positive integer',
      value: String(quote.srcChainId),
    });
  }

  if (typeof quote.dstChainId !== 'number' || quote.dstChainId <= 0) {
    errors.push({
      field: 'dstChainId',
      message: 'dstChainId must be a positive integer',
      value: String(quote.dstChainId),
    });
  }

  if (!isValidAddress(quote.inputToken)) {
    errors.push({
      field: 'inputToken',
      message: 'inputToken is not a valid address',
      value: quote.inputToken,
    });
  }

  if (!isValidAddress(quote.outputToken)) {
    errors.push({
      field: 'outputToken',
      message: 'outputToken is not a valid address',
      value: quote.outputToken,
    });
  }

  if (!quote.amountIn || BigInt(quote.amountIn) <= 0n) {
    errors.push({
      field: 'amountIn',
      message: 'amountIn must be a positive value',
      value: quote.amountIn,
    });
  }

  if (!quote.amountOut || BigInt(quote.amountOut) <= 0n) {
    errors.push({
      field: 'amountOut',
      message: 'amountOut must be a positive value',
      value: quote.amountOut,
    });
  }

  if (!isValidAddress(quote.to)) {
    errors.push({
      field: 'to',
      message: 'to is not a valid address',
      value: quote.to,
    });
  }

  if (typeof quote.deadline !== 'number' || quote.deadline <= 0) {
    errors.push({
      field: 'deadline',
      message: 'deadline must be a positive unix timestamp',
      value: String(quote.deadline),
    });
  }

  if (!quote.nonce || quote.nonce.trim() === '') {
    errors.push({ field: 'nonce', message: 'nonce is required' });
  }

  return { valid: errors.length === 0, errors };
}

// ── 1inch Order Validation ───────────────────────────────────────────────────

/**
 * Validates a 1inch V4 order, returning all errors found.
 */
export function validateOneInchOrder(order: OneInchOrderV4): ValidationResult {
  const errors: ValidationErrorInfo[] = [];

  if (order.salt < 0n) {
    errors.push({
      field: 'salt',
      message: 'salt must be non-negative',
      value: order.salt.toString(),
    });
  }

  if (!isValidAddress(order.maker)) {
    errors.push({
      field: 'maker',
      message: 'maker is not a valid address',
      value: order.maker,
    });
  }

  if (!isValidAddress(order.receiver)) {
    errors.push({
      field: 'receiver',
      message: 'receiver is not a valid address',
      value: order.receiver,
    });
  }

  if (!isValidAddress(order.makerAsset)) {
    errors.push({
      field: 'makerAsset',
      message: 'makerAsset is not a valid address',
      value: order.makerAsset,
    });
  }

  if (!isValidAddress(order.takerAsset)) {
    errors.push({
      field: 'takerAsset',
      message: 'takerAsset is not a valid address',
      value: order.takerAsset,
    });
  }

  if (order.makingAmount <= 0n) {
    errors.push({
      field: 'makingAmount',
      message: 'makingAmount must be positive',
      value: order.makingAmount.toString(),
    });
  }

  if (order.takingAmount <= 0n) {
    errors.push({
      field: 'takingAmount',
      message: 'takingAmount must be positive',
      value: order.takingAmount.toString(),
    });
  }

  if (order.makerTraits < 0n) {
    errors.push({
      field: 'makerTraits',
      message: 'makerTraits must be non-negative',
      value: order.makerTraits.toString(),
    });
  }

  return { valid: errors.length === 0, errors };
}

// ── Slippage ─────────────────────────────────────────────────────────────────

/**
 * Returns the slippage between expected and actual amounts as a percentage.
 * A positive value means `actual < expected` (i.e. less than expected).
 */
export function calculateSlippage(expected: bigint, actual: bigint): number {
  if (expected === 0n) return 0;
  const diff = expected - actual;
  return Number((diff * 10_000n) / expected) / 100;
}

/**
 * Returns `true` when the slippage between expected and actual is within bounds.
 */
export function isSlippageAcceptable(
  expected: bigint,
  actual: bigint,
  maxSlippagePercent: number = DEFAULTS.MAX_SLIPPAGE_PERCENT,
): boolean {
  const slippage = calculateSlippage(expected, actual);
  return slippage <= maxSlippagePercent;
}

// ── Assert Helpers ───────────────────────────────────────────────────────────

/**
 * Validates a Deluthium quote and throws on the first error encountered.
 * Throws {@link QuoteExpiredError} if the deadline has passed,
 * otherwise throws {@link ValidationError}.
 */
export function assertValidDeluthiumQuote(quote: DeluthiumQuote): void {
  // Check expiration first
  const now = Math.floor(Date.now() / 1000);
  if (quote.deadline > 0 && quote.deadline < now) {
    throw new QuoteExpiredError(quote.deadline, now);
  }

  const result = validateDeluthiumQuote(quote);
  if (!result.valid) {
    const first = result.errors[0]!;
    throw new ValidationError(first.message, first.field, first.value);
  }
}

/**
 * Validates a 1inch order and throws on the first error encountered.
 */
export function assertValidOneInchOrder(order: OneInchOrderV4): void {
  const result = validateOneInchOrder(order);
  if (!result.valid) {
    const first = result.errors[0]!;
    throw new ValidationError(first.message, first.field, first.value);
  }
}
