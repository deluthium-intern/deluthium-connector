/**
 * @deluthium/sdk - Signer abstraction
 *
 * ISigner interface with implementations for:
 * - PrivateKeySigner (development / testing)
 * - KmsSigner (AWS KMS -- production placeholder)
 * - VaultSigner (HashiCorp Vault -- production placeholder)
 *
 * Also includes EIP-712 MMQuote signing helpers.
 */

import { Wallet, keccak256 as ethersKeccak256, TypedDataEncoder } from 'ethers';
import type {
  ISigner,
  TypedDataDomain,
  TypedDataField,
  MMQuoteParams,
  MMQuoteDomain,
  SignedMMQuote,
  HexString,
} from '../types/index.js';
import { SigningError } from '../errors/index.js';
import { getRfqManagerAddress } from '../chain/index.js';

// ─── EIP-712 Type Definitions ────────────────────────────────────────────────

/** EIP-712 type definition for MMQuote signing */
export const MM_QUOTE_TYPES: Record<string, TypedDataField[]> = {
  MMQuote: [
    { name: 'manager', type: 'address' },
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'inputToken', type: 'address' },
    { name: 'outputToken', type: 'address' },
    { name: 'amountIn', type: 'uint256' },
    { name: 'amountOut', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'extraDataHash', type: 'bytes32' },
  ],
};

// ─── EIP-712 Domain Builder ──────────────────────────────────────────────────

/**
 * Build the EIP-712 domain for MMQuote signing.
 *
 * @param chainId - Chain ID (must have an RFQ Manager deployed)
 * @returns EIP-712 domain object
 */
export function buildMMQuoteDomain(chainId: number): MMQuoteDomain {
  const rfqManager = getRfqManagerAddress(chainId);
  return {
    name: 'DarkPool Pool',
    version: '1',
    chainId,
    verifyingContract: rfqManager,
  };
}

// ─── MMQuote Signing Helper ──────────────────────────────────────────────────

/**
 * Sign an MMQuote using the provided signer.
 *
 * @param signer - ISigner implementation
 * @param params - MMQuote parameters
 * @param chainId - Chain ID for EIP-712 domain
 * @returns Signed MMQuote with signature and hash
 */
export async function signMMQuote(
  signer: ISigner,
  params: MMQuoteParams,
  chainId: number,
): Promise<SignedMMQuote> {
  try {
    const domain = buildMMQuoteDomain(chainId);
    const extraDataHash = ethersKeccak256(params.extraData || '0x');

    const value = {
      manager: params.manager,
      from: params.from,
      to: params.to,
      inputToken: params.inputToken,
      outputToken: params.outputToken,
      amountIn: params.amountIn.toString(),
      amountOut: params.amountOut.toString(),
      deadline: params.deadline.toString(),
      nonce: params.nonce.toString(),
      extraDataHash,
    };

    const signature = await signer.signTypedData(domain, MM_QUOTE_TYPES, value);

    // Compute the EIP-712 hash
    const hash = TypedDataEncoder.hash(domain, MM_QUOTE_TYPES, value) as HexString;

    return { params, signature, hash };
  } catch (err) {
    if (err instanceof SigningError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new SigningError(`Failed to sign MMQuote: ${message}`);
  }
}

// ─── PrivateKeySigner ────────────────────────────────────────────────────────

/**
 * Signer backed by a raw private key.
 * **For development and testing only** -- never use in production with real keys.
 */
export class PrivateKeySigner implements ISigner {
  private readonly wallet: Wallet;

  constructor(privateKey: string) {
    try {
      this.wallet = new Wallet(privateKey);
    } catch {
      throw new SigningError('Invalid private key');
    }
  }

  async getAddress(): Promise<string> {
    return this.wallet.address;
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string> {
    try {
      return await this.wallet.signTypedData(domain, types, value);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SigningError(`EIP-712 signing failed: ${message}`);
    }
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    try {
      return await this.wallet.signMessage(message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new SigningError(`Message signing failed: ${msg}`);
    }
  }
}

// ─── KmsSigner (Placeholder) ─────────────────────────────────────────────────

/**
 * Signer backed by AWS KMS.
 * Production implementation -- currently a placeholder.
 *
 * In production, this would:
 * 1. Use AWS SDK to call KMS sign/verify operations
 * 2. Derive the Ethereum address from the KMS public key
 * 3. Handle key rotation and caching
 */
export class KmsSigner implements ISigner {
  private readonly keyId: string;
  private readonly region: string;
  private cachedAddress?: string;

  constructor(keyId: string, region = 'us-east-1') {
    this.keyId = keyId;
    this.region = region;
  }

  async getAddress(): Promise<string> {
    if (this.cachedAddress) return this.cachedAddress;
    // TODO: Implement KMS public key retrieval and Ethereum address derivation
    // const kmsClient = new KMSClient({ region: this.region });
    // const pubKey = await kmsClient.send(new GetPublicKeyCommand({ KeyId: this.keyId }));
    // this.cachedAddress = computeAddress(pubKey);
    throw new SigningError(
      `KmsSigner not yet implemented (keyId: ${this.keyId}, region: ${this.region})`,
    );
  }

  async signTypedData(
    _domain: TypedDataDomain,
    _types: Record<string, TypedDataField[]>,
    _value: Record<string, unknown>,
  ): Promise<string> {
    // TODO: Implement KMS EIP-712 signing
    // 1. Compute EIP-712 hash locally
    // 2. Send hash to KMS for signing
    // 3. Convert DER signature to Ethereum signature format (r, s, v)
    throw new SigningError('KmsSigner.signTypedData not yet implemented');
  }

  async signMessage(_message: string | Uint8Array): Promise<string> {
    throw new SigningError('KmsSigner.signMessage not yet implemented');
  }
}

// ─── VaultSigner (Placeholder) ───────────────────────────────────────────────

/**
 * Signer backed by HashiCorp Vault.
 * Production implementation -- currently a placeholder.
 */
export class VaultSigner implements ISigner {
  private readonly vaultUrl: string;
  private readonly keyPath: string;
  private readonly token: string;

  constructor(vaultUrl: string, keyPath: string, token: string) {
    this.vaultUrl = vaultUrl;
    this.keyPath = keyPath;
    this.token = token;
  }

  async getAddress(): Promise<string> {
    // TODO: Retrieve key from Vault and derive address
    throw new SigningError(
      `VaultSigner not yet implemented (url: ${this.vaultUrl}, path: ${this.keyPath}, token: ${this.token.slice(0, 4)}...)`,
    );
  }

  async signTypedData(
    _domain: TypedDataDomain,
    _types: Record<string, TypedDataField[]>,
    _value: Record<string, unknown>,
  ): Promise<string> {
    throw new SigningError('VaultSigner.signTypedData not yet implemented');
  }

  async signMessage(_message: string | Uint8Array): Promise<string> {
    throw new SigningError('VaultSigner.signMessage not yet implemented');
  }
}
