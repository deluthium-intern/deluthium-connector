# @deluthium/ccxt

Deluthium exchange adapter for [CCXT](https://github.com/ccxt/ccxt) — extends `ccxt.Exchange` externally without forking.

## Installation

```bash
npm install @deluthium/ccxt ccxt
# or
pnpm add @deluthium/ccxt ccxt
```

## Quick Start

```typescript
import { DeluthiumExchange } from '@deluthium/ccxt';

const exchange = new DeluthiumExchange({
  apiKey: 'your-jwt-token',
  chainId: 56, // BSC
});

// Standard CCXT interface
const markets = await exchange.fetchMarkets();
const ticker = await exchange.fetchTicker('WBNB/USDT');

// Indicative quote
const quote = await exchange.fetchQuote('WBNB/USDT', 1.0, 'buy');

// Firm quote (returns calldata for on-chain execution)
const order = await exchange.createOrder('WBNB/USDT', 'market', 'buy', 1.0, undefined, {
  walletAddress: '0xYourWallet...',
});
console.log(order.info.calldata); // Submit this to blockchain
```

## Supported Methods

| Method | Description |
|--------|-------------|
| `fetchMarkets()` | List all trading pairs |
| `fetchCurrencies()` | List all supported tokens |
| `fetchTicker(symbol)` | Get price data for a pair |
| `fetchOHLCV(symbol, timeframe)` | Historical candlestick data |
| `fetchQuote(symbol, amount, side)` | Get indicative quote |
| `createOrder(symbol, 'market', side, amount)` | Get firm quote with calldata |

## Supported Chains

- BSC (Chain ID: 56) — Default
- Base (Chain ID: 8453)
- Ethereum (Chain ID: 1) — Coming soon

## License

Apache-2.0
