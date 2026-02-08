# @deluthium/dydx-adapter

Deluthium adapter for **dYdX v4** (Cosmos-based perpetuals). Bridges Deluthium RFQ spot liquidity onto the dYdX order book, provides real-time market data, and detects cross-venue arbitrage opportunities.

## Features

- **CosmosClient** -- REST-based dYdX chain interactions (accounts, orders, markets) via the Indexer API
- **MarketDataFeed** -- Real-time order book and trade data via WebSocket, with REST snapshot fallback
- **OrderBridge** -- Converts Deluthium indicative quotes into dYdX limit orders with automatic refresh
- **ArbitrageDetector** -- Monitors dYdX perps vs Deluthium spot for cross-venue price discrepancies
- **DydxAdapter** -- Unified facade composing all components

## Installation

```bash
pnpm add @deluthium/dydx-adapter
```

## Quick Start

```typescript
import { DydxAdapter } from '@deluthium/dydx-adapter';
import { PrivateKeySigner } from '@deluthium/sdk';

// 1. Create the adapter
const adapter = new DydxAdapter({
  deluthium: {
    auth: process.env.DELUTHIUM_JWT!,
    chainId: 56, // BSC
  },
  signer: new PrivateKeySigner(process.env.PRIVATE_KEY!),
  network: 'mainnet',
});

// 2. Initialize (verifies dYdX indexer connectivity)
await adapter.initialize('dydx1your_address_here');

// 3. Fetch markets
const markets = await adapter.getMarkets();
console.log('Available markets:', markets.map((m) => m.ticker));

// 4. Subscribe to live data
await adapter.connectMarketData();
adapter.subscribeMarket('BTC-USD');
adapter.subscribeMarket('ETH-USD');

adapter.on('orderbook:update', (book) => {
  console.log(`${book.ticker} best bid: ${book.bids[0]?.price}`);
});
```

## Order Bridge

The order bridge converts Deluthium indicative quotes into dYdX limit orders:

```typescript
import { DydxAdapter, type TokenTickerMapping } from '@deluthium/dydx-adapter';

const adapter = new DydxAdapter({ /* config */ });
await adapter.initialize('dydx1...');
await adapter.connectMarketData();

// Map a Deluthium token pair to a dYdX perpetual market
adapter.addBridgeMapping({
  tokenIn: '0xUSDT_ADDRESS',
  tokenOut: '0xWBTC_ADDRESS',
  ticker: 'BTC-USD',
  chainId: 56,
  dydxSide: 'BUY',
  baseDecimals: 18,
  quoteAmountWei: '100000000000000000000', // 100 USDT in wei
});

// Listen for bridge events
adapter.on('bridge:placed', (order) => {
  console.log('Bridge order placed:', order.bridgeId, order.price);
});

adapter.on('bridge:filled', (order) => {
  console.log('Bridge order filled:', order.bridgeId);
});

// Start the bridge (begins refresh loop)
await adapter.startBridge();

// Stop later
await adapter.stopBridge();
```

### Bridge Strategies

| Strategy  | Description |
|-----------|-------------|
| `mirror`  | Place dYdX limit orders at the exact Deluthium quote price |
| `spread`  | Place orders with a configurable spread around mid-price |
| `dynamic` | Dynamically adjust spread based on dYdX order book conditions |

Set the strategy via `bridgeStrategy` in the adapter config.

## Arbitrage Detection

Monitor both venues for price discrepancies:

```typescript
import { DydxAdapter, type ArbPairConfig } from '@deluthium/dydx-adapter';

const adapter = new DydxAdapter({
  deluthium: { auth: 'jwt', chainId: 56 },
  signer: mySigner,
  network: 'mainnet',
});

await adapter.initialize('dydx1...');
await adapter.connectMarketData();
adapter.subscribeMarket('BTC-USD');

// Configure arbitrage pair
adapter.addArbitragePair({
  ticker: 'BTC-USD',
  deluthiumTokenIn: '0xUSDT...',
  deluthiumTokenOut: '0xWBTC...',
  chainId: 56,
  baseDecimals: 18,
  quoteAmountWei: '1000000000000000000',
});

// Listen for opportunities
adapter.on('arbitrage:detected', (opp) => {
  console.log(`Arb detected: ${opp.pair}`);
  console.log(`  Direction: ${opp.direction}`);
  console.log(`  Spread: ${opp.spreadBps} bps`);
  console.log(`  Net profit: $${opp.netProfitUsd}`);
});

await adapter.startArbitrage();
```

