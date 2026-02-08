/**
 * Tests for @deluthium/hashflow-adapter - Signing Utilities
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrivateKeySigner } from '@deluthium/sdk';
import {
  signHashflowQuote,
  hashQuoteData,
  generateTxid,
  generateHashflowNonce,
  signAuthChallenge,
} from '../src/signer.js';
import type { HashflowQuoteData } from '../src/types.js';
import type { Address, HexString } from '@deluthium/sdk';

// Use a test private key (never use in production)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

describe('Hashflow Signer', () => {
  const signer = new PrivateKeySigner(TEST_PRIVATE_KEY);

  const testQuoteData: HashflowQuoteData = {
    pool: '0x1234567890abcdef1234567890abcdef12345678' as Address,
    externalAccount: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address,
    effectiveTrader: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address,
    baseToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
    quoteToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
    baseTokenAmount: 1000000000000000000n, // 1 ETH
    quoteTokenAmount: 2000000000n, // 2000 USDC
    nonce: 12345n,
    txid: '0x0000000000000000000000000000000000000000000000000000000000000001' as HexString,
    quoteExpiry: Math.floor(Date.now() / 1000) + 300,
  };

  describe('hashQuoteData', () => {
    it('should return a 66-character hex hash', () => {
      const hash = hashQuoteData(testQuoteData);
      assert.ok(hash.startsWith('0x'));
      assert.equal(hash.length, 66);
    });

    it('should produce deterministic hashes', () => {
      const hash1 = hashQuoteData(testQuoteData);
      const hash2 = hashQuoteData(testQuoteData);
      assert.equal(hash1, hash2);
    });

    it('should produce different hashes for different data', () => {
      const hash1 = hashQuoteData(testQuoteData);
      const hash2 = hashQuoteData({ ...testQuoteData, nonce: 99999n });
      assert.notEqual(hash1, hash2);
    });
  });

  describe('signHashflowQuote', () => {
    it('should produce a valid EIP-191 signature', async () => {
      const sig = await signHashflowQuote(signer, testQuoteData);
      assert.ok(sig.startsWith('0x'));
      // EIP-191 signatures are 65 bytes = 130 hex chars + 0x prefix
      assert.equal(sig.length, 132);
    });

    it('should produce different signatures for different data', async () => {
      const sig1 = await signHashflowQuote(signer, testQuoteData);
      const sig2 = await signHashflowQuote(signer, { ...testQuoteData, nonce: 99999n });
      assert.notEqual(sig1, sig2);
    });
  });

  describe('generateTxid', () => {
    it('should return a 66-character hex string', () => {
      const txid = generateTxid();
      assert.ok(txid.startsWith('0x'));
      assert.equal(txid.length, 66);
    });

    it('should generate unique txids', () => {
      const txid1 = generateTxid();
      const txid2 = generateTxid();
      assert.notEqual(txid1, txid2);
    });
  });

  describe('generateHashflowNonce', () => {
    it('should return a positive bigint', () => {
      const nonce = generateHashflowNonce();
      assert.ok(nonce > 0n);
    });

    it('should generate unique nonces', () => {
      const nonce1 = generateHashflowNonce();
      const nonce2 = generateHashflowNonce();
      assert.notEqual(nonce1, nonce2);
    });
  });

  describe('signAuthChallenge', () => {
    it('should sign a Hashflow auth challenge', async () => {
      const sig = await signAuthChallenge(signer, 'test-mm');
      assert.ok(sig.startsWith('0x'));
      assert.equal(sig.length, 132);
    });
  });
});
