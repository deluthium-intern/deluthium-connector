/**
 * Tests for @deluthium/paraswap-adapter
 *
 * Uses mock/stub patterns to avoid external API calls.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  ParaswapAdapter,
  RateProvider,
  Executor,
  AUGUSTUS_ADDRESSES,
} from '../src/index.js';

import type {
  ParaswapAdapterConfig,
  ParaswapAdapterEvent,
  RateRequest,
  BuildTxRequest,
  CachedRate,
  RateResponse,
  ParaswapToken,
} from '../src/types.js';

import { ValidationError } from '@deluthium/sdk';

// ── Helpers / Mocks ─────────────────────────────────────────────────────────

/** Minimal mock signer that satisfies ISigner. */
function createMockSigner() {
  return {
    getAddress: async () => '0x1111111111111111111111111111111111111111',
    signMessage: async (_msg: string) => '0xSIGNATURE',
    signTypedData: async () => '0xTYPED_SIG',
  };
}

/** Build a minimal valid ParaswapAdapterConfig. */
function validConfig(overrides: Partial<ParaswapAdapterConfig> = {}): ParaswapAdapterConfig {
  return {
    deluthium: { auth: 'test-jwt-token', chainId: 56 },
    signer: createMockSigner() as any,
    poolAdapterAddress: '0xPoolAdapter',
    rateRefreshIntervalMs: 60_000, // long interval so background loop won't fire
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ParaswapAdapter', () => {
  // ---- Construction & config validation ---------------------------------

  describe('constructor', () => {
    it('should construct successfully with valid config', () => {
      const adapter = new ParaswapAdapter(validConfig());
      assert.ok(adapter, 'adapter should be defined');
      assert.equal(adapter.getChainId(), 56);
    });

    it('should throw ValidationError when auth is missing', () => {
      assert.throws(
        () =>
          new ParaswapAdapter(
            validConfig({ deluthium: { auth: '', chainId: 56 } }),
          ),
        (err: unknown) => err instanceof ValidationError,
      );
    });

    it('should throw ValidationError when signer is missing', () => {
      assert.throws(
        () =>
          new ParaswapAdapter(
            validConfig({ signer: undefined as any }),
          ),
        (err: unknown) => err instanceof ValidationError,
      );
    });

    it('should throw ValidationError when neither chainId is provided', () => {
      assert.throws(
        () =>
          new ParaswapAdapter({
            deluthium: { auth: 'jwt', chainId: 0 as any },
            signer: createMockSigner() as any,
          } as any),
        (err: unknown) => err instanceof ValidationError,
      );
    });

    it('should resolve chainId from deluthium config', () => {
      const adapter = new ParaswapAdapter(validConfig());
      assert.equal(adapter.getChainId(), 56);
    });

    it('should prefer top-level chainId over deluthium.chainId', () => {
      const adapter = new ParaswapAdapter(
        validConfig({ chainId: 137 }),
      );
      assert.equal(adapter.getChainId(), 137);
    });
  });

  // ---- Event system -----------------------------------------------------

  describe('event system', () => {
    let adapter: ParaswapAdapter;

    beforeEach(() => {
      adapter = new ParaswapAdapter(validConfig());
    });

    it('on/off should register and remove listeners', () => {
      let callCount = 0;
      const handler = () => { callCount++; };

      adapter.on('rate:updated', handler);

      // Emit via private method — use (adapter as any) to reach it
      (adapter as any).emitEvent('rate:updated', { test: true });
      assert.equal(callCount, 1);

      adapter.off('rate:updated', handler);
      (adapter as any).emitEvent('rate:updated', { test: true });
      assert.equal(callCount, 1, 'handler should not fire after off()');
    });

    it('once should fire handler only one time', () => {
      let callCount = 0;
      adapter.once('swap:executed', () => { callCount++; });

      (adapter as any).emitEvent('swap:executed', {});
      (adapter as any).emitEvent('swap:executed', {});
      assert.equal(callCount, 1);
    });

    it('removeAllListeners should clear everything', () => {
      let callCount = 0;
      adapter.on('rate:updated', () => { callCount++; });
      adapter.on('swap:executed', () => { callCount++; });
      adapter.removeAllListeners();

      (adapter as any).emitEvent('rate:updated', {});
      (adapter as any).emitEvent('swap:executed', {});
      assert.equal(callCount, 0);
    });

    it('removeAllListeners(event) should clear only that event', () => {
      let rateCount = 0;
      let swapCount = 0;
      adapter.on('rate:updated', () => { rateCount++; });
      adapter.on('swap:executed', () => { swapCount++; });

      adapter.removeAllListeners('rate:updated');

      (adapter as any).emitEvent('rate:updated', {});
      (adapter as any).emitEvent('swap:executed', {});
      assert.equal(rateCount, 0);
      assert.equal(swapCount, 1);
    });

    it('listener errors should not propagate', () => {
      adapter.on('rate:updated', () => {
        throw new Error('boom');
      });

      // Should not throw
      assert.doesNotThrow(() => {
        (adapter as any).emitEvent('rate:updated', {});
      });
    });
  });

  // ---- Lifecycle --------------------------------------------------------

  describe('lifecycle', () => {
    it('isRunning should be false before start', () => {
      const adapter = new ParaswapAdapter(validConfig());
      assert.equal(adapter.isRunning, false);
    });
  });
});