## Direct Component Access

For advanced use cases, access sub-components directly:

```typescript
const adapter = new DydxAdapter({ /* config */ });
await adapter.initialize();

// Use CosmosClient directly
const markets = await adapter.cosmos.getMarkets();
const orders = await adapter.cosmos.getOrders('BTC-USD');

// Use MarketDataFeed directly
const book = await adapter.marketData.getOrderBook('ETH-USD');
const midPrice = adapter.marketData.getMidPrice('BTC-USD');

// Use OrderBridge directly
adapter.orderBridge.addMapping({ /* ... */ });
await adapter.orderBridge.start();
const bridgeOrders = adapter.orderBridge.getBridgeOrders();

// Use ArbitrageDetector directly
adapter.arbitrage.addPair({ /* ... */ });
adapter.arbitrage.setScanInterval(3000);
await adapter.arbitrage.start();
```

## Account Operations

```typescript
// Get subaccount info
const account = await adapter.getSubaccount();
console.log('Equity:', account.equity, 'Free collateral:', account.freeCollateral);

// Get positions
const positions = await adapter.getPositions();
for (const pos of positions) {
  console.log(`${pos.ticker}: ${pos.side} ${pos.size} @ ${pos.entryPrice}`);
}

// Place an order
const order = await adapter.placeOrder({
  ticker: 'BTC-USD',
  side: 'BUY',
  type: 'LIMIT',
  size: '0.001',
  price: '40000.00',
  timeInForce: 'GTT',
  goodTilTimeSec: 120,
  postOnly: true,
});

// Cancel an order
await adapter.cancelOrder(order.orderId, order.ticker, order.clientId);

// Cancel all orders for a market
await adapter.cancelAllOrders('BTC-USD');
```

## Events

| Event | Data | Description |
|-------|------|-------------|
| `orderbook:update` | `OrderBook` | Order book snapshot updated |
| `market:update` | `{ ticker, trades, timestamp }` | New trades detected |
| `bridge:placed` | `BridgeOrder` | Bridge order placed on dYdX |
| `bridge:filled` | `BridgeOrder` | Bridge order fully filled |
| `bridge:cancelled` | `BridgeOrder` | Bridge order cancelled |
| `bridge:error` | `{ bridgeId?, error, timestamp }` | Bridge error occurred |
| `arbitrage:detected` | `ArbitrageOpportunity` | Arbitrage opportunity found |
| `connected` | `undefined` | WebSocket connected |
| `disconnected` | `{ code, reason }` | WebSocket disconnected |

## Configuration

```typescript
interface DydxAdapterConfig {
  deluthium: DeluthiumClientConfig;     // Deluthium SDK config
  signer: ISigner;                      // EVM signer
  network: 'mainnet' | 'testnet';      // dYdX network
  restEndpoint?: string;                // Custom indexer REST endpoint
  wsEndpoint?: string;                  // Custom indexer WS endpoint
  bridgeRefreshIntervalMs?: number;     // Bridge refresh interval (default: 2000)
  bridgeStrategy?: OrderBridgeStrategy; // 'mirror' | 'spread' | 'dynamic'
  maxBridgeOrders?: number;             // Max concurrent orders (default: 10)
  priceDeviationThresholdBps?: number;  // Refresh threshold (default: 20)
  subaccountNumber?: number;            // dYdX subaccount (default: 0)
}
```

## Shutdown

Always shut down gracefully to cancel orders and close connections:

```typescript
await adapter.shutdown();
```

## License

Apache-2.0
