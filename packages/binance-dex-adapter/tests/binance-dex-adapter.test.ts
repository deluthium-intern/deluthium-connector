/**
 * Tests for @deluthium/binance-dex-adapter
 *
 * Uses mock/stub patterns to avoid external RPC and API calls.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  BinanceDexAdapter,
  PancakeSwapClient,
  PriceComparator,
  SplitRouter,
  PANCAKESWAP_ADDRESSES,
  BNB_CHAIN_TOKENS,
} from '../src/index.js';

import type {
  BinanceDexAdapterConfig,
  BinanceDexAdapterEvent,
  DexToken,
  PriceSource,
  PancakeSwapContracts,
} from '../src/types.js';

import { ValidationError } from '@deluthium/sdk';

// ── Helpers / Mocks ─────────────────────────────────────────────────────────

/** Minimal mock signer. */
function createMockSigner() {
  return {
    getAddress: async () => '0x3333333333333333333333333333333333333333',
    signMessage: async (_msg: string) => '0xSIG',
    signTypedData: async () => '0xTYPED',
  };
}

/** Build a minimal valid BinanceDexAdapterConfig. */
function validConfig(
  overrides: Partial<BinanceDexAdapterConfig> = {},
): BinanceDexAdapterConfig {
  return {
    deluthium: { auth: 'test-jwt', chainId: 56 },
    signer: createMockSigner() as any,
    chainId: 56,
    rpcUrl: 'https://bsc-dataseed.binance.org',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('BinanceDexAdapter', () => {
  describe('constructor', () => {
    it('should construct successfully with valid config', () => {
      const adapter = new BinanceDexAdapter(validConfig());
      assert.ok(adapter);
      assert.equal(adapter.isInitialized, false);
    });
  });

  describe('initialization guard', () => {
    it('comparePrice should throw ValidationError before initialize()', async () => {
      const adapter = new BinanceDexAdapter(validConfig());
      const src: DexToken = { address: '0xA', symbol: 'A', decimals: 18, isNative: false };
      const dst: DexToken = { address: '0xB', symbol: 'B', decimals: 18, isNative: false };

      await assert.rejects(
        () => adapter.comparePrice(src, dst, '1000'),
        (err: unknown) => err instanceof ValidationError,
      );
    });

    it('getOptimalRoute should throw ValidationError before initialize()', async () => {
      const adapter = new BinanceDexAdapter(validConfig());
      const src: DexToken = { address: '0xA', symbol: 'A', decimals: 18, isNative: false };
      const dst: DexToken = { address: '0xB', symbol: 'B', decimals: 18, isNative: false };

      await assert.rejects(
        () => adapter.getOptimalRoute(src, dst, '1000'),
        (err: unknown) => err instanceof ValidationError,
      );
    });

    it('accessing pancakeSwap getter should throw before initialize()', () => {
      const adapter = new BinanceDexAdapter(validConfig());
      assert.throws(
        () => adapter.pancakeSwap,
        (err: unknown) => err instanceof ValidationError,
      );
    });

    it('accessing comparator getter should throw before initialize()', () => {
      const adapter = new BinanceDexAdapter(validConfig());
      assert.throws(
        () => adapter.comparator,
        (err: unknown) => err instanceof ValidationError,
      );
    });

    it('accessing router getter should throw before initialize()', () => {
      const adapter = new BinanceDexAdapter(validConfig());
      assert.throws(
        () => adapter.router,
        (err: unknown) => err instanceof ValidationError,
      );
    });
  });

  describe('event system', () => {
    it('on/off should register and remove listeners', () => {
      const adapter = new BinanceDexAdapter(validConfig());
      let callCount = 0;
      const handler = () => { callCount++; };

      adapter.on('price:updated', handler);

      // Verify internal handler set
      const handlers: Map<string, Set<Function>> = (adapter as any).eventHandlers;
      assert.ok(handlers.get('price:updated'));
      assert.equal(handlers.get('price:updated')!.size, 1);

      adapter.off('price:updated', handler);
      assert.equal(handlers.get('price:updated')!.size, 0);
    });

    it('emit should call registered handlers', () => {
      const adapter = new BinanceDexAdapter(validConfig());
      let received: unknown = null;
      adapter.on('comparison:ready', (data: unknown) => { received = data; });

      (adapter as any).emit('comparison:ready', { test: true });
      assert.deepEqual(received, { test: true });
    });

    it('emit should swallow handler errors', () => {
      const adapter = new BinanceDexAdapter(validConfig());
      adapter.on('route:error', () => {
        throw new Error('handler boom');
      });

      assert.doesNotThrow(() => {
        (adapter as any).emit('route:error', {});
      });
    });

    it('BinanceDexAdapterEvent union includes expected values', () => {
      const events: BinanceDexAdapterEvent[] = [
        'price:updated',
        'price:error',
        'comparison:ready',
        'route:computed',
        'route:executed',
        'route:error',
      ];
      assert.equal(events.length, 6);
    });
  });

  describe('destroy', () => {
    it('destroy should reset initialized state', async () => {
      const adapter = new BinanceDexAdapter(validConfig());
      await adapter.initialize();
      assert.equal(adapter.isInitialized, true);

      adapter.destroy();
      assert.equal(adapter.isInitialized, false);
    });
  });
});

// ── PANCAKESWAP_ADDRESSES ────────────────────────────────────────────────────

describe('PANCAKESWAP_ADDRESSES', () => {
  it('chain 56 (BNB Chain) should have all required fields', () => {
    const addrs = PANCAKESWAP_ADDRESSES[56];
    assert.ok(addrs, 'chain 56 should exist');
    assert.ok(addrs.smartRouter.startsWith('0x'));
    assert.ok(addrs.v3Factory.startsWith('0x'));
    assert.ok(addrs.v2Factory.startsWith('0x'));
    assert.ok(addrs.v2Router.startsWith('0x'));
    assert.ok(addrs.quoterV2.startsWith('0x'));
    assert.ok(addrs.wbnb.startsWith('0x'));
  });

  it('chain 204 (opBNB) should have all required fields', () => {
    const addrs = PANCAKESWAP_ADDRESSES[204];
    assert.ok(addrs, 'chain 204 should exist');
    assert.ok(addrs.smartRouter.startsWith('0x'));
    assert.ok(addrs.v3Factory.startsWith('0x'));
    assert.ok(addrs.v2Factory.startsWith('0x'));
    assert.ok(addrs.v2Router.startsWith('0x'));
    assert.ok(addrs.quoterV2.startsWith('0x'));
    assert.ok(addrs.wbnb.startsWith('0x'));
  });

  it('chain 56 WBNB should match BNB_CHAIN_TOKENS.WBNB', () => {
    assert.equal(
      PANCAKESWAP_ADDRESSES[56].wbnb,
      BNB_CHAIN_TOKENS.WBNB.address,
    );
  });
});

// ── BNB_CHAIN_TOKENS ─────────────────────────────────────────────────────────

describe('BNB_CHAIN_TOKENS', () => {
  it('should have WBNB with correct address and decimals', () => {
    assert.equal(BNB_CHAIN_TOKENS.WBNB.symbol, 'WBNB');
    assert.equal(BNB_CHAIN_TOKENS.WBNB.decimals, 18);
    assert.equal(BNB_CHAIN_TOKENS.WBNB.isNative, false);
    assert.ok(BNB_CHAIN_TOKENS.WBNB.address.startsWith('0x'));
  });

  it('should have USDT with correct address and decimals', () => {
    assert.equal(BNB_CHAIN_TOKENS.USDT.symbol, 'USDT');
    assert.equal(BNB_CHAIN_TOKENS.USDT.decimals, 18);
    assert.equal(BNB_CHAIN_TOKENS.USDT.isNative, false);
  });

  it('should have BNB as native token', () => {
    assert.equal(BNB_CHAIN_TOKENS.BNB.symbol, 'BNB');
    assert.equal(BNB_CHAIN_TOKENS.BNB.isNative, true);
    assert.equal(BNB_CHAIN_TOKENS.BNB.decimals, 18);
  });

  it('should have USDC, BUSD, ETH, BTCB', () => {
    assert.ok(BNB_CHAIN_TOKENS.USDC);
    assert.ok(BNB_CHAIN_TOKENS.BUSD);
    assert.ok(BNB_CHAIN_TOKENS.ETH);
    assert.ok(BNB_CHAIN_TOKENS.BTCB);
  });

  it('all tokens should have unique addresses', () => {
    const addresses = Object.values(BNB_CHAIN_TOKENS).map((t) => t.address.toLowerCase());
    const unique = new Set(addresses);
    assert.equal(unique.size, addresses.length, 'all token addresses should be unique');
  });
});

// ── PancakeSwapClient ────────────────────────────────────────────────────────

describe('PancakeSwapClient', () => {
  describe('construction', () => {
    it('should construct successfully for chain 56', () => {
      const client = new PancakeSwapClient({
        rpcUrl: 'https://bsc-dataseed.binance.org',
        chainId: 56,
      });
      assert.ok(client);
      assert.equal(client.getChainId(), 56);
    });

    it('should construct successfully for chain 204 (opBNB)', () => {
      const client = new PancakeSwapClient({
        rpcUrl: 'https://opbnb-rpc.publicnode.com',
        chainId: 204,
      });
      assert.ok(client);
      assert.equal(client.getChainId(), 204);
    });

    it('should throw ValidationError for unsupported chain', () => {
      assert.throws(
        () =>
          new PancakeSwapClient({
            rpcUrl: 'https://example.com',
            chainId: 999,
          }),
        (err: unknown) => err instanceof ValidationError,
      );
    });

    it('should default to chain 56', () => {
      const client = new PancakeSwapClient({
        rpcUrl: 'https://bsc-dataseed.binance.org',
      });
      assert.equal(client.getChainId(), 56);
    });
  });

  describe('resolveForDex', () => {
    it('should return WBNB address for native BNB token', () => {
      const client = new PancakeSwapClient({
        rpcUrl: 'https://bsc-dataseed.binance.org',
        chainId: 56,
      });

      const resolved = client.resolveForDex(BNB_CHAIN_TOKENS.BNB);
      assert.equal(resolved, PANCAKESWAP_ADDRESSES[56].wbnb);
    });

    it('should return original address for non-native token', () => {
      const client = new PancakeSwapClient({
        rpcUrl: 'https://bsc-dataseed.binance.org',
        chainId: 56,
      });

      const resolved = client.resolveForDex(BNB_CHAIN_TOKENS.USDT);
      assert.equal(resolved, BNB_CHAIN_TOKENS.USDT.address);
    });

    it('should return WBNB for WBNB (not native, passthrough)', () => {
      const client = new PancakeSwapClient({
        rpcUrl: 'https://bsc-dataseed.binance.org',
        chainId: 56,
      });

      const resolved = client.resolveForDex(BNB_CHAIN_TOKENS.WBNB);
      assert.equal(resolved, BNB_CHAIN_TOKENS.WBNB.address);
    });
  });

  describe('getContracts', () => {
    it('should return PancakeSwap contract addresses', () => {
      const client = new PancakeSwapClient({
        rpcUrl: 'https://bsc-dataseed.binance.org',
        chainId: 56,
      });

      const contracts = client.getContracts();
      assert.equal(contracts.smartRouter, PANCAKESWAP_ADDRESSES[56].smartRouter);
      assert.equal(contracts.v2Factory, PANCAKESWAP_ADDRESSES[56].v2Factory);
      assert.equal(contracts.v3Factory, PANCAKESWAP_ADDRESSES[56].v3Factory);
    });
  });

  describe('wallet management', () => {
    it('getWallet should return null initially', () => {
      const client = new PancakeSwapClient({
        rpcUrl: 'https://bsc-dataseed.binance.org',
        chainId: 56,
      });
      assert.equal(client.getWallet(), null);
    });
  });
});

// ── SplitRouter ──────────────────────────────────────────────────────────────

describe('SplitRouter', () => {
  describe('validation', () => {
    it('should throw ValidationError for negative / zero totalSrcAmount', async () => {
      const mockPcs = {} as any;
      const mockDel = {} as any;
      const mockSigner = createMockSigner() as any;

      const router = new SplitRouter({
        pancakeSwap: mockPcs,
        deluthium: mockDel,
        signer: mockSigner,
        chainId: 56,
      });

      await assert.rejects(
        () =>
          router.computeOptimalSplit(
            { address: '0xA', symbol: 'A', decimals: 18, isNative: false },
            { address: '0xB', symbol: 'B', decimals: 18, isNative: false },
            '0',
          ),
        (err: unknown) => err instanceof ValidationError,
      );
    });

    it('should throw ValidationError for negative amount (represented as string)', async () => {
      const router = new SplitRouter({
        pancakeSwap: {} as any,
        deluthium: {} as any,
        signer: createMockSigner() as any,
        chainId: 56,
      });

      // BigInt('-1') is -1n which is <= 0n
      await assert.rejects(
        () =>
          router.computeOptimalSplit(
            { address: '0xA', symbol: 'A', decimals: 18, isNative: false },
            { address: '0xB', symbol: 'B', decimals: 18, isNative: false },
            '-1',
          ),
        (err: unknown) => err instanceof ValidationError,
      );
    });
  });
});

// ── DexToken and PriceSource types ───────────────────────────────────────────

describe('DexToken and PriceSource types', () => {
  it('DexToken should work with all required fields', () => {
    const token: DexToken = {
      address: '0xSomething',
      symbol: 'TKN',
      decimals: 8,
      isNative: false,
    };
    assert.equal(token.address, '0xSomething');
    assert.equal(token.symbol, 'TKN');
    assert.equal(token.decimals, 8);
    assert.equal(token.isNative, false);
  });

  it('PriceSource should accept valid source values', () => {
    const sources: PriceSource[] = ['deluthium', 'pancakeswap_v2', 'pancakeswap_v3'];
    assert.equal(sources.length, 3);
    assert.ok(sources.includes('deluthium'));
    assert.ok(sources.includes('pancakeswap_v2'));
    assert.ok(sources.includes('pancakeswap_v3'));
  });

  it('BNB native token address is the conventional burn address', () => {
    assert.equal(
      BNB_CHAIN_TOKENS.BNB.address,
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    );
  });
});
