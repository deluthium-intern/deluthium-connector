/**
 * Tests for @deluthium/hashflow-adapter - Cross-Chain Support
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getRoute,
  isRouteSupported,
  getAllRoutes,
  getRoutesFrom,
  getRoutesTo,
  registerRoute,
  validateCrossChainRFQ,
  chainIdToHashflow,
  hashflowToChainId,
  isEVMChain,
  buildCrossChainQuoteData,
} from '../src/cross-chain.js';
import type { HashflowRFQRequest, HashflowQuoteData } from '../src/types.js';
import type { Address, HexString } from '@deluthium/sdk';

describe('Cross-Chain Support', () => {
  describe('Route Management', () => {
    it('should have default routes', () => {
      const routes = getAllRoutes();
      assert.ok(routes.length > 0);
    });

    it('should find ethereum -> arbitrum route', () => {
      const route = getRoute('ethereum', 'arbitrum');
      assert.ok(route);
      assert.equal(route.protocol, 'wormhole');
      assert.ok(route.active);
    });

    it('should return undefined for unsupported routes', () => {
      const route = getRoute('solana', 'ethereum');
      assert.equal(route, undefined);
    });

    it('should support known routes', () => {
      assert.ok(isRouteSupported('ethereum', 'arbitrum'));
      assert.ok(isRouteSupported('ethereum', 'base'));
      assert.ok(!isRouteSupported('solana', 'ethereum'));
    });

    it('should get routes from a chain', () => {
      const routes = getRoutesFrom('ethereum');
      assert.ok(routes.length >= 5);
      for (const route of routes) {
        assert.equal(route.srcChain, 'ethereum');
      }
    });

    it('should get routes to a chain', () => {
      const routes = getRoutesTo('ethereum');
      assert.ok(routes.length >= 3);
      for (const route of routes) {
        assert.equal(route.dstChain, 'ethereum');
      }
    });

    it('should allow registering custom routes', () => {
      registerRoute({
        srcChain: 'polygon',
        dstChain: 'bsc',
        protocol: 'layerzero',
        active: true,
        estimatedFinalitySeconds: 400,
      });
      const route = getRoute('polygon', 'bsc');
      assert.ok(route);
      assert.equal(route.protocol, 'layerzero');
    });
  });

  describe('Chain Utilities', () => {
    it('should convert chain ID to Hashflow name', () => {
      assert.equal(chainIdToHashflow(1), 'ethereum');
      assert.equal(chainIdToHashflow(42161), 'arbitrum');
      assert.equal(chainIdToHashflow(56), 'bsc');
      assert.equal(chainIdToHashflow(999999), undefined);
    });

    it('should convert Hashflow name to chain ID', () => {
      assert.equal(hashflowToChainId('ethereum'), 1);
      assert.equal(hashflowToChainId('arbitrum'), 42161);
      assert.equal(hashflowToChainId('bsc'), 56);
    });

    it('should identify EVM chains', () => {
      assert.ok(isEVMChain('ethereum'));
      assert.ok(isEVMChain('arbitrum'));
      assert.ok(!isEVMChain('solana'));
    });
  });

  describe('validateCrossChainRFQ', () => {
    it('should validate a valid cross-chain request', () => {
      const request = {
        rfqId: 'test-1',
        chain: 'ethereum' as const,
        chainId: 1,
        baseToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
        quoteToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
        baseTokenAmount: '1000000000000000000',
        tradeDirection: 'sell' as const,
        trader: '0x1234567890abcdef1234567890abcdef12345678' as Address,
        responseDeadline: Math.floor(Date.now() / 1000) + 30,
        isCrossChain: true,
        dstChain: 'arbitrum' as const,
        dstChainId: 42161,
      };
      const result = validateCrossChainRFQ(request);
      assert.ok(result.valid);
      assert.ok(result.route);
    });

    it('should reject non-cross-chain request', () => {
      const request = {
        rfqId: 'test-2',
        chain: 'ethereum' as const,
        chainId: 1,
        baseToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
        quoteToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
        tradeDirection: 'sell' as const,
        trader: '0x1234567890abcdef1234567890abcdef12345678' as Address,
        responseDeadline: Math.floor(Date.now() / 1000) + 30,
        isCrossChain: false,
      };
      const result = validateCrossChainRFQ(request);
      assert.ok(!result.valid);
    });
  });

  describe('buildCrossChainQuoteData', () => {
    it('should build cross-chain quote data', () => {
      const baseQuote: HashflowQuoteData = {
        pool: '0x1111111111111111111111111111111111111111' as Address,
        externalAccount: '0x2222222222222222222222222222222222222222' as Address,
        effectiveTrader: '0x2222222222222222222222222222222222222222' as Address,
        baseToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
        quoteToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
        baseTokenAmount: 1000000000000000000n,
        quoteTokenAmount: 2000000000n,
        nonce: 1n,
        txid: '0x0000000000000000000000000000000000000000000000000000000000000001' as HexString,
        quoteExpiry: Math.floor(Date.now() / 1000) + 300,
      };

      const crossChainData = buildCrossChainQuoteData(
        baseQuote,
        'ethereum',
        'arbitrum',
        '0x3333333333333333333333333333333333333333' as Address,
        '0x4444444444444444444444444444444444444444' as Address,
      );

      assert.equal(crossChainData.srcChain, 'ethereum');
      assert.equal(crossChainData.dstChain, 'arbitrum');
      assert.equal(crossChainData.dstChainId, 42161);
      assert.equal(crossChainData.xChainProtocol, 'wormhole');
    });
  });
});
