# Skill: Deluthium Multi-Protocol Integration

## Description

Guide an AI agent to choose the right Deluthium adapter and integrate with one or more DeFi protocols. This skill covers all 11 adapter packages with decision criteria, quick-start code for each, and cross-protocol strategies.

## Trigger

Use this skill when the task involves:
- Choosing which Deluthium adapter to use
- Integrating Deluthium with a specific DeFi protocol (0x, 1inch, UniswapX, etc.)
- Building cross-protocol or multi-venue trading strategies
- Connecting Deluthium to an existing trading infrastructure
- Registering Deluthium as a liquidity source in an aggregator

## Decision Matrix

Use this table to pick the right adapter:

| If You... | Use This | Install |
|---|---|---|
| Want the simplest trading integration | CCXT Adapter | `npm i @deluthium/ccxt-adapter ccxt` |
| Need full control (custom MM, arbitrage, signing) | Core SDK | `npm i @deluthium/sdk` |
| Already use CCXT in your bot | CCXT Adapter | `npm i @deluthium/ccxt-adapter ccxt` |
| Already use Hummingbot | Hummingbot Connector | `pip install deluthium-hummingbot` |
| Are an 0x Protocol RFQ maker | 0x Adapter | `npm i @deluthium/0x-adapter` |
| Use 1inch Limit Order Protocol | 1inch Adapter | `npm i @deluthium/1inch-adapter` |
| Want to fill UniswapX Dutch auctions | UniswapX Adapter | `npm i @deluthium/uniswapx-adapter` |
| Are a Hashflow RFQ responder | Hashflow Adapter | `npm i @deluthium/hashflow-adapter` |
| Want to be a Paraswap liquidity source | Paraswap Adapter | `npm i @deluthium/paraswap-adapter` |
| Want to bridge dYdX v4 order book | dYdX Adapter | `npm i @deluthium/dydx-adapter` |
| Want PancakeSwap split-routing on BNB | Binance DEX Adapter | `npm i @deluthium/binance-dex-adapter` |
| Need FIX 4.4 / institutional OTC | Institutional Adapter | `npm i @deluthium/institutional-adapter` |
| Want interactive project scaffolding | CLI | `npx @deluthium/cli init` |

## Adapter Quick Starts

### 1. CCXT Adapter

Standard exchange interface. Works with any CCXT-compatible bot.

```typescript
import { DeluthiumExchange } from '@deluthium/ccxt-adapter';

const exchange = new DeluthiumExchange({
  apiKey: process.env.DELUTHIUM_API_KEY!,
  chainId: 56,
});

const markets = await exchange.fetchMarkets();
const ticker = await exchange.fetchTicker('WBNB/USDT');
const ohlcv = await exchange.fetchOHLCV('WBNB/USDT', '1h', undefined, 24);

// Trade (returns calldata for on-chain execution)
const order = await exchange.createOrder('WBNB/USDT', 'market', 'buy', 1.0, undefined, {
  walletAddress: '0xYourWallet',
});
```

**Supported CCXT methods:** `fetchMarkets`, `fetchCurrencies`, `fetchTicker`, `fetchOHLCV`, `fetchQuote`, `createOrder`

### 2. Hummingbot Connector

Auto-injects Deluthium as a connector in Hummingbot.

```bash
pip install deluthium-hummingbot
```

After installation, Deluthium appears as an exchange in Hummingbot. Configure in `conf/`:

```yaml
exchange: deluthium
api_key: your-jwt-token
chain_id: 56
```

Use any built-in Hummingbot strategy (pure market making, cross-exchange, arbitrage, etc.).

### 3. 0x Protocol Adapter

Serve as an RFQ maker in the 0x ecosystem, backed by Deluthium liquidity.

```typescript
import { ZeroXAdapter } from '@deluthium/0x-adapter';
import { PrivateKeySigner, ChainId } from '@deluthium/sdk';

const adapter = new ZeroXAdapter({
  deluthiumConfig: {
    auth: process.env.DELUTHIUM_API_KEY!,
    chainId: ChainId.BSC,
  },
  signer: new PrivateKeySigner(process.env.PRIVATE_KEY!),
  // 0x-specific configuration
  rfqtMakerUri: 'https://your-maker-endpoint.com',
});

// Handle incoming 0x RFQ requests
adapter.on('rfqRequest', async (request) => {
  const response = await adapter.generateQuote(request);
  return response; // Signed 0x-compatible quote
});

await adapter.start();
```

