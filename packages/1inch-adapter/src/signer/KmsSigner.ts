import type { TypedDataDomain, TypedDataField } from 'ethers';
import type { ISigner } from '../types.js';

/**
 * Configuration for the AWS KMS-backed signer.
 */
export interface KmsSignerConfig {
  /** The AWS KMS key ID or ARN. */
  keyId: string;
  /** AWS region (e.g. 'us-east-1'). */
  region?: string;
  /** Optional pre-resolved Ethereum address for the KMS key. */
  address?: string;
}

/**
 * Placeholder ISigner implementation that delegates to AWS KMS.
 *
 * This class is not yet implemented and will throw on every operation.
 * It exists so that dependents can reference the type and configuration
 * interface while the real implementation is being developed.
 */
export class KmsSigner implements ISigner {
  public readonly config: KmsSignerConfig;

  constructor(config: KmsSignerConfig) {
    this.config = config;
  }

  async getAddress(): Promise<string> {
    throw new Error(
      'KmsSigner.getAddress() is not implemented. ' +
        'Provide a concrete KMS signing integration or use PrivateKeySigner for testing.',
    );
  }

  async signTypedData(
    _domain: TypedDataDomain,
    _types: Record<string, TypedDataField[]>,
    _value: Record<string, unknown>,
  ): Promise<string> {
    throw new Error(
      'KmsSigner.signTypedData() is not implemented. ' +
        'Provide a concrete KMS signing integration or use PrivateKeySigner for testing.',
    );
  }
}
