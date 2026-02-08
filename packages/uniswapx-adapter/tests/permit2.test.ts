/**
 * Tests for @deluthium/uniswapx-adapter - Permit2 Utilities
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERMIT2_ADDRESS,
  MAX_UINT160,
  MAX_UINT48,
  validatePermitDeadline,
  isAllowanceSufficient,
} from '../src/permit2.js';

describe('Permit2 Utilities', () => {
  describe('Constants', () => {
    it('should have canonical Permit2 address', () => {
      assert.equal(PERMIT2_ADDRESS, '0x000000000022D473030F116dDEE9F6B43aC78BA3');
    });

    it('should have correct MAX_UINT160', () => {
      assert.equal(MAX_UINT160, (1n << 160n) - 1n);
    });

    it('should have correct MAX_UINT48', () => {
      assert.equal(MAX_UINT48, (1n << 48n) - 1n);
    });
  });

  describe('validatePermitDeadline', () => {
    it('should not throw for future deadline', () => {
      const futureDeadline = Math.floor(Date.now() / 1000) + 3600;
      assert.doesNotThrow(() => validatePermitDeadline(futureDeadline));
    });

    it('should throw for past deadline', () => {
      const pastDeadline = Math.floor(Date.now() / 1000) - 3600;
      assert.throws(() => validatePermitDeadline(pastDeadline), /expired/);
    });
  });

  describe('isAllowanceSufficient', () => {
    it('should return true when allowance covers required amount', () => {
      const futureExpiration = Math.floor(Date.now() / 1000) + 3600;
      assert.ok(isAllowanceSufficient(1000n, futureExpiration, 500n));
    });

    it('should return false when allowance is less than required', () => {
      const futureExpiration = Math.floor(Date.now() / 1000) + 3600;
      assert.ok(!isAllowanceSufficient(100n, futureExpiration, 500n));
    });

    it('should return false when allowance is expired', () => {
      const pastExpiration = Math.floor(Date.now() / 1000) - 3600;
      assert.ok(!isAllowanceSufficient(1000n, pastExpiration, 500n));
    });

    it('should return true when amount equals allowance exactly', () => {
      const futureExpiration = Math.floor(Date.now() / 1000) + 3600;
      assert.ok(isAllowanceSufficient(500n, futureExpiration, 500n));
    });
  });
});
