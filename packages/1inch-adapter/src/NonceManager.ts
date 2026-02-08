import { randomBytes } from 'crypto';
import { UINT_40_MAX } from './constants.js';
import type { NonceInfo } from './types.js';

/**
 * Manages per-maker nonces (40-bit) and epochs for 1inch Limit-Order-Protocol V4.
 *
 * Each maker address gets its own monotonically-increasing nonce.
 * Nonces wrap around at UINT_40_MAX (≈ 1.1 trillion).
 */
export class NonceManager {
  private readonly nonces: Map<string, NonceInfo> = new Map();
  private currentEpoch: bigint = 0n;

  // ── Nonce Operations ───────────────────────────────────────────────────

  /**
   * Returns the next nonce for the given maker.
   * On first call for a maker the nonce is initialised to a random 40-bit value
   * (to avoid collisions across adapter restarts).
   */
  getNextNonce(makerAddress: string): bigint {
    const key = makerAddress.toLowerCase();
    const existing = this.nonces.get(key);

    if (existing) {
      // Increment, wrapping at 40-bit max
      const next = existing.nonce >= UINT_40_MAX ? 0n : existing.nonce + 1n;
      const info: NonceInfo = {
        nonce: next,
        epoch: this.currentEpoch,
        timestamp: Date.now(),
      };
      this.nonces.set(key, info);
      return next;
    }

    // First call – seed with random nonce
    const initial = NonceManager.generateRandomNonce();
    const info: NonceInfo = {
      nonce: initial,
      epoch: this.currentEpoch,
      timestamp: Date.now(),
    };
    this.nonces.set(key, info);
    return initial;
  }

  /**
   * Returns the full nonce info for a maker, or `undefined` if never initialised.
   */
  getNonceInfo(makerAddress: string): NonceInfo | undefined {
    return this.nonces.get(makerAddress.toLowerCase());
  }

  /**
   * Explicitly sets the nonce for a maker (useful for restoring state).
   */
  setNonce(makerAddress: string, nonce: bigint): void {
    const key = makerAddress.toLowerCase();
    this.nonces.set(key, {
      nonce,
      epoch: this.currentEpoch,
      timestamp: Date.now(),
    });
  }

  // ── Epoch Operations ───────────────────────────────────────────────────

  getEpoch(): bigint {
    return this.currentEpoch;
  }

  advanceEpoch(): bigint {
    this.currentEpoch += 1n;
    return this.currentEpoch;
  }

  setEpoch(epoch: bigint): void {
    this.currentEpoch = epoch;
  }

  // ── Random Generators ──────────────────────────────────────────────────

  /**
   * Generates a random 40-bit nonce.
   */
  static generateRandomNonce(): bigint {
    const bytes = randomBytes(5); // 5 bytes = 40 bits
    let value = 0n;
    for (let i = 0; i < bytes.length; i++) {
      value = (value << 8n) | BigInt(bytes[i]!);
    }
    return value & UINT_40_MAX;
  }

  /**
   * Generates a random 256-bit salt for order uniqueness.
   */
  static generateSalt(): bigint {
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
  static generateSaltWithExtension(extensionAddress?: string): bigint {
    const salt = NonceManager.generateSalt();
    if (!extensionAddress) return salt;
    const addrBigInt = BigInt(extensionAddress);
    // Place the extension address in the lower 160 bits
    const upper = (salt >> 160n) << 160n;
    return upper | (addrBigInt & ((1n << 160n) - 1n));
  }

  // ── Housekeeping ───────────────────────────────────────────────────────

  clear(): void {
    this.nonces.clear();
    this.currentEpoch = 0n;
  }

  get size(): number {
    return this.nonces.size;
  }

  /**
   * Serialises state so it can be persisted and later restored with {@link import_}.
   */
  export(): { epoch: string; nonces: Record<string, { nonce: string; epoch: string; timestamp: number }> } {
    const nonces: Record<string, { nonce: string; epoch: string; timestamp: number }> = {};
    for (const [key, info] of this.nonces.entries()) {
      nonces[key] = {
        nonce: info.nonce.toString(),
        epoch: info.epoch.toString(),
        timestamp: info.timestamp,
      };
    }
    return { epoch: this.currentEpoch.toString(), nonces };
  }

  /**
   * Restores state previously exported via {@link export}.
   */
  import(data: { epoch: string; nonces: Record<string, { nonce: string; epoch: string; timestamp: number }> }): void {
    this.currentEpoch = BigInt(data.epoch);
    this.nonces.clear();
    for (const [key, info] of Object.entries(data.nonces)) {
      this.nonces.set(key, {
        nonce: BigInt(info.nonce),
        epoch: BigInt(info.epoch),
        timestamp: info.timestamp,
      });
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let defaultNonceManager: NonceManager | undefined;

/**
 * Returns the global singleton {@link NonceManager}.
 */
export function getDefaultNonceManager(): NonceManager {
  if (!defaultNonceManager) {
    defaultNonceManager = new NonceManager();
  }
  return defaultNonceManager;
}

/**
 * Resets (destroys) the global singleton so the next call to
 * {@link getDefaultNonceManager} creates a fresh instance.
 */
export function resetDefaultNonceManager(): void {
  defaultNonceManager = undefined;
}
