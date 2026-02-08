/**
 * Tests for @deluthium/uniswapx-adapter - Order Parser
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOrder,
  parseOrders,
  getOrderStatus,
  computeDecayAmount,
  computeCurrentInput,
  computeCurrentOutput,
} from '../src/order-parser.js';
import type { RawUniswapXOrder } from '../src/order-parser.js';
import type { DutchInput, DutchOutput } from '../src/types.js';
import type { Address, HexString } from '@deluthium/sdk';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const BASE_RAW_ORDER: RawUniswapXOrder = {
  orderHash: '0xabc123' as string,
  orderStatus: 'open',
  chainId: 1,
  type: 'Dutch_V2',
  encodedOrder: '0x0000000000000000000000001234567890abcdef1234567890abcdef12345678' as string,
  signature: '0xsig123' as string,
  input: {
    token: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    startAmount: '1000000000000000000',  // 1 ETH
    endAmount: '1100000000000000000',    // 1.1 ETH
  },
  outputs: [
    {
      token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      startAmount: '2000000000',  // 2000 USDC
      endAmount: '1800000000',    // 1800 USDC
      recipient: '0x1234567890abcdef1234567890abcdef12345678',
    },
  ],
  cosignerData: {
    decayStartTime: Math.floor(Date.now() / 1000) - 60,
    decayEndTime: Math.floor(Date.now() / 1000) + 240,
    exclusiveFiller: '0x0000000000000000000000000000000000000000',
    exclusivityOverrideBps: 0,
    inputOverride: '0',
    outputOverrides: ['0'],
  },
  cosigner: '0x1111111111111111111111111111111111111111',
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Order Parser', () => {
  describe('parseOrder', () => {
    it('should parse a DutchV2 order', () => {
      const order = parseOrder(BASE_RAW_ORDER);
      assert.equal(order.orderType, 'DutchV2');
      assert.equal(order.chainId, 1);
      assert.equal(order.orderHash, '0xabc123');
      assert.equal(order.input.startAmount, 1000000000000000000n);
      assert.equal(order.input.endAmount, 1100000000000000000n);
      assert.equal(order.outputs.length, 1);
    });

    it('should parse an ExclusiveDutch order', () => {
      const raw: RawUniswapXOrder = {
        ...BASE_RAW_ORDER,
        type: 'Dutch',
        decayStartTime: Math.floor(Date.now() / 1000),
        decayEndTime: Math.floor(Date.now() / 1000) + 300,
      };
      const order = parseOrder(raw);
      assert.equal(order.orderType, 'ExclusiveDutch');
    });

    it('should parse a Priority order', () => {
      const raw: RawUniswapXOrder = {
        ...BASE_RAW_ORDER,
        type: 'Priority',
        basePriorityFee: '1000000000',
      };
      const order = parseOrder(raw);
      assert.equal(order.orderType, 'Priority');
      if (order.orderType === 'Priority') {
        assert.equal(order.basePriorityFee, 1000000000n);
      }
    });

    it('should throw on unknown order type', () => {
      const raw: RawUniswapXOrder = { ...BASE_RAW_ORDER, type: 'unknown_type' };
      assert.throws(() => parseOrder(raw), /Unrecognized UniswapX order type/);
    });
  });

  describe('parseOrders', () => {
    it('should parse valid orders and skip malformed ones', () => {
      const rawOrders: RawUniswapXOrder[] = [
        BASE_RAW_ORDER,
        { ...BASE_RAW_ORDER, type: 'invalid_garbage' },
        { ...BASE_RAW_ORDER, orderHash: '0xdef456' },
      ];
      const parsed = parseOrders(rawOrders);
      assert.equal(parsed.length, 2);
    });

    it('should return empty array for empty input', () => {
      const parsed = parseOrders([]);
      assert.equal(parsed.length, 0);
    });
  });

  describe('getOrderStatus', () => {
    it('should return "open" for a future deadline', () => {
      const order = parseOrder(BASE_RAW_ORDER);
      const status = getOrderStatus(order, Math.floor(Date.now() / 1000));
      assert.equal(status, 'open');
    });

    it('should return "expired" for a past deadline', () => {
      const order = parseOrder(BASE_RAW_ORDER);
      const status = getOrderStatus(order, order.deadline + 100);
      assert.equal(status, 'expired');
    });
  });

  describe('computeDecayAmount', () => {
    it('should return startAmount before decay starts', () => {
      const result = computeDecayAmount(1000n, 500n, 100, 200, 50);
      assert.equal(result, 1000n);
    });

    it('should return endAmount after decay ends', () => {
      const result = computeDecayAmount(1000n, 500n, 100, 200, 250);
      assert.equal(result, 500n);
    });

    it('should return midpoint at halfway', () => {
      const result = computeDecayAmount(1000n, 500n, 100, 200, 150);
      assert.equal(result, 750n);
    });

    it('should handle increasing amounts', () => {
      const result = computeDecayAmount(500n, 1000n, 100, 200, 150);
      assert.equal(result, 750n);
    });

    it('should handle zero duration', () => {
      const result = computeDecayAmount(1000n, 500n, 100, 100, 100);
      assert.equal(result, 1000n);
    });
  });

  describe('computeCurrentInput', () => {
    it('should compute decayed input amount', () => {
      const input: DutchInput = {
        token: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
        startAmount: 1000000000000000000n,
        endAmount: 1100000000000000000n,
      };
      const result = computeCurrentInput(input, 100, 200, 150);
      // Should be between start and end at midpoint
      assert.ok(result > 1000000000000000000n);
      assert.ok(result < 1100000000000000000n);
    });
  });

  describe('computeCurrentOutput', () => {
    it('should compute decayed output amount', () => {
      const output: DutchOutput = {
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
        startAmount: 2000000000n,
        endAmount: 1800000000n,
        recipient: '0x1234567890abcdef1234567890abcdef12345678' as Address,
      };
      const result = computeCurrentOutput(output, 100, 200, 150);
      // Should be between start and end at midpoint
      assert.ok(result < 2000000000n);
      assert.ok(result > 1800000000n);
    });
  });
});
