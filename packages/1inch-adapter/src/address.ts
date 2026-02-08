import { getAddress as ethersGetAddress, isAddress as ethersIsAddress } from 'ethers';
import { ValidationError } from './errors.js';
import { NATIVE_TOKEN_ADDRESS } from './constants.js';

/**
 * Returns a checksummed address. Throws {@link ValidationError} for invalid input.
 */
export function normalizeAddress(address: string, fieldName?: string): string {
  if (!ethersIsAddress(address)) {
    throw new ValidationError(
      `Invalid address${fieldName ? ` for ${fieldName}` : ''}: ${address}`,
      fieldName,
      address,
    );
  }
  return ethersGetAddress(address);
}

/**
 * Returns `true` when the string is a valid Ethereum address (checksum not required).
 */
export function isValidAddress(address: string): boolean {
  return ethersIsAddress(address);
}

/**
 * Returns `true` when the address matches the well-known native-token sentinel.
 */
export function isNativeTokenAddress(address: string): boolean {
  if (!ethersIsAddress(address)) return false;
  return ethersGetAddress(address) === ethersGetAddress(NATIVE_TOKEN_ADDRESS);
}

/**
 * Case-insensitive comparison of two Ethereum addresses.
 */
export function addressEquals(a: string, b: string): boolean {
  if (!ethersIsAddress(a) || !ethersIsAddress(b)) return false;
  return ethersGetAddress(a) === ethersGetAddress(b);
}

/**
 * Returns the first `bytes` bytes of the address as a hex string (with `0x` prefix).
 * Useful for packed-encoding (e.g. allowed-sender in maker traits).
 */
export function extractAddressBytes(address: string, bytes: number = 10): string {
  const normalized = normalizeAddress(address);
  // 2 hex chars per byte + `0x` prefix
  return normalized.slice(0, 2 + bytes * 2).toLowerCase();
}

/**
 * Returns a shortened address for display: `0xAbCd...1234`.
 */
export function formatAddress(address: string, chars: number = 4): string {
  if (!ethersIsAddress(address)) return address;
  const normalized = ethersGetAddress(address);
  return `${normalized.slice(0, chars + 2)}...${normalized.slice(-chars)}`;
}
