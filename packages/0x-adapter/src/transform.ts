/**
 * Transform functions: 0x Protocol v4 RFQ <-> Deluthium MMQuote.
 *
 * Core mapping logic between 0x and Deluthium field formats.
 * Uses @deluthium/sdk for chain config, address utilities, and signing.
 */

import { ethers } from 'ethers';
import {
  getRfqManagerAddress,
  normalizeAddress,
  resolveTokenAddress,
  ZERO_ADDRESS,
  type MMQuoteParams,
  type ISigner,
  signMMQuote,
} from '@deluthium/sdk';

import type { ZeroExV4RFQOrder } from './types.js';
import { validateZeroExOrder } from './validation.js';

/** Default extraDataHash when extraData is "0x" (empty bytes) */
export const DEFAULT_EXTRA_DATA_HASH = ethers.keccak256('0x');

/**
 * Transform a 0x Protocol v4 RFQ Order to Deluthium MMQuote parameters.
 *
 * Field Mapping:
 * - makerToken  -> outputToken (what MM provides to user)
 * - takerToken  -> inputToken  (what user pays to MM)
 * - makerAmount -> amountOut
 * - takerAmount -> amountIn
 * - txOrigin    -> from        (user's sending address)
 * - taker       -> to          (user's receiving address, fallback to txOrigin)
 * - expiry      -> deadline
 * - salt        -> nonce
 *
 * @param order - 0x v4 RFQ order to transform
 * @param chainId - Target chain ID for RFQ Manager lookup
 * @param toAddress - Optional override for 'to' address
 * @param extraData - Optional extra data bytes (default "0x")
 * @param validate - Whether to validate the order (default true)
 */
export function transform0xToDarkPool(
  order: ZeroExV4RFQOrder,
  chainId: number,
  toAddress?: string,
  extraData: string = '0x',
  validate: boolean = true,
): MMQuoteParams {
  if (validate) {
    validateZeroExOrder(order, chainId);
  }

  const manager = getRfqManagerAddress(chainId);

  // Determine 'to' address: explicit override > taker (if not zero) > txOrigin
  let resolvedTo = toAddress;
  if (!resolvedTo) {
    resolvedTo = !isNativeToken(order.taker) ? order.taker : order.txOrigin;
  }

  return {
    manager,
    from: normalizeAddress(order.txOrigin),
    to: normalizeAddress(resolvedTo),
    inputToken: normalizeAddress(order.takerToken),
    outputToken: normalizeAddress(order.makerToken),
    amountIn: BigInt(order.takerAmount),
    amountOut: BigInt(order.makerAmount),
    deadline: order.expiry,
    nonce: BigInt(order.salt),
    extraData,
  };
}

/**
 * Check if a token address represents Native Token (zero address).
 * Case-insensitive comparison fixing HIGH-04 from code review.
 */
export function isNativeToken(tokenAddress: string): boolean {
  if (!tokenAddress) return false;
  const lower = tokenAddress.toLowerCase();
  return lower === ZERO_ADDRESS.toLowerCase() || lower === '0x0';
}

/**
 * Get the wrapped token address for a chain's native token.
 * Delegates to SDK's resolveTokenAddress.
 */
export function getWrappedTokenAddress(chainId: number): string {
  return resolveTokenAddress(ZERO_ADDRESS, chainId);
}

/**
 * Convert Native Token address to Wrapped Token address if needed.
 */
export function normalizeTokenAddress(tokenAddress: string, chainId: number): string {
  if (isNativeToken(tokenAddress)) {
    return getWrappedTokenAddress(chainId);
  }
  return tokenAddress;
}

/**
 * Sign a Deluthium MMQuote using EIP-712 with an ISigner.
 *
 * Addresses CRIT-01 from code review: accepts ISigner abstraction
 * instead of raw private key strings.
 *
 * @param params - MMQuoteParams to sign
 * @param signer - ISigner implementation (PrivateKeySigner, KmsSigner, etc.)
 * @param chainId - Chain ID for EIP-712 domain
 * @returns Signed quote with params, signature, and hash
 */
export async function signDarkPoolQuote(
  params: MMQuoteParams,
  signer: ISigner,
  chainId: number,
): Promise<{ params: MMQuoteParams; signature: string; signer: string }> {
  const signed = await signMMQuote(signer, params, chainId);
  const signerAddress = await signer.getAddress();
  return {
    params: signed.params,
    signature: signed.signature,
    signer: signerAddress,
  };
}

/**
 * Transform a 0x order and sign it for Deluthium.
 * Convenience function combining transform + sign.
 */
export async function transformAndSign0xOrder(
  order: ZeroExV4RFQOrder,
  signer: ISigner,
  chainId: number,
  toAddress?: string,
  extraData: string = '0x',
): Promise<{ params: MMQuoteParams; signature: string; signer: string }> {
  const params = transform0xToDarkPool(order, chainId, toAddress, extraData);
  return signDarkPoolQuote(params, signer, chainId);
}