// ── RateProvider ─────────────────────────────────────────────────────────────

describe('RateProvider', () => {
  // Use valid checksummed Ethereum addresses for tests that go through normalizeAddress
  const SRC_ADDR = '0x55d398326f99059fF775485246999027B3197955'; // USDT on BSC
  const DEST_ADDR = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'; // WBNB on BSC
  const SRC_ADDR_LOWER = SRC_ADDR.toLowerCase();
  const DEST_ADDR_LOWER = DEST_ADDR.toLowerCase();

  describe('rate caching (via internal cache)', () => {
    it('getRate should return null when cache is empty', () => {
      const config = validConfig();
      const mockClient = {} as any;
      const emitter = () => {};
      const provider = new RateProvider(config, mockClient, emitter);

      const request: RateRequest = {
        srcToken: { address: SRC_ADDR, decimals: 18 },
        destToken: { address: DEST_ADDR, decimals: 18 },
        srcAmount: '1000000000000000000',
        chainId: 56,
        side: 'SELL',
      };

      assert.equal(provider.getRate(request), null);
    });

    it('getAllCachedRates should return empty array initially', () => {
      const provider = new RateProvider(validConfig(), {} as any, () => {});
      assert.deepEqual(provider.getAllCachedRates(), []);
    });

    it('activeCacheSize should be 0 initially', () => {
      const provider = new RateProvider(validConfig(), {} as any, () => {});
      assert.equal(provider.activeCacheSize, 0);
    });

    it('getRate should return scaled rate when cache has a fresh entry', () => {
      const config = validConfig();
      const provider = new RateProvider(config, {} as any, () => {});

      // Inject a cached entry via the internal map
      const cacheMap: Map<string, CachedRate> = (provider as any).rateCache;

      const cachedResponse: RateResponse = {
        srcToken: SRC_ADDR_LOWER,
        destToken: DEST_ADDR_LOWER,
        srcAmount: '1000000000000000000', // 1 unit
        destAmount: '2000000000000000000', // 2 units
        exchange: 'Deluthium',
        poolId: 'deluthium-rfq-test',
        data: '0x',
        gasCost: '120000',
      };

      const cacheKey = `${SRC_ADDR_LOWER}:${DEST_ADDR_LOWER}`;
      cacheMap.set(cacheKey, {
        request: {
          srcToken: { address: SRC_ADDR_LOWER, decimals: 18 },
          destToken: { address: DEST_ADDR_LOWER, decimals: 18 },
          srcAmount: '1000000000000000000',
          chainId: 56,
          side: 'SELL',
        },
        response: cachedResponse,
        cachedAt: Date.now(),
        ttlMs: 30_000,
      });

      const result = provider.getRate({
        srcToken: { address: SRC_ADDR, decimals: 18 },
        destToken: { address: DEST_ADDR, decimals: 18 },
        srcAmount: '5000000000000000000', // 5 units
        chainId: 56,
        side: 'SELL',
      });

      assert.ok(result, 'should return a rate');
      assert.equal(result!.srcAmount, '5000000000000000000');
      // Scaled: 2 * 5 / 1 = 10
      assert.equal(result!.destAmount, '10000000000000000000');
    });

    it('getRate should return null for expired cache entries', () => {
      const provider = new RateProvider(validConfig(), {} as any, () => {});
      const cacheMap: Map<string, CachedRate> = (provider as any).rateCache;

      const cacheKey = `${SRC_ADDR_LOWER}:${DEST_ADDR_LOWER}`;
      cacheMap.set(cacheKey, {
        request: {
          srcToken: { address: SRC_ADDR_LOWER, decimals: 18 },
          destToken: { address: DEST_ADDR_LOWER, decimals: 18 },
          srcAmount: '1000000000000000000',
          chainId: 56,
          side: 'SELL',
        },
        response: {
          srcToken: SRC_ADDR_LOWER,
          destToken: DEST_ADDR_LOWER,
          srcAmount: '1000000000000000000',
          destAmount: '2000000000000000000',
          exchange: 'Deluthium',
          poolId: 'test',
          data: '0x',
          gasCost: '120000',
        },
        cachedAt: Date.now() - 999_999, // long ago
        ttlMs: 10_000,
      });

      const result = provider.getRate({
        srcToken: { address: SRC_ADDR, decimals: 18 },
        destToken: { address: DEST_ADDR, decimals: 18 },
        srcAmount: '1000000000000000000',
        chainId: 56,
        side: 'SELL',
      });

      assert.equal(result, null, 'expired entry should return null');
    });
  });
});

