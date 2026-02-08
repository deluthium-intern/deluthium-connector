# @deluthium/sdk

Core SDK for Deluthium integrations. Provides shared functionality used by all adapter packages.

## Features

- **REST API Client** -- Typed client for Deluthium RFQ API (`/pairs`, `/indicativeQuote`, `/firmQuote`)
- **WebSocket Client** -- Real-time depth updates and RFQ handling with auto-reconnect
- **EIP-712 Signing** -- MMQuote signing with `ISigner` abstraction (PrivateKey, KMS, Vault)
- **Chain Config** -- Built-in configs for BSC, Base, Ethereum, and more. Extensible via `registerChain()`
- **Type Definitions** -- Canonical TypeScript types for all Deluthium API interactions
- **Utilities** -- Wei conversion, address normalization, native token handling, retries

## Installation

```bash
pnpm add @deluthium/sdk
```

## Quick Start

```typescript
import {
  DeluthiumRestClient,
  PrivateKeySigner,
  signMMQuote,
  ChainId,
  toWei,
  fromWei,
} from '@deluthium/sdk';

// Create a REST client
const client = new DeluthiumRestClient({
  auth: 'your-jwt-token',
  chainId: ChainId.BSC,
});

// Fetch trading pairs
const pairs = await client.getPairs();

// Get an indicative quote
const quote = await client.getIndicativeQuote({
  src_chain_id: ChainId.BSC,
  dst_chain_id: ChainId.BSC,
  token_in: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  token_out: '0x55d398326f99059fF775485246999027B3197955',
  amount_in: toWei('1.0', 18),
});

console.log(`Price: ${fromWei(quote.amount_out, 18)} USDT per BNB`);
```

## Sub-path Exports

Import specific modules for tree-shaking:

```typescript
import { DeluthiumRestClient } from '@deluthium/sdk/client';
import { PrivateKeySigner } from '@deluthium/sdk/signer';
import { getChainConfig, ChainId } from '@deluthium/sdk/chain';
import { toWei, fromWei } from '@deluthium/sdk/utils';
import { DeluthiumError, APIError } from '@deluthium/sdk/errors';
import type { FirmQuoteRequest, ISigner } from '@deluthium/sdk/types';
```

## Signer Abstraction

The SDK provides an `ISigner` interface with multiple implementations:

```typescript
import { PrivateKeySigner, KmsSigner } from '@deluthium/sdk';

// Development: raw private key
const devSigner = new PrivateKeySigner('0xYOUR_PRIVATE_KEY');

// Production: AWS KMS (placeholder -- implement with AWS SDK)
const prodSigner = new KmsSigner('key-id', 'us-east-1');
```

## Chain Configuration

```typescript
import { getChainConfig, registerChain, getSupportedChains } from '@deluthium/sdk';

// Get built-in chain config
const bsc = getChainConfig(56);
console.log(bsc.rfqManagerAddress); // '0x94020Af...'

// Register a custom chain
registerChain({
  chainId: 43114,
  name: 'Avalanche',
  symbol: 'AVAX',
  nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
  rpcUrls: ['https://api.avax.network/ext/bc/C/rpc'],
  explorerUrl: 'https://snowtrace.io',
  wrappedNativeToken: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
  supported: false,
});
```

## License

Apache-2.0
