/**
 * Input validation for 0x adapter.
 *
 * Addresses CRIT-02 from code review: validates addresses, amounts, expiry,
 * and chain support before transformation.
 */

import { isValidAddress, tryGetChainConfig } from '@deluthium/sdk';
import { ValidationError } from '@deluthium/sdk';
import type { ZeroExV4RFQOrder } from './types.js';

/**
 * Validate a 0x RFQ order before transformation.
 * Throws ValidationError on invalid input.
 */
export function validateZeroExOrder(order: ZeroExV4RFQOrder, chainId: number): void {
  // Chain must be supported
  const chain = tryGetChainConfig(chainId);
  if (!chain) {
    throw new ValidationError(`Unsupported chain ID: ${chainId}`, 'chainId');
  }

  // Token addresses
  if (!order.makerToken || !isValidAddress(order.makerToken)) {
    throw new ValidationError(
      `Invalid makerToken address: ${order.makerToken}`,
      'makerToken',
    );
  }
  if (!order.takerToken || !isValidAddress(order.takerToken)) {
    throw new ValidationError(
      `Invalid takerToken address: ${order.takerToken}`,
      'takerToken',
    );
  }

  // Amounts must be positive
  let makerAmountBigint: bigint;
  let takerAmountBigint: bigint;
  try {
    makerAmountBigint = BigInt(order.makerAmount);
  } catch {
    throw new ValidationError(
      `Invalid makerAmount: ${order.makerAmount}`,
      'makerAmount',
    );
  }
  try {
    takerAmountBigint = BigInt(order.takerAmount);
  } catch {
    throw new ValidationError(
      `Invalid takerAmount: ${order.takerAmount}`,
      'takerAmount',
    );
  }

  if (makerAmountBigint <= 0n) {
    throw new ValidationError('makerAmount must be positive', 'makerAmount');
  }
  if (takerAmountBigint <= 0n) {
    throw new ValidationError('takerAmount must be positive', 'takerAmount');
  }

  // txOrigin must be valid
  if (!order.txOrigin || !isValidAddress(order.txOrigin)) {
    throw new ValidationError(
      `Invalid txOrigin address: ${order.txOrigin}`,
      'txOrigin',
    );
  }

  // Expiry should be in the future
  const now = Math.floor(Date.now() / 1000);
  if (order.expiry <= now) {
    throw new ValidationError(
      `Order has expired: expiry ${order.expiry} <= now ${now}`,
      'expiry',
    );
  }

  // Salt must be parseable as BigInt
  try {
    BigInt(order.salt);
  } catch {
    throw new ValidationError(`Invalid salt: ${order.salt}`, 'salt');
  }
}