// ── Executor ─────────────────────────────────────────────────────────────────

describe('Executor', () => {
  describe('buildTransaction validation', () => {
    let executor: Executor;

    beforeEach(() => {
      const config = validConfig();
      const mockClient = {} as any;
      const emitter = () => {};
      executor = new Executor(config, mockClient, emitter);
    });

    it('should throw ValidationError when srcToken is missing', async () => {
      await assert.rejects(
        () =>
          executor.buildTransaction({
            srcToken: '',
            destToken: '0xDST',
            srcAmount: '1000',
            destAmount: '2000',
            minDestAmount: '1900',
            sender: '0xSENDER',
            receiver: '0xRECEIVER',
            chainId: 56,
            deadline: Math.floor(Date.now() / 1000) + 300,
          }),
        (err: unknown) =>
          err instanceof ValidationError && err.field === 'srcToken',
      );
    });

    it('should throw ValidationError when sender is missing', async () => {
      await assert.rejects(
        () =>
          executor.buildTransaction({
            srcToken: '0xSRC',
            destToken: '0xDST',
            srcAmount: '1000',
            destAmount: '2000',
            minDestAmount: '1900',
            sender: '',
            receiver: '0xRECEIVER',
            chainId: 56,
            deadline: Math.floor(Date.now() / 1000) + 300,
          }),
        (err: unknown) =>
          err instanceof ValidationError && err.field === 'sender',
      );
    });

    it('should throw ValidationError when srcAmount is zero', async () => {
      await assert.rejects(
        () =>
          executor.buildTransaction({
            srcToken: '0xSRC',
            destToken: '0xDST',
            srcAmount: '0',
            destAmount: '2000',
            minDestAmount: '1900',
            sender: '0xSENDER',
            receiver: '0xRECEIVER',
            chainId: 56,
            deadline: Math.floor(Date.now() / 1000) + 300,
          }),
        (err: unknown) =>
          err instanceof ValidationError && err.field === 'srcAmount',
      );
    });

    it('should throw ValidationError when minDestAmount exceeds destAmount', async () => {
      await assert.rejects(
        () =>
          executor.buildTransaction({
            srcToken: '0xSRC',
            destToken: '0xDST',
            srcAmount: '1000',
            destAmount: '2000',
            minDestAmount: '3000',
            sender: '0xSENDER',
            receiver: '0xRECEIVER',
            chainId: 56,
            deadline: Math.floor(Date.now() / 1000) + 300,
          }),
        (err: unknown) =>
          err instanceof ValidationError && err.field === 'minDestAmount',
      );
    });

    it('should throw ValidationError when destToken is missing', async () => {
      await assert.rejects(
        () =>
          executor.buildTransaction({
            srcToken: '0xSRC',
            destToken: '',
            srcAmount: '1000',
            destAmount: '2000',
            minDestAmount: '1900',
            sender: '0xSENDER',
            receiver: '0xRECEIVER',
            chainId: 56,
            deadline: Math.floor(Date.now() / 1000) + 300,
          }),
        (err: unknown) =>
          err instanceof ValidationError && err.field === 'destToken',
      );
    });
  });

  describe('getAugustusAddress', () => {
    it('should return the correct Augustus address for the configured chain', () => {
      const config = validConfig();
      const executor = new Executor(config, {} as any, () => {});
      assert.equal(
        executor.getAugustusAddress(),
        AUGUSTUS_ADDRESSES[56],
      );
    });
  });
});

