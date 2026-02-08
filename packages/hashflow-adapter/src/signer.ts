/**
 * @deluthium/hashflow-adapter - Signing Utilities
 *
 * Implements Hashflow-specific signing for:
 * - EIP-191 personal_sign for RFQ quote signatures (EVM chains)
 * - Quote data hashing for on-chain verification
 * - Authentication challenge signing
 */

import {
  keccak256,
  AbiCoder,
  getBytes,
  hexlify,
  randomBytes,
} from 'ethers';
import type { ISigner, HexString } from '@deluthium/sdk';
import { SigningError } from '@deluthium/sdk';
import type { HashflowQuoteData, CrossChainQuoteData } from './types.js';

const abiCoder = AbiCoder.defaultAbiCoder();

// ─── Quote Signing ──────────────────────────────────────────────────────────

/**
 * Sign a Hashflow RFQ quote using EIP-191 (personal_sign).
 *
 * @param signer - ISigner implementation
 * @param quoteData - Quote data to sign
 * @returns Hex-encoded EIP-191 signature
 */
export async function signHashflowQuote(
  signer: ISigner,
  quoteData: HashflowQuoteData,
): Promise<HexString> {
  try {
    const messageHash = hashQuoteData(quoteData);
    const messageBytes = getBytes(messageHash);
    const signature = await signer.signMessage(messageBytes);
    return signature as HexString;
  } catch (err) {
    if (err instanceof SigningError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new SigningError(`Failed to sign Hashflow quote: ${message}`);
  }
}

/**
 * Sign a cross-chain Hashflow quote using EIP-191.
 *
 * @param signer - ISigner implementation
 * @param quoteData - Cross-chain quote data to sign
 * @returns Hex-encoded EIP-191 signature
 */
export async function signCrossChainQuote(
  signer: ISigner,
  quoteData: CrossChainQuoteData,
): Promise<HexString> {
  try {
    const messageHash = hashCrossChainQuoteData(quoteData);
    const messageBytes = getBytes(messageHash);
    const signature = await signer.signMessage(messageBytes);
    return signature as HexString;
  } catch (err) {
    if (err instanceof SigningError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new SigningError(`Failed to sign cross-chain Hashflow quote: ${message}`);
  }
}

// ─── Quote Hashing ──────────────────────────────────────────────────────────

/**
 * Hash quote data for signing.
 *
 * @param quoteData - Quote data to hash
 * @returns keccak256 hash as hex string
 */
export function hashQuoteData(quoteData: HashflowQuoteData): HexString {
  const encoded = abiCoder.encode(
    [
      'address', // pool
      'address', // externalAccount
      'address', // effectiveTrader
      'address', // baseToken
      'address', // quoteToken
      'uint256', // baseTokenAmount
      'uint256', // quoteTokenAmount
      'uint256', // nonce
      'bytes32', // txid
      'uint256', // quoteExpiry
    ],
    [
      quoteData.pool,
      quoteData.externalAccount,
      quoteData.effectiveTrader,
      quoteData.baseToken,
      quoteData.quoteToken,
      quoteData.baseTokenAmount,
      quoteData.quoteTokenAmount,
      quoteData.nonce,
      quoteData.txid,
      quoteData.quoteExpiry,
    ],
  );

  return keccak256(encoded) as HexString;
}

/**
 * Hash cross-chain quote data for signing.
 *
 * @param quoteData - Cross-chain quote data
 * @returns keccak256 hash as hex string
 */
export function hashCrossChainQuoteData(quoteData: CrossChainQuoteData): HexString {
  const encoded = abiCoder.encode(
    [
      'address', // pool
      'address', // externalAccount
      'address', // effectiveTrader
      'address', // baseToken
      'address', // quoteToken
      'uint256', // baseTokenAmount
      'uint256', // quoteTokenAmount
      'uint256', // nonce
      'bytes32', // txid
      'uint256', // quoteExpiry
      'uint256', // dstChainId
      'address', // dstPool
      'address', // dstExternalAccount
    ],
    [
      quoteData.pool,
      quoteData.externalAccount,
      quoteData.effectiveTrader,
      quoteData.baseToken,
      quoteData.quoteToken,
      quoteData.baseTokenAmount,
      quoteData.quoteTokenAmount,
      quoteData.nonce,
      quoteData.txid,
      quoteData.quoteExpiry,
      quoteData.dstChainId,
      quoteData.dstPool,
      quoteData.dstExternalAccount,
    ],
  );

  return keccak256(encoded) as HexString;
}

// ─── Transaction ID Generation ──────────────────────────────────────────────

/**
 * Generate a unique transaction ID for a Hashflow quote.
 */
export function generateTxid(): HexString {
  return hexlify(randomBytes(32)) as HexString;
}

/**
 * Generate a nonce for Hashflow quote replay protection.
 */
export function generateHashflowNonce(): bigint {
  const timestamp = BigInt(Date.now());
  const random = BigInt(hexlify(randomBytes(8)));
  return (timestamp << 64n) | random;
}

// ─── Authentication Signing ─────────────────────────────────────────────────

/**
 * Sign the Hashflow authentication challenge.
 *
 * @param signer - ISigner implementation
 * @param marketMaker - Market maker identifier
 * @returns EIP-191 signature of the auth challenge
 */
export async function signAuthChallenge(
  signer: ISigner,
  marketMaker: string,
): Promise<HexString> {
  try {
    const challenge = `Hashflow MM Auth: ${marketMaker}`;
    const signature = await signer.signMessage(challenge);
    return signature as HexString;
  } catch (err) {
    if (err instanceof SigningError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new SigningError(`Failed to sign Hashflow auth challenge: ${message}`);
  }
}