### 4. 1inch Adapter

Provide Deluthium liquidity through 1inch Limit Order Protocol.

```typescript
import { OneInchAdapter } from '@deluthium/1inch-adapter';
import { PrivateKeySigner, ChainId } from '@deluthium/sdk';

const adapter = new OneInchAdapter({
  deluthiumConfig: {
    auth: process.env.DELUTHIUM_API_KEY!,
    chainId: ChainId.BSC,
  },
  signer: new PrivateKeySigner(process.env.PRIVATE_KEY!),
});

// Create limit orders backed by Deluthium pricing
const order = await adapter.createLimitOrder({
  makerToken: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  takerToken: '0x55d398326f99059fF775485246999027B3197955',
  makerAmount: '1000000000000000000',
});
```

Also includes `DeluthiumOracle.sol` -- a Solidity contract for on-chain price verification.

### 5. UniswapX Adapter

Fill UniswapX Dutch auction orders using Deluthium pricing.

```typescript
import { UniswapXAdapter } from '@deluthium/uniswapx-adapter';
import { PrivateKeySigner, ChainId } from '@deluthium/sdk';

const adapter = new UniswapXAdapter({
  deluthiumConfig: {
    auth: process.env.DELUTHIUM_API_KEY!,
    chainId: ChainId.BSC,
  },
  signer: new PrivateKeySigner(process.env.PRIVATE_KEY!),
});

// Monitor and fill profitable Dutch auction orders
adapter.on('order', async (order) => {
  const profitable = await adapter.evaluateOrder(order);
  if (profitable) {
    await adapter.fillOrder(order);
  }
});

await adapter.start();
```

### 6. Hashflow Adapter

Bridge Hashflow RFQ requests to Deluthium.

```typescript
import { HashflowAdapter } from '@deluthium/hashflow-adapter';

const adapter = new HashflowAdapter({
  deluthiumConfig: {
    auth: process.env.DELUTHIUM_API_KEY!,
    chainId: ChainId.BSC,
  },
  // Hashflow WebSocket RFQ configuration
  hashflowWsUrl: 'wss://api.hashflow.com/mm/v1',
});

await adapter.start();
```

### 7. Paraswap Adapter

Register Deluthium as a liquidity source in the Paraswap aggregator.

```typescript
import { ParaswapAdapter } from '@deluthium/paraswap-adapter';

const adapter = new ParaswapAdapter({
  deluthiumConfig: {
    auth: process.env.DELUTHIUM_API_KEY!,
    chainId: ChainId.BSC,
  },
});

// Register as a pool adapter
await adapter.registerPool();
await adapter.start();
```

### 8. dYdX Adapter

Bridge between dYdX v4 order book and Deluthium for cross-venue strategies.

```typescript
import { DydxAdapter } from '@deluthium/dydx-adapter';

const adapter = new DydxAdapter({
  deluthiumConfig: {
    auth: process.env.DELUTHIUM_API_KEY!,
    chainId: ChainId.BSC,
  },
  dydxConfig: {
    endpoint: 'https://dydx-mainnet.imperator.co',
    chainId: 'dydx-mainnet-1',
  },
});

// Monitor price differences between dYdX and Deluthium
adapter.on('arbitrageOpportunity', async (opp) => {
  console.log(`Spread: ${opp.spreadBps}bps on ${opp.pair}`);
  if (opp.spreadBps > 10) {
    await adapter.executeArbitrage(opp);
  }
});

await adapter.start();
```

### 9. Binance DEX Adapter

Split-route between PancakeSwap and Deluthium on BNB Chain.

