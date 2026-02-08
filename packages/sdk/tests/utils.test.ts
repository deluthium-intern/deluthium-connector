import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toWei,
  fromWei,
  parseAmount,
  formatAmount,
  normalizeAddress,
  isValidAddress,
  isNativeToken,
  calculateDeadline,
  isExpired,
  applySlippage,
  generateNonce,
} from '../src/utils/index.js';
import { ZERO_ADDRESS } from '../src/types/index.js';

describe('toWei', () => {
  it('converts whole numbers', () => {
    assert.equal(toWei('1', 18), '1000000000000000000');
    assert.equal(toWei('100', 6), '100000000');
  });

  it('converts decimals', () => {
    assert.equal(toWei('1.5', 18), '1500000000000000000');
    assert.equal(toWei('0.1', 18), '100000000000000000');
  });

  it('handles zero', () => {
    assert.equal(toWei('0', 18), '0');
    assert.equal(toWei('0.0', 18), '0');
  });

  it('truncates excess decimals without rounding', () => {
    assert.equal(toWei('1.123456789', 6), '1123456');
  });

  it('works with number input', () => {
    assert.equal(toWei(1.5, 18), '1500000000000000000');
  });
});

describe('fromWei', () => {
  it('converts wei to decimal', () => {
    assert.equal(fromWei('1500000000000000000', 18), '1.5');
    assert.equal(fromWei('100000000', 6), '100.0');
  });

  it('handles zero', () => {
    assert.equal(fromWei('0', 18), '0.0');
  });

  it('handles small amounts', () => {
    assert.equal(fromWei('1', 18), '0.000000000000000001');
  });

  it('works with bigint input', () => {
    assert.equal(fromWei(1500000000000000000n, 18), '1.5');
  });
});

describe('parseAmount / formatAmount', () => {
  it('round-trips correctly', () => {
    const wei = parseAmount('1.5', 18);
    assert.equal(wei, 1500000000000000000n);
    assert.equal(formatAmount(wei, 18), '1.5');
  });
});

describe('normalizeAddress', () => {
  it('checksums a valid address', () => {
    const addr = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
    const result = normalizeAddress(addr);
    assert.equal(result, '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c');
  });

  it('returns zero address unchanged', () => {
    assert.equal(normalizeAddress(ZERO_ADDRESS), ZERO_ADDRESS);
  });

  it('throws on invalid address', () => {
    assert.throws(() => normalizeAddress('not-an-address'));
  });
});

describe('isValidAddress', () => {
  it('returns true for valid addresses', () => {
    assert.equal(isValidAddress('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'), true);
    assert.equal(isValidAddress(ZERO_ADDRESS), true);
  });

  it('returns false for invalid', () => {
    assert.equal(isValidAddress('0xinvalid'), false);
    assert.equal(isValidAddress(''), false);
  });
});

describe('isNativeToken', () => {
  it('returns true for zero address', () => {
    assert.equal(isNativeToken(ZERO_ADDRESS), true);
  });

  it('returns false for non-zero', () => {
    assert.equal(isNativeToken('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'), false);
  });
});

describe('calculateDeadline / isExpired', () => {
  it('calculates future deadline', () => {
    const deadline = calculateDeadline(60);
    const now = Math.floor(Date.now() / 1000);
    assert.ok(deadline >= now + 59 && deadline <= now + 61);
  });

  it('detects expired deadlines', () => {
    const pastDeadline = Math.floor(Date.now() / 1000) - 10;
    assert.equal(isExpired(pastDeadline), true);
  });

  it('detects non-expired deadlines', () => {
    const futureDeadline = Math.floor(Date.now() / 1000) + 60;
    assert.equal(isExpired(futureDeadline), false);
  });
});

describe('applySlippage', () => {
  it('reduces amount by slippage percentage', () => {
    // 1000 with 0.5% slippage = 995
    assert.equal(applySlippage('1000', 0.5), '995');
  });

  it('handles zero slippage', () => {
    assert.equal(applySlippage('1000', 0), '1000');
  });

  it('throws on negative slippage', () => {
    assert.throws(() => applySlippage('1000', -1));
  });
});

describe('generateNonce', () => {
  it('generates a non-negative bigint', () => {
    const nonce = generateNonce();
    assert.equal(typeof nonce, 'bigint');
    assert.ok(nonce >= 0n);
  });

  it('generates different values', () => {
    const nonces = new Set<bigint>();
    for (let i = 0; i < 100; i++) {
      nonces.add(generateNonce());
    }
    // Should be mostly unique (allowing for astronomically unlikely collisions)
    assert.ok(nonces.size > 90);
  });
});