// ── AUGUSTUS_ADDRESSES ────────────────────────────────────────────────────────

describe('AUGUSTUS_ADDRESSES', () => {
  it('should have an entry for Ethereum (chain 1)', () => {
    assert.ok(AUGUSTUS_ADDRESSES[1]);
    assert.ok(AUGUSTUS_ADDRESSES[1].startsWith('0x'));
  });

  it('should have an entry for BNB Chain (chain 56)', () => {
    assert.ok(AUGUSTUS_ADDRESSES[56]);
  });

  it('should have an entry for Polygon (chain 137)', () => {
    assert.ok(AUGUSTUS_ADDRESSES[137]);
  });

  it('should have an entry for Arbitrum (chain 42161)', () => {
    assert.ok(AUGUSTUS_ADDRESSES[42161]);
  });

  it('should have an entry for Optimism (chain 10)', () => {
    assert.ok(AUGUSTUS_ADDRESSES[10]);
  });

  it('should have an entry for Avalanche (chain 43114)', () => {
    assert.ok(AUGUSTUS_ADDRESSES[43114]);
  });

  it('should have an entry for Base (chain 8453)', () => {
    assert.ok(AUGUSTUS_ADDRESSES[8453]);
  });

  it('all addresses should share the same Augustus V6 address', () => {
    const expected = '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57';
    for (const [chainId, address] of Object.entries(AUGUSTUS_ADDRESSES)) {
      assert.equal(address, expected, `chain ${chainId} should match`);
    }
  });
});

// ── Types ────────────────────────────────────────────────────────────────────

describe('types', () => {
  it('ParaswapAdapterEvent union includes expected values', () => {
    const events: ParaswapAdapterEvent[] = [
      'rate:updated',
      'rate:error',
      'swap:executed',
      'swap:error',
      'pool:registered',
      'pool:deregistered',
    ];
    assert.equal(events.length, 6);
  });

  it('ParaswapToken interface works as expected', () => {
    const token: ParaswapToken = {
      address: '0x1234',
      decimals: 18,
      symbol: 'TEST',
    };
    assert.equal(token.address, '0x1234');
    assert.equal(token.decimals, 18);
    assert.equal(token.symbol, 'TEST');
  });
});
