import type { ISigner } from '../types.js';

// Re-export the ISigner interface for convenience
export type { ISigner };

/**
 * Runtime type guard that checks whether the given value satisfies the
 * ISigner interface (duck-typing check).
 */
export function isSigner(value: unknown): value is ISigner {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['getAddress'] === 'function' &&
    typeof obj['signTypedData'] === 'function'
  );
}
