# @deluthium/binance-dex-adapter

Deluthium adapter for **Binance DEX (PancakeSwap)** on BNB Chain. Provides AMM routing, price comparison between Deluthium RFQ and PancakeSwap, and split-route execution that optimizes output across both venues.

## Features

- **PancakeSwap V2 + V3** quoting with automatic multi-hop fallback via WBNB
- **Price comparison** between Deluthium RFQ and PancakeSwap AMM (net of gas)
- **Split-route optimization** via grid + ternary search
- **Pool discovery** for V2 pairs and V3 concentrated-liquidity pools
- **Gas estimation** with BNB/USD conversion
- **Event-driven monitoring** for continuous price updates
- **On-chain execution** for both Deluthium firm quotes and PancakeSwap swaps

## Installation

```bash
pnpm add @deluthium/binance-dex-adapter
```

> Peer dependency: `@deluthium/sdk` and `ethers` v6.

## Quick Start

```typescript
import {
  BinanceDexAdapter,
  BNB_CHAIN_TOKENS,
} from '@deluthium/binance-dex-adapter';
import { toWei, PrivateKeySigner, ChainId } from '@deluthium/sdk';

// 1. Configure the adapter
const adapter = new BinanceDexAdapter({
  deluthium: {
    auth: process.env.DELUTHIUM_JWT!,
    chainId: ChainId.BSC,
  },
  signer: new PrivateKeySigner(process.env.PRIVATE_KEY!),
  rpcUrl: 'https://bsc-dataseed.binance.org',
  maxSlippageBps: 50, // 0.5%
});

// 2. Initialize (creates all sub-components)
await adapter.initialize();

// 3. Compare prices
const comparison = await adapter.comparePrice(
  BNB_CHAIN_TOKENS.WBNB,
  BNB_CHAIN_TOKENS.USDT,
  toWei('10', 18),
);

console.log('Best source:', comparison.bestQuote.source);
console.log('Spread (bps):', comparison.spreadBps);

for (const quote of comparison.quotes) {
  console.log(
    `  ${quote.source}: ${quote.effectivePrice} (gas: $${quote.gasCostUsd})`,
  );
}
```

## Price Comparison

```typescript
const comparison = await adapter.comparePrice(srcToken, destToken, amount);

// comparison.quotes      — all SourceQuote objects (sorted by net output)
// comparison.bestQuote   — the quote with highest net output
// comparison.spreadBps   — price difference between best and worst in bps
```

## Split Routing

The split router finds the optimal allocation between Deluthium RFQ and
PancakeSwap AMM for a given trade:

```typescript
const route = await adapter.getOptimalRoute(
  BNB_CHAIN_TOKENS.WBNB,
  BNB_CHAIN_TOKENS.USDT,
  toWei('100', 18),
);

console.log('Split beneficial?', route.splitBeneficial);
console.log('Improvement (bps):', route.improvementBps);

for (const alloc of route.allocations) {
  console.log(
    `  ${alloc.source}: ${(alloc.fraction * 100).toFixed(1)}%`,
    `(${alloc.srcAmount} -> ${alloc.destAmount})`,
  );
}
```

### Executing a Route

```typescript
// Connect a wallet for on-chain execution
adapter.connectWallet(process.env.PRIVATE_KEY!);

const result = await adapter.executeRoute(route);
console.log('Success:', result.success);
console.log('Actual output:', result.totalActualOutput);
console.log('Realized slippage (bps):', result.realizedSlippageBps);
```

## Price Monitoring

Subscribe to continuous price updates:

```typescript
adapter.on('price:updated', (comparison) => {
  console.log('Price update:', comparison.bestQuote.effectivePrice);
});

adapter.on('price:error', (err) => {
  console.error('Price fetch failed:', err);
});

// Start polling every 3 seconds (configurable via priceRefreshIntervalMs)
adapter.startPriceMonitoring(
  BNB_CHAIN_TOKENS.WBNB,
  BNB_CHAIN_TOKENS.USDT,
  toWei('1', 18),
);

// Later...
adapter.stopPriceMonitoring();
```

## Using Sub-Components Directly

The adapter exposes its internal components for advanced use cases:

```typescript
// PancakeSwap client
const pools = await adapter.pancakeSwap.discoverPools(tokenA, tokenB);
const v3Quote = await adapter.pancakeSwap.getV3Quote(src, dest, amount);

// Price comparator
const comparison = await adapter.comparator.compare(src, dest, amount);

// Split router
const route = await adapter.router.computeOptimalSplit(src, dest, amount);
```

## Configuration

| Option                   | Type     | Default | Description                                 |
| ------------------------ | -------- | ------- | ------------------------------------------- |
| `deluthium`              | object   | —       | Deluthium SDK client configuration          |
| `signer`                 | ISigner  | —       | Signer for Deluthium firm quotes            |
| `chainId`                | number   | `56`    | BNB Chain ID                                |
| `rpcUrl`                 | string   | auto    | JSON-RPC endpoint (auto-resolved from SDK)  |
| `maxSlippageBps`         | number   | `50`    | Max slippage tolerance (basis points)       |
| `priceRefreshIntervalMs` | number   | `3000`  | Price monitoring poll interval (ms)         |
| `minDeluthiumSplitBps`   | number   | `1000`  | Minimum Deluthium allocation (basis points) |
| `maxGasPriceGwei`        | number   | `5`     | Maximum gas price in gwei                   |
| `useV3Pools`             | boolean  | `true`  | Include PancakeSwap V3 pools                |
| `useV2Pools`             | boolean  | `true`  | Include PancakeSwap V2 pools                |

## API Reference

### `BinanceDexAdapter`

| Method                  | Description                                        |
| ----------------------- | -------------------------------------------------- |
| `initialize()`          | Create sub-components and connect to BNB Chain     |
| `comparePrice()`        | Compare prices across all sources                  |
| `getOptimalRoute()`     | Compute optimal split route                        |
| `executeRoute(route)`   | Execute a split route on-chain                     |
| `startPriceMonitoring()`| Begin continuous price polling                     |
| `stopPriceMonitoring()` | Stop polling                                       |
| `connectWallet(key)`    | Connect wallet for execution                       |
| `on(event, handler)`    | Subscribe to events                                |
| `off(event, handler)`   | Unsubscribe from events                            |
| `destroy()`             | Clean up resources                                 |

### Events

| Event               | Payload            | Description                     |
| ------------------- | ------------------ | ------------------------------- |
| `price:updated`     | `PriceComparison`  | New price data available        |
| `price:error`       | `Error`            | Price fetch failed              |
| `comparison:ready`  | `PriceComparison`  | Comparison result ready         |
| `route:computed`    | `SplitRoute`       | Optimal route computed          |
| `route:executed`    | `SplitExecutionResult` | Route execution complete    |
| `route:error`       | `Error`            | Route execution failed          |

## License

Apache-2.0
