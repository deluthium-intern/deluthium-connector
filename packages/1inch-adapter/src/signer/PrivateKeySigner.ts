import { Wallet } from 'ethers';
import type { TypedDataDomain, TypedDataField } from 'ethers';
import type { ISigner } from '../types.js';

/**
 * An ISigner implementation backed by an ethers Wallet
 * (i.e. a raw private key held in memory).
 */
export class PrivateKeySigner implements ISigner {
  private readonly wallet: Wallet;

  constructor(privateKey: string) {
    this.wallet = new Wallet(privateKey);
  }

  async getAddress(): Promise<string> {
    return this.wallet.address;
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string> {
    return this.wallet.signTypedData(domain, types, value);
  }
}

/**
 * Creates a PrivateKeySigner from a randomly-generated private key.
 * Useful for testing.
 */
export function createRandomSigner(): PrivateKeySigner {
  const wallet = Wallet.createRandom();
  return new PrivateKeySigner(wallet.privateKey);
}
