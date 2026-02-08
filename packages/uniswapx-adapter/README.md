# @deluthium/uniswapx-adapter

UniswapX filler adapter for Deluthium. Enables Deluthium market makers to act as UniswapX fillers by sourcing liquidity from Deluthium's RFQ network.

## Overview

UniswapX uses signed intent orders (Dutch auctions) where fillers compete to execute swaps at the best price. This adapter bridges Deluthium liquidity into the UniswapX ecosystem, allowing MMs to:

- Parse and evaluate Dutch auction orders (V2, Exclusive, Priority)
- Compare Deluthium quotes against the auction decay curve
- Execute fills via Reactor contracts with Permit2 approvals
- Run an automated order polling and fill loop

## Installation

```bash
pnpm add @deluthium/uniswapx-adapter @deluthium/sdk
```

## Quick Start

```typescript
import { UniswapXAdapter } from '@deluthium/uniswapx-adapter';
import { PrivateKeySigner, ChainId } from '@deluthium/sdk';

const adapter = new UniswapXAdapter({
  deluthiumConfig: {
    auth: process.env.DELUTHIUM_JWT!,
    chainId: ChainId.ETHEREUM,
  },
  signer: new PrivateKeySigner(process.env.PRIVATE_KEY!),
  chainId: ChainId.ETHEREUM,
  rpcUrl: process.env.ETH_RPC_URL!,
  minProfitBps: 25, // Minimum 0.25% profit
});

// Listen for profitable orders
adapter.on('orderEvaluated', (evaluation) => {
  if (evaluation.profitable) {
    console.log(`Profitable order found: ${evaluation.order.orderHash}`);
    console.log(`  Net profit: ${evaluation.netProfitWei} wei (${evaluation.profitBps} bps)`);
  }
});

// Start polling
await adapter.start();
```

## Supported Chains

- Ethereum (1)
- Arbitrum (42161)
- Base (8453)
- Polygon (137)
- Optimism (10)
- BNB Chain (56)

## Architecture

```
UniswapX Order API → Parse Dutch Auction → Query Deluthium Quote
  → Compare price vs decay curve → If profitable → Fill via Reactor
```

## API Reference

### `UniswapXAdapter`

Main adapter class with polling, evaluation, and fill capabilities.

### `UniswapXFiller`

Core fill evaluation engine. Use directly for custom strategies.

### `ReactorClient`

On-chain interaction with Reactor contracts for executing fills.

### `Permit2Client`

Permit2 approval management and signing utilities.

### Order Parser

Functions for parsing and evaluating Dutch auction decay curves.

## License

Apache-2.0