```typescript
import { BinanceDexAdapter } from '@deluthium/binance-dex-adapter';

const adapter = new BinanceDexAdapter({
  deluthiumConfig: {
    auth: process.env.DELUTHIUM_API_KEY!,
    chainId: ChainId.BSC,
  },
  pancakeswapRouterAddress: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
});

// Get optimal split-route
const route = await adapter.getOptimalRoute({
  tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  tokenOut: '0x55d398326f99059fF775485246999027B3197955',
  amountIn: '10000000000000000000', // 10 BNB
});
// route.deluthiumPercent -- e.g. 65 (65% via Deluthium)
// route.pancakePercent   -- e.g. 35 (35% via PancakeSwap)
```

### 10. Institutional Adapter

FIX 4.4 gateway and OTC REST API for institutional counterparties.

```typescript
import { InstitutionalAdapter } from '@deluthium/institutional-adapter';
import { PrivateKeySigner, ChainId } from '@deluthium/sdk';

const adapter = new InstitutionalAdapter({
  deluthiumConfig: {
    auth: process.env.DELUTHIUM_API_KEY!,
    chainId: ChainId.BSC,
  },
  signer: new PrivateKeySigner(process.env.PRIVATE_KEY!),
  counterparties: {
    wintermute: {
      id: 'wintermute',
      name: 'Wintermute',
      type: 'market-maker',
      apiKey: 'wm-api-key',
      defaultSettlement: 'on-chain',
      active: true,
    },
  },
  tokenMappings: [
    { symbol: 'BNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18, chainId: 56 },
    { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, chainId: 56 },
  ],
  fixConfig: {
    port: 9876,
    sessions: {
      WINTERMUTE: {
        senderCompId: 'DELUTHIUM',
        targetCompId: 'WINTERMUTE',
        fixVersion: '4.4',
        heartbeatIntervalSec: 30,
      },
    },
  },
  otcApiConfig: { port: 8080 },
});

await adapter.start();
```

**FIX message flow:**
- QuoteRequest (R) -> Deluthium indicativeQuote -> Quote (S)
- NewOrderSingle (D) with QuoteID -> Deluthium firmQuote -> ExecutionReport (8)

**OTC REST endpoints:**
- `POST /api/v1/rfq` -- Submit RFQ
- `POST /api/v1/quote/:id/accept` -- Accept quote
- `POST /api/v1/quote/:id/reject` -- Reject quote
- `GET /api/v1/quotes` -- List active quotes
- `GET /api/v1/trades` -- Trade history

## Cross-Protocol Strategies

### Strategy 1: Multi-Aggregator Liquidity

Run Deluthium liquidity across multiple aggregators simultaneously:

```typescript
// All adapters share the same Deluthium credentials
const sharedConfig = {
  auth: process.env.DELUTHIUM_API_KEY!,
  chainId: ChainId.BSC,
};

// Start all adapters in parallel
await Promise.all([
  zeroXAdapter.start(),      // 0x RFQ maker
  oneInchAdapter.start(),    // 1inch limit orders
  paraswapAdapter.start(),   // Paraswap pool
  hashflowAdapter.start(),   // Hashflow RFQ
]);
```

### Strategy 2: Arbitrage Across Venues

Use dYdX adapter + SDK to monitor and exploit price differences:

```typescript
// dYdX price via adapter
const dydxPrice = await dydxAdapter.getPrice('BNB/USDT');

// Deluthium price via SDK
const deluthiumQuote = await restClient.getIndicativeQuote({...});
const deluthiumPrice = parseFloat(deluthiumQuote.price);

if (Math.abs(dydxPrice - deluthiumPrice) / deluthiumPrice > 0.001) {
  // Execute the arb
}
```

### Strategy 3: Smart Order Routing

Split large orders between Deluthium and PancakeSwap:

```typescript
const route = await binanceDexAdapter.getOptimalRoute({
  tokenIn: WBNB,
  tokenOut: USDT,
  amountIn: toWei('100.0', 18),
});

// Execute the split route
await binanceDexAdapter.executeRoute(route);
```

## Further Reading

- Full API reference: [AGENTS.md](../../AGENTS.md)
- Trading quick start: [trading-quick-start skill](../trading-quick-start/SKILL.md)
- Market making: [market-making skill](../market-making/SKILL.md)
