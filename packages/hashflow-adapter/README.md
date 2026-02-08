# @deluthium/hashflow-adapter

Hashflow RFQ bridge adapter for Deluthium. Enables Deluthium market makers to bridge their liquidity to the Hashflow RFQ network.

## Overview

Hashflow is an RFQ-based DEX that connects takers with market makers via WebSocket. This adapter allows Deluthium to act as a Hashflow market maker, sourcing all quotes from Deluthium's liquidity network.

The adapter handles:
- WebSocket connection and authentication with Hashflow
- Publishing Deluthium-sourced price levels to the Hashflow network
- Responding to incoming RFQ requests (rfqT) by proxying to Deluthium
- EIP-191 signature generation for Hashflow's on-chain verification
- Cross-chain quote support via Wormhole/LayerZero

## Installation

```bash
pnpm add @deluthium/hashflow-adapter @deluthium/sdk
```

## Quick Start

```typescript
import { HashflowAdapter } from '@deluthium/hashflow-adapter';
import { PrivateKeySigner, ChainId } from '@deluthium/sdk';

const adapter = new HashflowAdapter({
  deluthiumConfig: {
    auth: process.env.DELUTHIUM_JWT!,
    chainId: ChainId.ETHEREUM,
  },
  signer: new PrivateKeySigner(process.env.PRIVATE_KEY!),
  marketMaker: 'my-deluthium-mm',
  chains: [ChainId.ETHEREUM, ChainId.ARBITRUM],
  pairs: ['ETH/USDC', 'ETH/USDT'],
  spreadBps: 5,
});

// Register token addresses for each pair
adapter.registerPairTokens('ETH/USDC', 1, {
  baseToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  quoteToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  baseDecimals: 18,
  quoteDecimals: 6,
});

adapter.on('rfqReceived', (request) => {
  console.log(`RFQ from ${request.trader}`);
});

await adapter.start();
```

## Supported Chains

- Ethereum (1)
- Arbitrum (42161)
- Avalanche (43114)
- BNB Chain (56)
- Optimism (10)
- Polygon (137)
- Base (8453)

## Architecture

```
Hashflow WebSocket <-> HashflowWSClient
                         |
                    PricePublisher (Deluthium -> Hashflow price levels)
                         |
                    RFQHandler (Hashflow rfqT -> Deluthium firmQuote -> sign -> respond)
```

## Cross-Chain Support

The adapter supports cross-chain quotes via Wormhole and LayerZero:

```typescript
import { isRouteSupported, getRoute } from '@deluthium/hashflow-adapter';

if (isRouteSupported('ethereum', 'arbitrum')) {
  const route = getRoute('ethereum', 'arbitrum');
  console.log(`Protocol: ${route.protocol}`);
}
```

## License

Apache-2.0
