import { TypedDataEncoder } from 'ethers';
import type { TypedDataDomain, TypedDataField } from 'ethers';
import { randomBytes } from 'crypto';
import type { OneInchOrderV4 } from './types.js';
import { ORDER_TYPES } from './types.js';
import { getOneInchDomain } from './constants.js';

// ── Salt Generation ──────────────────────────────────────────────────────────

/**
 * Generates a random 256-bit salt for order uniqueness.
 */
export function generateSalt(): bigint {
  const bytes = randomBytes(32);
  let value = 0n;
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8n) | BigInt(bytes[i]!);
  }
  return value;
}

/**
 * Generates a 256-bit salt whose lower 160 bits contain an optional extension address.
 */
export function generateSaltWithExtension(extensionAddress?: string): bigint {
  const salt = generateSalt();
  if (!extensionAddress) return salt;
  const addrBigInt = BigInt(extensionAddress);
  const upper = (salt >> 160n) << 160n;
  return upper | (addrBigInt & ((1n << 160n) - 1n));
}

// ── EIP-712 Hashing ──────────────────────────────────────────────────────────

/**
 * Computes the EIP-712 hash of a 1inch V4 order using the given chain's domain.
 */
export function computeOrderHash(order: OneInchOrderV4, chainId: number): string {
  const domain: TypedDataDomain = getOneInchDomain(chainId);
  const types: Record<string, TypedDataField[]> = {
    Order: ORDER_TYPES.Order as unknown as TypedDataField[],
  };
  const values: Record<string, unknown> = {
    salt: order.salt,
    maker: order.maker,
    receiver: order.receiver,
    makerAsset: order.makerAsset,
    takerAsset: order.takerAsset,
    makingAmount: order.makingAmount,
    takingAmount: order.takingAmount,
    makerTraits: order.makerTraits,
  };
  return TypedDataEncoder.hash(domain, types, values);
}

// ── Numeric Conversions ──────────────────────────────────────────────────────

/**
 * Converts a bigint to a 0x-prefixed hex string, zero-padded to 64 hex chars.
 */
export function bigintToHex(value: bigint): string {
  return '0x' + value.toString(16).padStart(64, '0');
}

/**
 * Parses a hex string (with or without 0x prefix) into a bigint.
 */
export function hexToBigint(hex: string): bigint {
  return BigInt(hex.startsWith('0x') ? hex : `0x${hex}`);
}

// ── Time Helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the current unix timestamp in seconds.
 */
export function currentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Returns a deadline `bufferSeconds` in the future.
 */
export function calculateDeadline(bufferSeconds: number): number {
  return currentTimestamp() + bufferSeconds;
}

/**
 * Returns `true` when the given unix-seconds deadline is in the past.
 */
export function isExpired(deadline: number): boolean {
  return deadline < currentTimestamp();
}

// ── Amount Formatting ────────────────────────────────────────────────────────

/**
 * Formats a bigint token amount into a human-readable decimal string.
 */
export function formatAmount(amount: bigint, decimals: number): string {
  const str = amount.toString().padStart(decimals + 1, '0');
  const intPart = str.slice(0, str.length - decimals) || '0';
  const fracPart = str.slice(str.length - decimals);
  // Trim trailing zeros in the fractional part
  const trimmed = fracPart.replace(/0+$/, '');
  return trimmed ? `${intPart}.${trimmed}` : intPart;
}

/**
 * Parses a human-readable decimal string into a bigint with the given decimals.
 */
export function parseAmount(amount: string, decimals: number): bigint {
  const [intPart = '0', fracPart = ''] = amount.split('.');
  const paddedFrac = fracPart.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(intPart + paddedFrac);
}

// ── Async Utilities ──────────────────────────────────────────────────────────

/**
 * Returns a promise that resolves after `ms` milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries the given async function up to `maxRetries` times with exponential back-off.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * 2 ** attempt;
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

// ── Object Utilities ─────────────────────────────────────────────────────────

/**
 * Deep-clones a JSON-serialisable value.
 */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, v) =>
    typeof v === 'bigint' ? v.toString() : v,
  )) as T;
}

// ── Signature Utilities ──────────────────────────────────────────────────────

/**
 * Converts a 65-byte ECDSA signature (r, s, v) into the compact 64-byte
 * EIP-2098 format expected by the 1inch router.
 *
 * Input : 0x + r(32 bytes) + s(32 bytes) + v(1 byte)   = 132 hex chars
 * Output: 0x + r(32 bytes) + yParityAndS(32 bytes)      = 128 hex chars
 */
export function compactSignature(signature: string): string {
  const raw = signature.startsWith('0x') ? signature.slice(2) : signature;

  if (raw.length === 128) {
    // Already compact (64 bytes)
    return '0x' + raw;
  }

  if (raw.length !== 130) {
    throw new Error(`Invalid signature length: expected 130 hex chars, got ${raw.length}`);
  }

  const r = raw.slice(0, 64);
  const s = raw.slice(64, 128);
  const v = parseInt(raw.slice(128, 130), 16);

  // EIP-2098: yParity is encoded in the highest bit of s
  const yParity = v - 27; // 0 or 1
  if (yParity !== 0 && yParity !== 1) {
    throw new Error(`Invalid v value: ${v}`);
  }

  // Set the high bit of s if yParity === 1
  const sBigInt = BigInt('0x' + s);
  const compactS = yParity === 1 ? sBigInt | (1n << 255n) : sBigInt;
  const compactSHex = compactS.toString(16).padStart(64, '0');

  return '0x' + r + compactSHex;
}
