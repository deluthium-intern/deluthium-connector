/**
 * @deluthium/sdk - Utility functions
 *
 * Wei conversion, address normalization, native token handling,
 * deadline calculation, and other helpers.
 */

import { getAddress, keccak256, toUtf8Bytes } from 'ethers';
import { ZERO_ADDRESS, type Address, type HexString } from '../types/index.js';
import { ValidationError } from '../errors/index.js';
import { getWrappedNativeToken } from '../chain/index.js';

// --- Wei / Decimal Conversion ---

/**
 * Convert a human-readable amount to wei (smallest unit).
 *
 * @param amount - Human-readable amount (e.g. "1.5")
 * @param decimals - Token decimals (default 18)
 * @returns Wei amount as string
 *
 * @example
 * toWei("1.5", 18) // "1500000000000000000"
 * toWei("100", 6)  // "100000000"
 */
export function toWei(amount: string | number, decimals = 18): string {
  if (decimals < 0 || decimals > 77) {
    throw new ValidationError(`Invalid decimals: ${decimals}`, 'decimals');
  }

  const str = typeof amount === 'number' ? amount.toString() : amount;

  // Split on decimal point
  const parts = str.split('.');
  if (parts.length > 2) {
    throw new ValidationError(`Invalid amount format: ${str}`, 'amount');
  }

  const whole = parts[0] ?? '0';
  let fraction = parts[1] ?? '';

  // Truncate fraction if longer than decimals (no rounding)
  if (fraction.length > decimals) {
    fraction = fraction.slice(0, decimals);
  }

  // Pad fraction with trailing zeros
  fraction = fraction.padEnd(decimals, '0');

  // Combine and strip leading zeros
  const wei = (whole + fraction).replace(/^0+/, '') || '0';
  return wei;
}

/**
 * Convert wei (smallest unit) to a human-readable decimal string.
 *
 * @param wei - Amount in wei (as string or bigint)
 * @param decimals - Token decimals (default 18)
 * @returns Human-readable amount string
 *
 * @example
 * fromWei("1500000000000000000", 18) // "1.5"
 * fromWei("100000000", 6)            // "100.0"
 */
export function fromWei(wei: string | bigint, decimals = 18): string {
  const str = typeof wei === 'bigint' ? wei.toString() : wei;

  if (decimals === 0) return str;

  const padded = str.padStart(decimals + 1, '0');
  const wholePart = padded.slice(0, padded.length - decimals);
  const fractionPart = padded.slice(padded.length - decimals);

  // Trim trailing zeros from fraction, keep at least one
  const trimmedFraction = fractionPart.replace(/0+$/, '') || '0';

  return `${wholePart}.${trimmedFraction}`;
}

/**
 * Parse an amount string into bigint wei.
 */
export function parseAmount(amount: string, decimals = 18): bigint {
  return BigInt(toWei(amount, decimals));
}

/**
 * Format a bigint wei amount to a human-readable string.
 */
export function formatAmount(amount: bigint, decimals = 18): string {
  return fromWei(amount, decimals);
}

// --- Address Utilities ---

/**
 * Normalize an Ethereum address to checksummed format.
 * Returns the zero address as-is.
 *
 * @throws ValidationError if address is invalid
 */
export function normalizeAddress(address: string): Address {
  if (address === ZERO_ADDRESS) return ZERO_ADDRESS;

  try {
    return getAddress(address) as Address;
  } catch {
    throw new ValidationError(`Invalid Ethereum address: ${address}`, 'address');
  }
}

/**
 * Check if a string is a valid Ethereum address.
 */
export function isValidAddress(address: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  try {
    getAddress(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if an address is the zero address (represents native token).
 */
export function isNativeToken(address: string): boolean {
  return address.toLowerCase() === ZERO_ADDRESS.toLowerCase();
}

/**
 * Resolve a token address: if zero address, return wrapped native token.
 * Otherwise return the original address normalized.
 */
export function resolveTokenAddress(address: string, chainId: number): Address {
  if (isNativeToken(address)) {
    return getWrappedNativeToken(chainId) as Address;
  }
  return normalizeAddress(address);
}

// --- Deadline and Timing ---

/**
 * Calculate a deadline timestamp (unix seconds) from seconds-from-now.
 *
 * @param expirySeconds - Number of seconds until expiry
 * @returns Unix timestamp (seconds)
 */
export function calculateDeadline(expirySeconds: number): number {
  return Math.floor(Date.now() / 1000) + expirySeconds;
}

/**
 * Check if a deadline (unix seconds) has passed.
 */
export function isExpired(deadline: number): boolean {
  return Math.floor(Date.now() / 1000) > deadline;
}

// --- Slippage ---

/**
 * Calculate the minimum acceptable output given slippage tolerance.
 *
 * @param amountOut - Expected output amount (wei string)
 * @param slippagePercent - Slippage tolerance as percentage (e.g. 0.5 = 0.5%)
 * @returns Minimum acceptable output (wei string)
 */
export function applySlippage(amountOut: string, slippagePercent: number): string {
  if (slippagePercent < 0 || slippagePercent > 100) {
    throw new ValidationError(`Invalid slippage: ${slippagePercent}%`, 'slippage');
  }
  const amount = BigInt(amountOut);
  const bps = BigInt(Math.floor(slippagePercent * 100)); // Convert % to basis points
  const minOutput = amount - (amount * bps) / 10000n;
  return minOutput.toString();
}

// --- Hashing ---

/**
 * Compute keccak256 of a hex string or bytes.
 */
export function keccak256Hash(data: string | Uint8Array): HexString {
  if (typeof data === 'string' && !data.startsWith('0x')) {
    return keccak256(toUtf8Bytes(data)) as HexString;
  }
  return keccak256(data) as HexString;
}

// --- Nonce Generation ---

/**
 * Generate a random nonce for EIP-712 signing.
 * Uses 40-bit nonces (fits within uint256 with room for epoch/series).
 */
export function generateNonce(): bigint {
  const bytes = new Uint8Array(5); // 40 bits
  crypto.getRandomValues(bytes);
  let nonce = 0n;
  for (const b of bytes) {
    nonce = (nonce << 8n) | BigInt(b);
  }
  return nonce;
}

// --- Misc ---

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff.
 *
 * @param fn - Function to retry
 * @param maxRetries - Maximum number of retries
 * @param baseDelayMs - Initial delay between retries (doubles each time)
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        const jitter = Math.random() * delay * 0.1;
        await sleep(delay + jitter);
      }
    }
  }
  throw lastError;
}
