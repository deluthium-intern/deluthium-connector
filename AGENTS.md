# Deluthium -- Agent Integration Guide

> This document is designed for AI agents, LLMs, and autonomous trading systems.
> It contains everything needed to understand, integrate, and trade on Deluthium programmatically.

---

## Identity

```yaml
name: Deluthium
type: RFQ-based decentralized exchange
version: 0.1.0
api_base_url: https://rfq-api.deluthium.ai
websocket_url: wss://ws.deluthium.ai
supported_chains:
  - { chain_id: 56, name: "BNB Smart Chain", status: "live" }
  - { chain_id: 8453, name: "Base", status: "live" }
  - { chain_id: 1, name: "Ethereum", status: "coming_soon" }
  - { chain_id: 42161, name: "Arbitrum One", status: "coming_soon" }
  - { chain_id: 324, name: "zkSync Era", status: "coming_soon" }
  - { chain_id: 137, name: "Polygon", status: "coming_soon" }
authentication: JWT Bearer token
signing: EIP-712 typed data
license: Apache-2.0
npm_package: "@deluthium/sdk"
```

---

## Table of Contents

1. [Capabilities](#1-capabilities)
2. [Choose Your Integration Path](#2-choose-your-integration-path)
3. [Authentication](#3-authentication)
4. [Core Workflows](#4-core-workflows)
5. [REST API Reference](#5-rest-api-reference)
6. [WebSocket Protocol](#6-websocket-protocol)
7. [Type Definitions](#7-type-definitions)
8. [Error Handling](#8-error-handling)
9. [Chain Reference](#9-chain-reference)
10. [EIP-712 Signing](#10-eip-712-signing)
11. [Rate Limits and Best Practices](#11-rate-limits-and-best-practices)
12. [Adapter Quick Reference](#12-adapter-quick-reference)

---

## 1. Capabilities

Deluthium enables the following agent actions:

| Capability | Method | Description |
|---|---|---|
| **Discover pairs** | `GET /api/v1/listing-pairs` | List all tradeable token pairs on a chain |
| **Discover tokens** | `GET /api/v1/listing-tokens` | List all supported tokens on a chain |
| **Get price quote** | `POST /api/v1/indicative-quote` | Non-binding price quote for a token swap |
| **Execute trade** | `POST /v1/quote/firm` | Binding quote with on-chain calldata for execution |
| **Market data** | `GET /v1/market/pair` | OHLCV-compatible market pair data |
| **Candlestick data** | `GET /v1/market/klines` | Historical kline/candlestick data |
| **Stream depth** | `WS subscribe depth:{pair}` | Real-time bid/ask depth updates |
| **Respond to RFQs** | `WS rfq_response` | Market makers can respond to incoming quote requests |
| **EIP-712 signing** | SDK `signMMQuote()` | Sign structured quote data for on-chain verification |

---

## 2. Choose Your Integration Path

Use the following decision tree to select the right integration:

```
START
  |
  +-- Do you use CCXT already?
  |     YES --> Install @deluthium/ccxt-adapter
  |             (Standard fetchMarkets, fetchTicker, createOrder interface)
  |
  +-- Do you use Hummingbot?
  |     YES --> Install deluthium-hummingbot (pip)
  |             (Auto-injects as a Hummingbot connector)
  |
  +-- Do you use 0x Protocol?
  |     YES --> Install @deluthium/0x-adapter
  |             (Deluthium becomes an RFQ maker in your 0x flow)
  |
  +-- Do you use 1inch?
  |     YES --> Install @deluthium/1inch-adapter
  |             (Deluthium liquidity via 1inch limit orders)
  |
  +-- Do you use UniswapX?
  |     YES --> Install @deluthium/uniswapx-adapter
  |             (Fill Dutch auction orders with Deluthium pricing)
  |
  +-- Do you need FIX protocol / institutional OTC?
  |     YES --> Install @deluthium/institutional-adapter
  |             (FIX 4.4 gateway + REST OTC API + audit trail)
  |
  +-- None of the above / want full control?
        --> Install @deluthium/sdk
            (Direct REST + WebSocket + signing)
```

### Installation Commands

```bash
# Core SDK (recommended starting point)
npm install @deluthium/sdk

# CCXT adapter (simplest path for trading)
npm install @deluthium/ccxt-adapter ccxt

# Interactive CLI (scaffolds any adapter project)
npx @deluthium/cli init

# All other adapters
npm install @deluthium/0x-adapter
npm install @deluthium/1inch-adapter
npm install @deluthium/uniswapx-adapter
npm install @deluthium/hashflow-adapter
npm install @deluthium/paraswap-adapter
npm install @deluthium/dydx-adapter
npm install @deluthium/binance-dex-adapter
npm install @deluthium/institutional-adapter

# Hummingbot (Python)
pip install deluthium-hummingbot
```

---

## 3. Authentication

Deluthium uses JWT Bearer tokens for all API access.

### Configuration

```typescript
import { DeluthiumRestClient, ChainId } from '@deluthium/sdk';

// Static token
const client = new DeluthiumRestClient({
  auth: 'your-jwt-token',
  chainId: ChainId.BSC,       // 56
});

// Dynamic token (refreshes automatically)
const client = new DeluthiumRestClient({
  auth: async () => {
    // Your token refresh logic
    return await fetchNewToken();
  },
  chainId: ChainId.BSC,
});
```

### HTTP Header Format

All REST requests include:

```
Authorization: Bearer <jwt-token>
Content-Type: application/json
Accept: application/json
```

### WebSocket Authentication

WebSocket connections authenticate via the `Authorization` header at connection time:

```typescript
import { DeluthiumWSClient, ChainId } from '@deluthium/sdk';

const ws = new DeluthiumWSClient({
  auth: 'your-jwt-token',
  chainId: ChainId.BSC,
  wsUrl: 'wss://ws.deluthium.ai',
});
await ws.connect();
```

---

## 4. Core Workflows

### 4.1 Get a Price Quote (Indicative)

Use this to check prices without committing to a trade.

```typescript
import { DeluthiumRestClient, ChainId, toWei, fromWei } from '@deluthium/sdk';

const client = new DeluthiumRestClient({
  auth: 'your-jwt-token',
  chainId: ChainId.BSC,
});

const quote = await client.getIndicativeQuote({
  src_chain_id: 56,
  dst_chain_id: 56,
  token_in:  '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
  token_out: '0x55d398326f99059fF775485246999027B3197955', // USDT
  amount_in: toWei('1.0', 18),  // 1 BNB in wei
});

// quote.amount_out  -- output amount in wei (string)
// quote.price       -- human-readable price
// quote.valid_for_ms -- how long the quote is valid
const outputAmount = fromWei(quote.amount_out, 18); // e.g. "310.50"
```

### 4.2 Execute a Trade (Firm Quote)

A firm quote returns on-chain calldata that can be submitted as a transaction.

```typescript
const firmQuote = await client.getFirmQuote({
  src_chain_id: 56,
  dst_chain_id: 56,
  from_address: '0xYourWalletAddress',
  to_address:   '0xYourWalletAddress',
  token_in:  '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  token_out: '0x55d398326f99059fF775485246999027B3197955',
  amount_in: toWei('1.0', 18),
  slippage: 0.5,            // 0.5% slippage tolerance
  expiry_time_sec: 300,     // Quote valid for 5 minutes
});

// firmQuote.calldata        -- encoded calldata for the swap transaction
// firmQuote.router_address  -- contract address to send the transaction to
// firmQuote.amount_out      -- guaranteed output amount in wei
// firmQuote.deadline        -- unix timestamp when quote expires
// firmQuote.quote_id        -- unique identifier for this quote

// Submit the transaction using ethers.js or any EVM library:
// const tx = await wallet.sendTransaction({
//   to: firmQuote.router_address,
//   data: firmQuote.calldata,
//   value: 0, // or msg.value if swapping native token
// });
```

### 4.3 Stream Real-Time Prices (WebSocket)

```typescript
import { DeluthiumWSClient, ChainId } from '@deluthium/sdk';

const ws = new DeluthiumWSClient({
  auth: 'your-jwt-token',
  chainId: ChainId.BSC,
  wsUrl: 'wss://ws.deluthium.ai',
});

ws.on('connected', () => {
  console.log('Connected to Deluthium WebSocket');
});

ws.on('depth', (update) => {
  // update.pair       -- e.g. "BNB/USDT"
  // update.bids       -- [[price, quantity], ...]
  // update.asks       -- [[price, quantity], ...]
  // update.timestamp  -- unix timestamp
  console.log(`${update.pair}: best bid ${update.bids[0]?.[0]}, best ask ${update.asks[0]?.[0]}`);
});

ws.on('disconnected', ({ code, reason }) => {
  console.log(`Disconnected: ${code} ${reason}`);
  // Auto-reconnect is built-in -- no action needed
});

await ws.connect();
ws.subscribe('BNB/USDT');
```

### 4.4 Market Making Loop

For agents acting as market makers, responding to RFQ requests:

```typescript
import {
  DeluthiumWSClient,
  DeluthiumRestClient,
  PrivateKeySigner,
  signMMQuote,
  buildMMQuoteDomain,
  getRfqManagerAddress,
  ChainId,
  toWei,
  calculateDeadline,
  generateNonce,
} from '@deluthium/sdk';

const chainId = ChainId.BSC;
const signer = new PrivateKeySigner(process.env.PRIVATE_KEY!);

const ws = new DeluthiumWSClient({
  auth: process.env.DELUTHIUM_API_KEY!,
  chainId,
  wsUrl: 'wss://ws.deluthium.ai',
});

// Listen for incoming RFQ requests
ws.on('rfq_request', async (rfq) => {
  // rfq.request_id   -- unique request ID
  // rfq.token_in     -- token being sold by the taker
  // rfq.token_out    -- token the taker wants to buy
  // rfq.amount_in    -- amount in wei
  // rfq.chain_id     -- chain ID
  // rfq.from_address -- taker's address
  // rfq.deadline     -- request deadline

  // 1. Calculate your quote (your pricing logic here)
  const myQuoteAmountOut = calculateMyPrice(rfq);

  // 2. Build and sign the MMQuote
  const domain = buildMMQuoteDomain(chainId);
  const quoteParams = {
    manager:     getRfqManagerAddress(chainId)!,
    from:        rfq.from_address,
    to:          rfq.from_address,
    inputToken:  rfq.token_in,
    outputToken: rfq.token_out,
    amountIn:    BigInt(rfq.amount_in),
    amountOut:   BigInt(myQuoteAmountOut),
    deadline:    calculateDeadline(300),
    nonce:       generateNonce(),
    extraData:   '0x',
  };

  const signed = await signMMQuote(quoteParams, domain, signer);

  // 3. Send the response
  ws.sendRFQResponse({
    request_id: rfq.request_id,
    amount_out: myQuoteAmountOut,
    signature:  signed.signature,
    expiry:     quoteParams.deadline,
  });
});

await ws.connect();
```

### 4.5 Cross-Venue Arbitrage

```typescript
import { DeluthiumRestClient, ChainId, toWei, fromWei } from '@deluthium/sdk';

const deluthium = new DeluthiumRestClient({
  auth: 'your-jwt-token',
  chainId: ChainId.BSC,
});

// 1. Get Deluthium price
const deluthiumQuote = await deluthium.getIndicativeQuote({
  src_chain_id: 56,
  dst_chain_id: 56,
  token_in:  '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  token_out: '0x55d398326f99059fF775485246999027B3197955',
  amount_in: toWei('10.0', 18),
});

const deluthiumPrice = parseFloat(deluthiumQuote.price);

// 2. Compare with another venue (e.g., via CCXT, dYdX adapter, etc.)
const otherVenuePrice = await getOtherVenuePrice('BNB/USDT');

// 3. Execute if profitable
const spread = Math.abs(deluthiumPrice - otherVenuePrice) / otherVenuePrice;
if (spread > 0.001) { // 0.1% threshold
  // Execute the arbitrage...
}
```

### 4.6 CCXT Path (Simplest for Trading Agents)

```typescript
import { DeluthiumExchange } from '@deluthium/ccxt-adapter';

const exchange = new DeluthiumExchange({
  apiKey: process.env.DELUTHIUM_API_KEY!,
  chainId: 56,
});

// Discover markets
const markets = await exchange.fetchMarkets();

// Get live price
const ticker = await exchange.fetchTicker('WBNB/USDT');
console.log(`Bid: ${ticker.bid}, Ask: ${ticker.ask}, Last: ${ticker.last}`);

// Get historical candles
const ohlcv = await exchange.fetchOHLCV('WBNB/USDT', '1h', undefined, 24);

// Execute a trade (returns firm quote with calldata)
const order = await exchange.createOrder(
  'WBNB/USDT',
  'market',
  'buy',
  1.0,
  undefined,
  { walletAddress: '0xYourWallet' },
);
// order.info.calldata       -- submit this to the blockchain
// order.info.router_address -- target contract
```

---

## 5. REST API Reference

**Base URL:** `https://rfq-api.deluthium.ai`

All responses follow this envelope:

```json
{
  "code": 10000,
  "message": "success",
  "data": { ... }
}
```

`code === 10000` indicates success. Any other code is an error.

### GET /api/v1/listing-pairs

Fetch all trading pairs for a chain.

**Query Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `chain_id` | number | Yes | EVM chain ID (e.g., 56 for BSC) |

**Response Data:** `TradingPair[]`

```json
[
  {
    "id": "wbnb-usdt-bsc",
    "baseToken": {
      "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      "symbol": "WBNB",
      "name": "Wrapped BNB",
      "decimals": 18,
      "chainId": 56
    },
    "quoteToken": {
      "address": "0x55d398326f99059fF775485246999027B3197955",
      "symbol": "USDT",
      "name": "Tether USD",
      "decimals": 18,
      "chainId": 56
    },
    "chainId": 56,
    "active": true,
    "minOrderSize": "100000000000000",
    "maxOrderSize": "1000000000000000000000"
  }
]
```

### GET /api/v1/listing-tokens

Fetch all supported tokens for a chain.

**Query Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `chain_id` | number | Yes | EVM chain ID |

**Response Data:** `Token[]`

```json
[
  {
    "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    "symbol": "WBNB",
    "name": "Wrapped BNB",
    "decimals": 18,
    "chainId": 56,
    "logoUri": "https://..."
  }
]
```

### POST /api/v1/indicative-quote

Request a non-binding price quote. Use for price discovery.

**Request Body:**

```json
{
  "src_chain_id": 56,
  "dst_chain_id": 56,
  "token_in": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  "token_out": "0x55d398326f99059fF775485246999027B3197955",
  "amount_in": "1000000000000000000",
  "side": "sell"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `src_chain_id` | number | Yes | Source chain ID |
| `dst_chain_id` | number | Yes | Destination chain ID (same as src for same-chain) |
| `token_in` | string | Yes | Address of token being sold |
| `token_out` | string | Yes | Address of token being bought |
| `amount_in` | string | Yes | Amount in wei (as string) |
| `side` | string | No | `"sell"` or `"buy"` (default: `"sell"`) |

**Response Data:**

```json
{
  "token_in": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  "token_out": "0x55d398326f99059fF775485246999027B3197955",
  "amount_in": "1000000000000000000",
  "amount_out": "310500000000000000000",
  "price": "310.50",
  "timestamp": 1707350400000,
  "valid_for_ms": 10000
}
```

### POST /v1/quote/firm

Request a binding quote with on-chain calldata for execution.

**Request Body:**

```json
{
  "src_chain_id": 56,
  "dst_chain_id": 56,
  "from_address": "0xYourWalletAddress",
  "to_address": "0xYourWalletAddress",
  "token_in": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  "token_out": "0x55d398326f99059fF775485246999027B3197955",
  "amount_in": "1000000000000000000",
  "slippage": 0.5,
  "expiry_time_sec": 300
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `src_chain_id` | number | Yes | Source chain ID |
| `dst_chain_id` | number | Yes | Destination chain ID |
| `from_address` | string | Yes | Sender wallet address |
| `to_address` | string | Yes | Receiver wallet address |
| `token_in` | string | Yes | Token being sold |
| `token_out` | string | Yes | Token being bought |
| `amount_in` | string | Yes | Amount in wei |
| `indicative_amount_out` | string | No | Previous indicative quote (for slippage reference) |
| `slippage` | number | Yes | Slippage tolerance in percent (e.g., 0.5 = 0.5%) |
| `expiry_time_sec` | number | Yes | Quote validity in seconds from now |

**Response Data:**

```json
{
  "quote_id": "q-abc123",
  "src_chain_id": 56,
  "calldata": "0x...",
  "router_address": "0xRouterContractAddress",
  "from_address": "0xYourWalletAddress",
  "to_address": "0xYourWalletAddress",
  "token_in": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  "token_out": "0x55d398326f99059fF775485246999027B3197955",
  "amount_in": "1000000000000000000",
  "amount_out": "310000000000000000000",
  "fee_rate": 5,
  "fee_amount": "1550000000000000000",
  "deadline": 1707350700
}
```

**To execute the trade**, submit a blockchain transaction:

```
to:   firmQuote.router_address
data: firmQuote.calldata
```

### GET /v1/market/pair

Fetch OHLCV-compatible market pair data.

**Query Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `base` | string | Yes | Base token address |
| `quote` | string | Yes | Quote token address |
| `chain_id` | number | Yes | Chain ID |

### GET /v1/market/klines

Fetch candlestick/kline data.

**Query Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pair` | string | Yes | Pair identifier |
| `interval` | string | Yes | Timeframe (e.g., `"1m"`, `"5m"`, `"1h"`, `"1d"`) |
| `limit` | number | No | Number of candles (default: 100) |
| `chain_id` | number | Yes | Chain ID |

---

## 6. WebSocket Protocol

**URL:** `wss://ws.deluthium.ai`

Authentication: `Authorization: Bearer <token>` header at connection time.

### Message Format

All messages are JSON:

```json
{
  "type": "subscribe|unsubscribe|depth|rfq_request|rfq_response|heartbeat|error",
  "channel": "depth:BNB/USDT",
  "data": { ... },
  "id": 1,
  "timestamp": 1707350400000
}
```

### Subscribe to Depth

**Send:**

```json
{ "type": "subscribe", "channel": "depth:BNB/USDT", "id": 1 }
```

**Receive (on each update):**

```json
{
  "type": "depth",
  "data": {
    "pair": "BNB/USDT",
    "bids": [["310.50", "5.2"], ["310.45", "10.0"]],
    "asks": [["310.60", "3.8"], ["310.65", "7.5"]],
    "timestamp": 1707350400000
  }
}
```

### Unsubscribe

```json
{ "type": "unsubscribe", "channel": "depth:BNB/USDT", "id": 2 }
```

### Heartbeat

The client should send heartbeats every 30 seconds:

```json
{ "type": "heartbeat", "id": 3 }
```

### RFQ Request (Market Makers)

Market makers receive incoming RFQ requests:

```json
{
  "type": "rfq_request",
  "data": {
    "request_id": "rfq-abc123",
    "token_in": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    "token_out": "0x55d398326f99059fF775485246999027B3197955",
    "amount_in": "1000000000000000000",
    "chain_id": 56,
    "from_address": "0xTakerAddress",
    "deadline": 1707350700
  }
}
```

### RFQ Response (Market Makers)

Respond to an RFQ request:

```json
{
  "type": "rfq_response",
  "data": {
    "request_id": "rfq-abc123",
    "amount_out": "310500000000000000000",
    "signature": "0x...",
    "expiry": 1707350700
  },
  "id": 4
}
```

### Error Messages

```json
{
  "type": "error",
  "data": { "code": "INVALID_CHANNEL", "message": "Channel not found" }
}
```

### Connection Behavior

- Auto-reconnect: Built into the SDK with exponential backoff (1s base, max 10 attempts)
- Heartbeat: 30-second interval, server expects regular heartbeats
- Resubscription: SDK automatically resubscribes to all channels after reconnect

---

## 7. Type Definitions

All TypeScript types used by the SDK and adapters.

### Token

```typescript
interface Token {
  address: string;       // EVM address (checksummed or lowercased)
  symbol: string;        // e.g. "WBNB"
  name: string;          // e.g. "Wrapped BNB"
  decimals: number;      // e.g. 18
  chainId: number;       // EVM chain ID
  logoUri?: string;      // Optional logo URL
}
```

### TradingPair

```typescript
interface TradingPair {
  id: string;                    // e.g. "wbnb-usdt-bsc"
  baseToken: Token;
  quoteToken: Token;
  chainId: number;
  active: boolean;               // Whether pair is currently quoted
  minOrderSize?: string;         // Min in base token wei
  maxOrderSize?: string;         // Max in base token wei
}
```

### IndicativeQuoteRequest

```typescript
interface IndicativeQuoteRequest {
  src_chain_id: number;
  dst_chain_id: number;
  token_in: string;              // Token address being sold
  token_out: string;             // Token address being bought
  amount_in: string;             // Amount in wei (as string)
  side?: 'sell' | 'buy';
}
```

### IndicativeQuoteResponse

```typescript
interface IndicativeQuoteResponse {
  token_in: string;
  token_out: string;
  amount_in: string;             // Wei
  amount_out: string;            // Wei
  price: string;                 // Human-readable price
  timestamp: number;             // Unix ms
  valid_for_ms?: number;         // Quote validity duration
}
```

### FirmQuoteRequest

```typescript
interface FirmQuoteRequest {
  src_chain_id: number;
  dst_chain_id: number;
  from_address: string;
  to_address: string;
  token_in: string;
  token_out: string;
  amount_in: string;             // Wei
  indicative_amount_out?: string;
  slippage: number;              // Percentage (0.5 = 0.5%)
  expiry_time_sec: number;       // Seconds from now
}
```

### FirmQuoteResponse

```typescript
interface FirmQuoteResponse {
  quote_id: string;
  src_chain_id: number;
  calldata: string;              // Encoded calldata for router.swap()
  router_address: string;        // Contract to send transaction to
  from_address: string;
  to_address: string;
  token_in: string;
  token_out: string;
  amount_in: string;             // Wei
  amount_out: string;            // Guaranteed output wei
  fee_rate: number;              // Basis points
  fee_amount: string;            // Fee in output token wei
  deadline: number;              // Unix timestamp (seconds)
}
```

### MMQuoteParams (EIP-712)

```typescript
interface MMQuoteParams {
  manager: string;               // RFQ Manager contract address
  from: string;                  // Sender address
  to: string;                    // Receiver address
  inputToken: string;            // Input token (zero address = native)
  outputToken: string;           // Output token (zero address = native)
  amountIn: bigint;
  amountOut: bigint;
  deadline: number;              // Unix seconds
  nonce: bigint;                 // Anti-replay nonce
  extraData: string;             // Extra bytes (default "0x")
}
```

### ChainConfig

```typescript
interface ChainConfig {
  chainId: number;
  name: string;                  // e.g. "BNB Smart Chain"
  symbol: string;                // e.g. "BSC"
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  explorerUrl: string;
  wrappedNativeToken: string;    // WBNB, WETH, etc.
  rfqManagerAddress?: string;    // Undefined = not deployed yet
  supported: boolean;
}
```

### DeluthiumClientConfig

```typescript
interface DeluthiumClientConfig {
  baseUrl?: string;              // Default: https://rfq-api.deluthium.ai
  wsUrl?: string;                // WebSocket URL
  auth: string | (() => string | Promise<string>);
  chainId: number;
  timeoutMs?: number;            // Default: 30000
  maxRetries?: number;           // Default: 3
  userAgent?: string;
}
```

### WebSocket Types

```typescript
interface DepthUpdate {
  pair: string;                  // e.g. "BNB/USDT"
  bids: [price: string, quantity: string][];
  asks: [price: string, quantity: string][];
  timestamp: number;
}

interface WSRFQRequest {
  request_id: string;
  token_in: string;
  token_out: string;
  amount_in: string;
  chain_id: number;
  from_address: string;
  deadline: number;
}

interface WSRFQResponse {
  request_id: string;
  amount_out: string;
  signature?: string;
  expiry: number;
}
```

### ISigner Interface

```typescript
interface ISigner {
  getAddress(): Promise<string>;
  signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string>;
  signMessage(message: string | Uint8Array): Promise<string>;
}
```

Implementations:
- `PrivateKeySigner` -- Raw private key (development)
- `KmsSigner` -- AWS KMS (production)
- Custom: implement `ISigner` for any signing backend

---

## 8. Error Handling

All errors extend `DeluthiumError` and include `code`, `message`, and `timestamp`.

| Error Class | Code | Cause | Recovery |
|---|---|---|---|
| `ValidationError` | `VALIDATION_ERROR` | Invalid input parameters | Fix the input and retry |
| `APIError` | `API_ERROR` | HTTP or business logic error | Check `httpStatus` and `apiCode`, retry if transient |
| `AuthenticationError` | `AUTH_ERROR` | 401/403 or expired token | Refresh JWT token and retry |
| `RateLimitError` | `RATE_LIMIT_ERROR` | 429 Too Many Requests | Wait `retryAfterMs` then retry |
| `TimeoutError` | `TIMEOUT_ERROR` | Request or WS operation timed out | Retry with possible backoff |
| `QuoteExpiredError` | `QUOTE_EXPIRED_ERROR` | Quote past its deadline | Request a new quote |
| `WebSocketError` | `WEBSOCKET_ERROR` | WS connection failure | SDK auto-reconnects; check `closeCode` |
| `SigningError` | `SIGNING_ERROR` | EIP-712 signing failed | Check signer config and private key |
| `ChainError` | `CHAIN_ERROR` | Chain not supported/misconfigured | Verify chain ID, use `registerChain()` if custom |

### Error Handling Pattern

```typescript
import {
  DeluthiumError,
  AuthenticationError,
  RateLimitError,
  QuoteExpiredError,
} from '@deluthium/sdk/errors';

try {
  const quote = await client.getIndicativeQuote(request);
} catch (err) {
  if (err instanceof AuthenticationError) {
    // Refresh token and retry
    await refreshToken();
    return retry();
  }
  if (err instanceof RateLimitError) {
    // Wait and retry
    await sleep(err.retryAfterMs ?? 5000);
    return retry();
  }
  if (err instanceof QuoteExpiredError) {
    // Request a fresh quote
    return client.getIndicativeQuote(request);
  }
  if (err instanceof DeluthiumError) {
    console.error(`Deluthium error [${err.code}]: ${err.message}`);
  }
  throw err;
}
```

---

## 9. Chain Reference

### Live Chains

| Chain | ID | RFQ Manager | Wrapped Native | Explorer |
|---|---|---|---|---|
| BNB Smart Chain | `56` | `0x94020Af3571f253754e5566710A89666d90Df615` | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` (WBNB) | [bscscan.com](https://bscscan.com) |
| Base | `8453` | `0x7648CE928efa92372E2bb34086421a8a1702bD36` | `0x4200000000000000000000000000000000000006` (WETH) | [basescan.org](https://basescan.org) |

### Coming Soon

| Chain | ID | Wrapped Native |
|---|---|---|
| Ethereum | `1` | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` (WETH) |
| Arbitrum One | `42161` | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` (WETH) |
| zkSync Era | `324` | `0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91` (WETH) |
| Polygon | `137` | `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270` (WPOL) |

### Programmatic Access

```typescript
import {
  getChainConfig,
  getSupportedChains,
  getRfqManagerAddress,
  registerChain,
  ChainId,
} from '@deluthium/sdk/chain';

// Get config for a chain
const bsc = getChainConfig(ChainId.BSC);        // { chainId: 56, name: 'BNB Smart Chain', ... }

// List all live chains
const live = getSupportedChains();               // ChainConfig[]

// Get RFQ Manager address
const manager = getRfqManagerAddress(ChainId.BSC); // '0x94020Af...'

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

---

## 10. EIP-712 Signing

Deluthium uses EIP-712 typed data signatures for on-chain quote verification.

### Domain

```typescript
const domain = {
  name: 'Deluthium RFQ Manager',
  version: '1',
  chainId: 56,                    // Must match the chain
  verifyingContract: '0x94020Af3571f253754e5566710A89666d90Df615',
};
```

### MMQuote Type

```typescript
const types = {
  MMQuote: [
    { name: 'manager', type: 'address' },
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'inputToken', type: 'address' },
    { name: 'outputToken', type: 'address' },
    { name: 'amountIn', type: 'uint256' },
    { name: 'amountOut', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'extraData', type: 'bytes' },
  ],
};
```

### Signing with SDK

```typescript
import {
  PrivateKeySigner,
  signMMQuote,
  buildMMQuoteDomain,
  getRfqManagerAddress,
  calculateDeadline,
  generateNonce,
  ChainId,
} from '@deluthium/sdk';

const signer = new PrivateKeySigner('0xYOUR_PRIVATE_KEY');
const chainId = ChainId.BSC;
const domain = buildMMQuoteDomain(chainId);

const signed = await signMMQuote(
  {
    manager: getRfqManagerAddress(chainId)!,
    from: await signer.getAddress(),
    to: '0xReceiverAddress',
    inputToken: '0xTokenInAddress',
    outputToken: '0xTokenOutAddress',
    amountIn: BigInt('1000000000000000000'),
    amountOut: BigInt('310000000000000000000'),
    deadline: calculateDeadline(300),  // 5 minutes from now
    nonce: generateNonce(),
    extraData: '0x',
  },
  domain,
  signer,
);

// signed.hash      -- keccak256 of the EIP-712 typed data
// signed.signature -- hex-encoded signature
// signed.params    -- the original params
```

### Key Management Options

| Method | Class | Use Case |
|---|---|---|
| Raw private key | `PrivateKeySigner` | Development, testing |
| AWS KMS | `KmsSigner` | Production (key never leaves KMS) |
| HashiCorp Vault | `VaultSigner` | Enterprise key management |
| Custom | Implement `ISigner` | Any signing backend |

---

## 11. Rate Limits and Best Practices

### Recommended Intervals

| Operation | Recommended Interval | Notes |
|---|---|---|
| Indicative quotes | 1-2 seconds | Use for price monitoring |
| Firm quotes | On demand | Only when ready to execute |
| Pair/token listing | 5-10 minutes | Data changes infrequently |
| Klines | 1-5 minutes | Based on candle interval |
| WebSocket depth | Real-time (pushed) | No polling needed |
| Heartbeat (WS) | 30 seconds | SDK handles automatically |

### Best Practices for Agents

1. **Use WebSocket for prices** -- avoid polling the REST API for real-time data.
2. **Cache pair/token listings** -- they change infrequently. Refresh every 5-10 minutes.
3. **Handle rate limits gracefully** -- catch `RateLimitError`, wait `retryAfterMs`, then retry.
4. **Use indicative quotes first** -- check pricing before requesting firm quotes.
5. **Set reasonable deadlines** -- 60-300 seconds for firm quotes. Shorter = less risk of stale prices.
6. **Implement circuit breakers** -- if consecutive errors exceed a threshold, pause and investigate.
7. **Use sub-path imports** -- `@deluthium/sdk/client`, `@deluthium/sdk/signer`, etc. for smaller bundles.
8. **Monitor WebSocket health** -- listen to `connected`/`disconnected` events. The SDK auto-reconnects, but your agent should track connection state.
9. **Use unique nonces** -- `generateNonce()` uses crypto-random values. Never reuse nonces.
10. **Validate addresses** -- use `normalizeAddress()` to ensure consistent checksummed format.

### SDK Utility Functions

```typescript
import {
  toWei,               // toWei('1.5', 18) => '1500000000000000000'
  fromWei,             // fromWei('1500000000000000000', 18) => '1.5'
  normalizeAddress,    // Checksums and lowercases
  calculateDeadline,   // calculateDeadline(300) => now + 300 seconds
  generateNonce,       // Crypto-random bigint nonce
  sleep,               // sleep(1000) => wait 1 second
} from '@deluthium/sdk/utils';
```

---

## 12. Adapter Quick Reference

Each adapter wraps the core SDK for a specific protocol or platform.

| Adapter | npm Package | Primary Use Case | Key Methods |
|---|---|---|---|
| **CCXT** | `@deluthium/ccxt-adapter` | Universal trading | `fetchMarkets`, `fetchTicker`, `createOrder` |
| **Hummingbot** | `deluthium-hummingbot` (pip) | Bot strategies | Auto-injects as connector |
| **0x** | `@deluthium/0x-adapter` | 0x RFQ making | Field mapping, EIP-712 signing |
| **1inch** | `@deluthium/1inch-adapter` | Limit orders | Oracle contract + adapter |
| **UniswapX** | `@deluthium/uniswapx-adapter` | Intent filling | Dutch auction order filling |
| **Hashflow** | `@deluthium/hashflow-adapter` | RFQ bridge | WebSocket RFQ handling |
| **Paraswap** | `@deluthium/paraswap-adapter` | Aggregator source | Pool adapter registration |
| **dYdX** | `@deluthium/dydx-adapter` | Order book bridge | Cross-venue arbitrage |
| **BNB DEX** | `@deluthium/binance-dex-adapter` | DEX routing | PancakeSwap split-routing |
| **Institutional** | `@deluthium/institutional-adapter` | FIX / OTC | FIX 4.4, OTC REST API, audit |
| **CLI** | `@deluthium/cli` | Project setup | `npx @deluthium/cli init` |

---

## Appendix: Common Token Addresses

### BSC (Chain ID: 56)

| Token | Address | Decimals |
|---|---|---|
| WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` | 18 |
| USDT | `0x55d398326f99059fF775485246999027B3197955` | 18 |
| USDC | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | 18 |
| BUSD | `0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56` | 18 |
| ETH | `0x2170Ed0880ac9A755fd29B2688956BD959F933F8` | 18 |
| BTCB | `0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c` | 18 |

### Base (Chain ID: 8453)

| Token | Address | Decimals |
|---|---|---|
| WETH | `0x4200000000000000000000000000000000000006` | 18 |
| USDbC | `0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA` | 6 |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |

---

*This document is maintained alongside the Deluthium SDK. For the latest version, see the [repository](https://github.com/deluthium/deluthium-connector).*
