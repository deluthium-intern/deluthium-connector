/**
 * Tests for @deluthium/dydx-adapter
 *
 * Uses mock/stub patterns to avoid external API and Cosmos chain calls.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  DydxAdapter,
  CosmosClient,
  MarketDataFeed,
  OrderBridge,
  ArbitrageDetector,
  DYDX_ENDPOINTS,
} from '../src/index.js';

import type {
  DydxAdapterConfig,
  DydxAdapterEvent,
  OrderBridgeStrategy,
  OrderBookLevel,
} from '../src/types.js';

import type { TokenTickerMapping } from '../src/order-bridge.js';
import type { ArbPairConfig } from '../src/arbitrage.js';

import { ValidationError } from '@deluthium/sdk';

// ── Helpers / Mocks ─────────────────────────────────────────────────────────

/** Minimal mock signer. */
function createMockSigner() {
  return {
    getAddress: async () => '0x2222222222222222222222222222222222222222',
    signMessage: async (_msg: string) => '0xSIG',
    signTypedData: async () => '0xTYPED',
  };
}

/** Build a minimal DydxAdapterConfig. */
function validConfig(overrides: Partial<DydxAdapterConfig> = {}): DydxAdapterConfig {
  return {
    deluthium: { auth: 'test-jwt', chainId: 56 },
    signer: createMockSigner() as any,
    network: 'mainnet',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('DydxAdapter', () => {
  describe('constructor', () => {
    it('should construct successfully with valid config', () => {
      const adapter = new DydxAdapter(validConfig());
      assert.ok(adapter);
      assert.equal(adapter.isInitialized, false);
    });

    it('should expose sub-components', () => {
      const adapter = new DydxAdapter(validConfig());
      assert.ok(adapter.cosmos instanceof CosmosClient);
      assert.ok(adapter.marketData instanceof MarketDataFeed);
      assert.ok(adapter.orderBridge instanceof OrderBridge);
      assert.ok(adapter.arbitrage instanceof ArbitrageDetector);
    });
  });

  describe('initialization guard', () => {
    it('getMarkets should throw ValidationError before initialize()', async () => {
      const adapter = new DydxAdapter(validConfig());
      await assert.rejects(
        () => adapter.getMarkets(),
        (err: unknown) => err instanceof ValidationError,
      );
    });

    it('placeOrder should throw ValidationError before initialize()', async () => {
      const adapter = new DydxAdapter(validConfig());
      await assert.rejects(
        () =>
          adapter.placeOrder({
            ticker: 'BTC-USD',
            side: 'BUY',
            type: 'LIMIT',
            size: '0.01',
            price: '50000',
            timeInForce: 'GTT',
          }),
        (err: unknown) => err instanceof ValidationError,
      );
    });

    it('connectMarketData should throw ValidationError before initialize()', async () => {
      const adapter = new DydxAdapter(validConfig());
      await assert.rejects(
        () => adapter.connectMarketData(),
        (err: unknown) => err instanceof ValidationError,
      );
    });

    it('startBridge should throw ValidationError before initialize()', async () => {
      const adapter = new DydxAdapter(validConfig());
      await assert.rejects(
        () => adapter.startBridge(),
        (err: unknown) => err instanceof ValidationError,
      );
    });

    it('startArbitrage should throw ValidationError before initialize()', async () => {
      const adapter = new DydxAdapter(validConfig());
      await assert.rejects(
        () => adapter.startArbitrage(),
        (err: unknown) => err instanceof ValidationError,
      );
    });
  });

  describe('event system', () => {
    it('on/off should register and remove listeners', () => {
      const adapter = new DydxAdapter(validConfig());
      let callCount = 0;
      const handler = () => { callCount++; };

      adapter.on('orderbook:update', handler);

      // Emit via internal listeners map
      const listeners: Map<string, Set<Function>> = (adapter as any).listeners;
      const handlers = listeners.get('orderbook:update');
      assert.ok(handlers);
      assert.equal(handlers!.size, 1);

      adapter.off('orderbook:update', handler);
      assert.equal(listeners.get('orderbook:update')!.size, 0);
    });

    it('event forwarding is set up for sub-components', () => {
      const adapter = new DydxAdapter(validConfig());
      // The adapter constructor calls forwardEvents on marketData, orderBridge, and arbitrage
      // Verify that event forwarding was set up by checking listener counts on sub-components
      const marketListeners: Map<string, Set<Function>> = (adapter.marketData as any).listeners;
      // forwardEvents registers listeners for multiple events
      assert.ok(marketListeners.size > 0, 'marketData should have forwarded listeners');
    });
  });
});

// ── CosmosClient ─────────────────────────────────────────────────────────────

describe('CosmosClient', () => {
  describe('address validation', () => {
    it('setAddress should accept valid dydx1... address', () => {
      const client = new CosmosClient(validConfig());
      assert.doesNotThrow(() => {
        client.setAddress('dydx1abc123def456');
      });
      assert.equal(client.getAddress(), 'dydx1abc123def456');
    });

    it('setAddress should throw ValidationError for invalid address', () => {
      const client = new CosmosClient(validConfig());
      assert.throws(
        () => client.setAddress('cosmos1invalid'),
        (err: unknown) => err instanceof ValidationError,
      );
    });

    it('setAddress should throw ValidationError for ETH address', () => {
      const client = new CosmosClient(validConfig());
      assert.throws(
        () => client.setAddress('0x1234567890abcdef'),
        (err: unknown) => err instanceof ValidationError,
      );
    });

    it('getAddress should return null initially', () => {
      const client = new CosmosClient(validConfig());
      assert.equal(client.getAddress(), null);
    });
  });

  describe('network configuration', () => {
    it('should resolve mainnet endpoints correctly', () => {
      const client = new CosmosClient(validConfig({ network: 'mainnet' }));
      assert.equal(client.getChainId(), 'dydx-mainnet-1');
      assert.equal(client.getNetwork(), 'mainnet');
    });

    it('should resolve testnet endpoints correctly', () => {
      const client = new CosmosClient(validConfig({ network: 'testnet' }));
      assert.equal(client.getChainId(), 'dydx-testnet-4');
      assert.equal(client.getNetwork(), 'testnet');
    });

    it('getWsEndpoint should return the indexer WS URL', () => {
      const client = new CosmosClient(validConfig({ network: 'mainnet' }));
      assert.equal(client.getWsEndpoint(), DYDX_ENDPOINTS.mainnet.indexerWs);
    });
  });
});

// ── DYDX_ENDPOINTS ───────────────────────────────────────────────────────────

describe('DYDX_ENDPOINTS', () => {
  it('mainnet should have correct chainId', () => {
    assert.equal(DYDX_ENDPOINTS.mainnet.chainId, 'dydx-mainnet-1');
  });

  it('testnet should have correct chainId', () => {
    assert.equal(DYDX_ENDPOINTS.testnet.chainId, 'dydx-testnet-4');
  });

  it('mainnet should have REST, WS, gRPC, indexer endpoints', () => {
    assert.ok(DYDX_ENDPOINTS.mainnet.rest.startsWith('https://'));
    assert.ok(DYDX_ENDPOINTS.mainnet.ws.startsWith('wss://'));
    assert.ok(DYDX_ENDPOINTS.mainnet.grpc.startsWith('https://'));
    assert.ok(DYDX_ENDPOINTS.mainnet.indexerRest.startsWith('https://'));
    assert.ok(DYDX_ENDPOINTS.mainnet.indexerWs.startsWith('wss://'));
  });

  it('testnet should have REST, WS, gRPC, indexer endpoints', () => {
    assert.ok(DYDX_ENDPOINTS.testnet.rest.startsWith('https://'));
    assert.ok(DYDX_ENDPOINTS.testnet.ws.startsWith('wss://'));
    assert.ok(DYDX_ENDPOINTS.testnet.grpc.startsWith('https://'));
    assert.ok(DYDX_ENDPOINTS.testnet.indexerRest.startsWith('https://'));
    assert.ok(DYDX_ENDPOINTS.testnet.indexerWs.startsWith('wss://'));
  });
});

// ── OrderBridge ──────────────────────────────────────────────────────────────

describe('OrderBridge', () => {
  describe('mapping management', () => {
    it('addMapping should store a mapping', () => {
      const adapter = new DydxAdapter(validConfig());
      const mapping: TokenTickerMapping = {
        tokenIn: '0xUSDT',
        tokenOut: '0xWBTC',
        ticker: 'BTC-USD',
        chainId: 56,
        dydxSide: 'BUY',
        baseDecimals: 18,
        quoteAmountWei: '1000000000000000000',
      };

      adapter.addBridgeMapping(mapping);

      // Verify by accessing the internal mappings array
      const mappings: TokenTickerMapping[] = (adapter.orderBridge as any).mappings;
      assert.equal(mappings.length, 1);
      assert.equal(mappings[0].ticker, 'BTC-USD');
    });

    it('removeMapping should remove a mapping by ticker', () => {
      const adapter = new DydxAdapter(validConfig());
      adapter.addBridgeMapping({
        tokenIn: '0xUSDT',
        tokenOut: '0xWBTC',
        ticker: 'BTC-USD',
        chainId: 56,
        dydxSide: 'BUY',
        baseDecimals: 18,
        quoteAmountWei: '1000000000000000000',
      });
      adapter.addBridgeMapping({
        tokenIn: '0xUSDT',
        tokenOut: '0xWETH',
        ticker: 'ETH-USD',
        chainId: 56,
        dydxSide: 'BUY',
        baseDecimals: 18,
        quoteAmountWei: '1000000000000000000',
      });

      adapter.orderBridge.removeMapping('BTC-USD');

      const mappings: TokenTickerMapping[] = (adapter.orderBridge as any).mappings;
      assert.equal(mappings.length, 1);
      assert.equal(mappings[0].ticker, 'ETH-USD');
    });

    it('getBridgeOrders should return empty array initially', () => {
      const adapter = new DydxAdapter(validConfig());
      assert.deepEqual(adapter.getBridgeOrders(), []);
    });
  });
});

// ── ArbitrageDetector ────────────────────────────────────────────────────────

describe('ArbitrageDetector', () => {
  describe('configuration and pair management', () => {
    it('should have default config values', () => {
      const adapter = new DydxAdapter(validConfig());
      const config = adapter.arbitrage.getConfig();
      assert.equal(config.minSpreadBps, 30);
      assert.equal(config.maxPositionUsd, 10_000);
      assert.equal(config.minProfitUsd, 5);
      assert.equal(config.autoExecute, false);
    });

    it('addPair should store pair config', () => {
      const adapter = new DydxAdapter(validConfig());
      const pair: ArbPairConfig = {
        ticker: 'BTC-USD',
        deluthiumTokenIn: '0xUSDT',
        deluthiumTokenOut: '0xWBTC',
        chainId: 56,
        baseDecimals: 18,
        quoteAmountWei: '1000000000000000000',
      };

      adapter.addArbitragePair(pair);

      const pairConfigs: ArbPairConfig[] = (adapter.arbitrage as any).pairConfigs;
      assert.equal(pairConfigs.length, 1);
      assert.equal(pairConfigs[0].ticker, 'BTC-USD');
    });

    it('removePair should remove pair by ticker', () => {
      const adapter = new DydxAdapter(validConfig());
      adapter.addArbitragePair({
        ticker: 'BTC-USD',
        deluthiumTokenIn: '0xUSDT',
        deluthiumTokenOut: '0xWBTC',
        chainId: 56,
        baseDecimals: 18,
        quoteAmountWei: '1000000000000000000',
      });
      adapter.addArbitragePair({
        ticker: 'ETH-USD',
        deluthiumTokenIn: '0xUSDT',
        deluthiumTokenOut: '0xWETH',
        chainId: 56,
        baseDecimals: 18,
        quoteAmountWei: '1000000000000000000',
      });

      adapter.arbitrage.removePair('BTC-USD');

      const pairConfigs: ArbPairConfig[] = (adapter.arbitrage as any).pairConfigs;
      assert.equal(pairConfigs.length, 1);
      assert.equal(pairConfigs[0].ticker, 'ETH-USD');
    });

    it('getRecentOpportunities should return empty array initially', () => {
      const adapter = new DydxAdapter(validConfig());
      assert.deepEqual(adapter.getArbitrageOpportunities(), []);
    });

    it('setScanInterval should change the interval', () => {
      const adapter = new DydxAdapter(validConfig());
      adapter.arbitrage.setScanInterval(10_000);
      assert.equal((adapter.arbitrage as any).scanIntervalMs, 10_000);
    });
  });
});

// ── MarketDataFeed ───────────────────────────────────────────────────────────

describe('MarketDataFeed', () => {
  describe('order book level merging', () => {
    it('mergeLevels should update existing levels and add new ones', () => {
      const cosmosClient = new CosmosClient(validConfig());
      const feed = new MarketDataFeed(cosmosClient);

      const existing: OrderBookLevel[] = [
        { price: '50000', size: '1.5' },
        { price: '49900', size: '2.0' },
      ];

      const deltas: OrderBookLevel[] = [
        { price: '50000', size: '3.0' },  // update
        { price: '50100', size: '0.5' },  // new
      ];

      const merged = (feed as any).mergeLevels(existing, deltas);

      // Should contain 3 levels, sorted desc by price
      assert.equal(merged.length, 3);
      assert.equal(merged[0].price, '50100');
      assert.equal(merged[0].size, '0.5');
      assert.equal(merged[1].price, '50000');
      assert.equal(merged[1].size, '3.0');
      assert.equal(merged[2].price, '49900');
      assert.equal(merged[2].size, '2.0');
    });

    it('mergeLevels should remove levels with size 0', () => {
      const cosmosClient = new CosmosClient(validConfig());
      const feed = new MarketDataFeed(cosmosClient);

      const existing: OrderBookLevel[] = [
        { price: '50000', size: '1.5' },
        { price: '49900', size: '2.0' },
      ];

      const deltas: OrderBookLevel[] = [
        { price: '50000', size: '0' },  // remove
      ];

      const merged = (feed as any).mergeLevels(existing, deltas);
      assert.equal(merged.length, 1);
      assert.equal(merged[0].price, '49900');
    });

    it('parseBookLevels should convert WSBookLevel tuples', () => {
      const cosmosClient = new CosmosClient(validConfig());
      const feed = new MarketDataFeed(cosmosClient);

      const wsLevels: [string, string][] = [
        ['50000', '1.5'],
        ['49900', '2.0'],
      ];

      const levels = (feed as any).parseBookLevels(wsLevels);
      assert.equal(levels.length, 2);
      assert.equal(levels[0].price, '50000');
      assert.equal(levels[0].size, '1.5');
    });

    it('parseBookLevels should return empty for undefined input', () => {
      const cosmosClient = new CosmosClient(validConfig());
      const feed = new MarketDataFeed(cosmosClient);

      const levels = (feed as any).parseBookLevels(undefined);
      assert.deepEqual(levels, []);
    });
  });

  describe('price helpers on empty book', () => {
    it('getMidPrice should return null when no book exists', () => {
      const feed = new MarketDataFeed(new CosmosClient(validConfig()));
      assert.equal(feed.getMidPrice('BTC-USD'), null);
    });

    it('getSpreadBps should return null when no book exists', () => {
      const feed = new MarketDataFeed(new CosmosClient(validConfig()));
      assert.equal(feed.getSpreadBps('BTC-USD'), null);
    });

    it('getBestBid should return null when no book exists', () => {
      const feed = new MarketDataFeed(new CosmosClient(validConfig()));
      assert.equal(feed.getBestBid('BTC-USD'), null);
    });
  });
});

// ── Bridge Strategy Types ────────────────────────────────────────────────────

describe('OrderBridgeStrategy types', () => {
  it('should accept valid strategy values', () => {
    const strategies: OrderBridgeStrategy[] = ['mirror', 'spread', 'dynamic'];
    assert.equal(strategies.length, 3);
    assert.ok(strategies.includes('mirror'));
    assert.ok(strategies.includes('spread'));
    assert.ok(strategies.includes('dynamic'));
  });

  it('bridge strategy defaults to mirror', () => {
    const adapter = new DydxAdapter(validConfig());
    const strategy: string = (adapter.orderBridge as any).strategy;
    assert.equal(strategy, 'mirror');
  });

  it('bridge strategy can be set via config', () => {
    const adapter = new DydxAdapter(validConfig({ bridgeStrategy: 'dynamic' }));
    const strategy: string = (adapter.orderBridge as any).strategy;
    assert.equal(strategy, 'dynamic');
  });
});
