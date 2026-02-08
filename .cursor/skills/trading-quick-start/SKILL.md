# Skill: Deluthium Trading Quick Start

## Description

Get an AI agent executing trades on Deluthium in minimal steps. This skill covers two paths: CCXT (simplest, 5 lines) and SDK (full control). Use this whenever a user or agent needs to trade tokens, swap assets, or get price quotes on Deluthium.

## Trigger

Use this skill when the task involves:
- Trading tokens on Deluthium
- Getting price quotes
- Executing token swaps
- Setting up a new Deluthium trading integration
- Connecting an AI agent to Deluthium for the first time

## Prerequisites

- Node.js >= 18
- A Deluthium JWT API key
- For on-chain execution: a wallet private key and ETH/BNB for gas

## Path A: CCXT Adapter (Simplest)

Best for: agents that need standard exchange operations (fetch price, buy, sell).

### Step 1: Install

```bash
npm install @deluthium/ccxt-adapter ccxt
```

### Step 2: Initialize

```typescript
import { DeluthiumExchange } from '@deluthium/ccxt-adapter';

const exchange = new DeluthiumExchange({
  apiKey: process.env.DELUTHIUM_API_KEY!,
  chainId: 56, // BSC. Use 8453 for Base.
});
```

### Step 3: Discover Markets

```typescript
const markets = await exchange.fetchMarkets();
// Returns: Array of { symbol, id, base, quote, active, ... }
// Example symbols: "WBNB/USDT", "ETH/USDT", "BTCB/USDT"
```

### Step 4: Get Price

```typescript
const ticker = await exchange.fetchTicker('WBNB/USDT');
// ticker.bid  -- best bid price
// ticker.ask  -- best ask price
// ticker.last -- last trade price
```

### Step 5: Execute Trade

```typescript
const order = await exchange.createOrder(
  'WBNB/USDT',    // symbol
  'market',        // type (always 'market' for RFQ)
  'buy',           // side: 'buy' or 'sell'
  1.0,             // amount in base token units
  undefined,       // price (not used for market orders)
  { walletAddress: '0xYourWalletAddress' },
);

// order.info.calldata       -- submit this as a blockchain transaction
// order.info.router_address -- send the transaction to this contract
// order.info.amount_out     -- guaranteed output amount
```

### Step 6: Submit On-Chain (using ethers.js)

```typescript
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

const tx = await wallet.sendTransaction({
  to: order.info.router_address,
  data: order.info.calldata,
});
const receipt = await tx.wait();
console.log(`Trade executed: ${receipt.hash}`);
```

## Path B: Core SDK (Full Control)

Best for: agents that need custom logic, WebSocket streaming, or EIP-712 signing.

### Step 1: Install

```bash
npm install @deluthium/sdk
```

### Step 2: Initialize Client

```typescript
import { DeluthiumRestClient, ChainId, toWei, fromWei } from '@deluthium/sdk';

const client = new DeluthiumRestClient({
  auth: process.env.DELUTHIUM_API_KEY!,
  chainId: ChainId.BSC, // 56
});
```

### Step 3: Get Indicative Quote (Price Check)

```typescript
const quote = await client.getIndicativeQuote({
  src_chain_id: 56,
  dst_chain_id: 56,
  token_in:  '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
  token_out: '0x55d398326f99059fF775485246999027B3197955', // USDT
  amount_in: toWei('1.0', 18),
});

const price = fromWei(quote.amount_out, 18);
// price is a string like "310.50"
```

### Step 4: Get Firm Quote (Binding)

```typescript
const firmQuote = await client.getFirmQuote({
  src_chain_id: 56,
  dst_chain_id: 56,
  from_address: '0xYourWalletAddress',
  to_address:   '0xYourWalletAddress',
  token_in:  '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  token_out: '0x55d398326f99059fF775485246999027B3197955',
  amount_in: toWei('1.0', 18),
  slippage: 0.5,
  expiry_time_sec: 300,
});

// firmQuote.calldata       -- transaction data
// firmQuote.router_address -- target contract
// firmQuote.amount_out     -- guaranteed output (wei)
```

### Step 5: Execute On-Chain

Same as Path A, Step 6. Send `firmQuote.calldata` to `firmQuote.router_address`.

## Common Token Addresses (BSC)

| Token | Address | Decimals |
|---|---|---|
| WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` | 18 |
| USDT | `0x55d398326f99059fF775485246999027B3197955` | 18 |
| USDC | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | 18 |
| ETH  | `0x2170Ed0880ac9A755fd29B2688956BD959F933F8` | 18 |
| BTCB | `0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c` | 18 |

## Error Handling

Always wrap API calls in try/catch:

```typescript
import { AuthenticationError, RateLimitError, QuoteExpiredError } from '@deluthium/sdk/errors';

try {
  const quote = await client.getIndicativeQuote(request);
} catch (err) {
  if (err instanceof AuthenticationError) {
    // Refresh your JWT token
  } else if (err instanceof RateLimitError) {
    // Wait err.retryAfterMs milliseconds, then retry
  } else if (err instanceof QuoteExpiredError) {
    // Request a new quote
  }
}
```

## Further Reading

- Full API reference: [AGENTS.md](../../AGENTS.md)
- Market making: [market-making skill](../market-making/SKILL.md)
- Multi-protocol integration: [multi-protocol skill](../multi-protocol-integration/SKILL.md)
- SDK documentation: [packages/sdk/README.md](../../packages/sdk/README.md)
