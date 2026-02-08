# Skill: Deluthium Market Making

## Description

Set up an autonomous market-making agent on Deluthium. This skill covers the complete market making loop: connecting via WebSocket, receiving RFQ requests, calculating quotes, EIP-712 signing, and responding. It also covers spread management, inventory tracking, and risk controls.

## Trigger

Use this skill when the task involves:
- Building a market maker on Deluthium
- Responding to RFQ requests programmatically
- Setting up WebSocket-based quote streaming
- EIP-712 signing for on-chain quote verification
- Implementing spread/inventory management for a trading agent

## Prerequisites

- Node.js >= 18
- `@deluthium/sdk` installed (`npm install @deluthium/sdk`)
- A Deluthium JWT API key
- A wallet private key for EIP-712 signing
- Understanding of market making concepts (bid/ask spread, inventory risk)

## Architecture

A Deluthium market maker operates in this loop:

```
Connect WebSocket
    |
    v
Receive RFQ Request (rfq_request)
    |
    v
Calculate Quote Price (your pricing logic)
    |
    v
Build MMQuote Parameters
    |
    v
Sign with EIP-712 (signMMQuote)
    |
    v
Send RFQ Response (rfq_response)
    |
    v
(loop back to receive next request)
```

## Step 1: Set Up Imports and Configuration

```typescript
import {
  DeluthiumRestClient,
  DeluthiumWSClient,
  PrivateKeySigner,
  signMMQuote,
  buildMMQuoteDomain,
  getRfqManagerAddress,
  getChainConfig,
  ChainId,
  toWei,
  fromWei,
  normalizeAddress,
  calculateDeadline,
  generateNonce,
} from '@deluthium/sdk';

const CHAIN_ID = ChainId.BSC;
const API_KEY = process.env.DELUTHIUM_API_KEY!;
const PRIVATE_KEY = process.env.PRIVATE_KEY!;

// Spread configuration
const BID_SPREAD_BPS = 10;  // 0.10% spread on buys
const ASK_SPREAD_BPS = 10;  // 0.10% spread on sells
const QUOTE_VALIDITY_SEC = 120; // 2-minute quote validity
```

## Step 2: Initialize Clients and Signer

```typescript
const restClient = new DeluthiumRestClient({
  auth: API_KEY,
  chainId: CHAIN_ID,
});

const wsClient = new DeluthiumWSClient({
  auth: API_KEY,
  chainId: CHAIN_ID,
  wsUrl: 'wss://ws.deluthium.ai',
});

const signer = new PrivateKeySigner(PRIVATE_KEY);
const signerAddress = await signer.getAddress();
const domain = buildMMQuoteDomain(CHAIN_ID);
const rfqManager = getRfqManagerAddress(CHAIN_ID)!;
```

## Step 3: Implement Pricing Logic

```typescript
// Simple mid-price + spread pricing
// Replace with your own pricing model (e.g., order book depth, volatility, inventory)
async function calculateQuotePrice(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  side: 'buy' | 'sell',
): Promise<string> {
  // Get the current mid-price from Deluthium
  const indicative = await restClient.getIndicativeQuote({
    src_chain_id: CHAIN_ID,
    dst_chain_id: CHAIN_ID,
    token_in: tokenIn,
    token_out: tokenOut,
    amount_in: amountIn,
  });

  const midAmount = BigInt(indicative.amount_out);
  const spreadBps = side === 'buy' ? BID_SPREAD_BPS : ASK_SPREAD_BPS;

  // Apply spread: reduce output for buys (taker buys, you sell at higher price)
  const adjustedAmount = midAmount - (midAmount * BigInt(spreadBps)) / BigInt(10000);

  return adjustedAmount.toString();
}
```

## Step 4: Handle RFQ Requests

```typescript
wsClient.on('rfq_request', async (rfq) => {
  try {
    console.log(`RFQ received: ${rfq.request_id}`);
    console.log(`  ${rfq.token_in} -> ${rfq.token_out}, amount: ${rfq.amount_in}`);

    // 1. Check if we want to quote this pair (filtering)
    if (!shouldQuote(rfq)) {
      console.log(`  Skipping: pair not in our universe`);
      return;
    }

    // 2. Check inventory limits
    if (!hasInventory(rfq.token_out, rfq.amount_in)) {
      console.log(`  Skipping: insufficient inventory`);
      return;
    }

    // 3. Calculate our quote
    const amountOut = await calculateQuotePrice(
      rfq.token_in,
      rfq.token_out,
      rfq.amount_in,
      'sell', // we are selling token_out to the taker
    );

    // 4. Build and sign the MMQuote
    const quoteParams = {
      manager:     rfqManager,
      from:        rfq.from_address,
      to:          rfq.from_address,
      inputToken:  normalizeAddress(rfq.token_in),
      outputToken: normalizeAddress(rfq.token_out),
      amountIn:    BigInt(rfq.amount_in),
      amountOut:   BigInt(amountOut),
      deadline:    calculateDeadline(QUOTE_VALIDITY_SEC),
      nonce:       generateNonce(),
      extraData:   '0x',
    };

    const signed = await signMMQuote(quoteParams, domain, signer);

    // 5. Send the response
    wsClient.sendRFQResponse({
      request_id: rfq.request_id,
      amount_out: amountOut,
      signature:  signed.signature,
      expiry:     quoteParams.deadline,
    });

    console.log(`  Quoted: ${fromWei(amountOut, 18)} (deadline: ${quoteParams.deadline})`);
  } catch (err) {
    console.error(`Error handling RFQ ${rfq.request_id}:`, err);
  }
});
```

## Step 5: Implement Risk Controls

```typescript
// Inventory tracking (simplified)
const inventory = new Map<string, bigint>();

function hasInventory(tokenOut: string, amountNeeded: string): boolean {
  const current = inventory.get(normalizeAddress(tokenOut)) ?? BigInt(0);
  // Check if we have enough or if we are within risk limits
  return current >= BigInt(amountNeeded) * BigInt(80) / BigInt(100); // 80% threshold
}

function shouldQuote(rfq: { token_in: string; token_out: string; chain_id: number }): boolean {
  // Only quote on our supported chain
  if (rfq.chain_id !== CHAIN_ID) return false;

  // Only quote pairs we support (add your pair whitelist here)
  const supportedPairs = new Set([
    '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
    '0x55d398326f99059fF775485246999027B3197955', // USDT
  ]);

  return supportedPairs.has(normalizeAddress(rfq.token_in))
      && supportedPairs.has(normalizeAddress(rfq.token_out));
}

// Circuit breaker: pause quoting after N consecutive errors
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;

function onError() {
  consecutiveErrors++;
  if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    console.error('Circuit breaker triggered. Pausing market making.');
    // Implement pause logic
  }
}

function onSuccess() {
  consecutiveErrors = 0;
}
```

## Step 6: Monitor Depth (Optional)

Subscribe to depth updates to inform your pricing:

```typescript
wsClient.on('depth', (update) => {
  // update.pair       -- e.g. "BNB/USDT"
  // update.bids       -- [[price, quantity], ...]
  // update.asks       -- [[price, quantity], ...]
  // Use this to adjust your spread or inventory model
  updatePricingModel(update);
});

// Subscribe to pairs you're making markets on
wsClient.subscribe('BNB/USDT');
```

## Step 7: Connect and Run

```typescript
wsClient.on('connected', () => {
  console.log('Connected to Deluthium WebSocket');
});

wsClient.on('disconnected', ({ code, reason }) => {
  console.log(`Disconnected: ${code} ${reason} (auto-reconnecting...)`);
});

wsClient.on('error', (err) => {
  console.error('WebSocket error:', err.message);
  onError();
});

// Connect and start receiving RFQ requests
await wsClient.connect();
console.log(`Market maker running on ${getChainConfig(CHAIN_ID).name}`);
console.log(`Signer: ${signerAddress}`);
console.log(`RFQ Manager: ${rfqManager}`);
console.log(`Spread: ${BID_SPREAD_BPS}bps bid / ${ASK_SPREAD_BPS}bps ask`);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await wsClient.disconnect();
  process.exit(0);
});
```

## Complete Example

See [examples/custom-mm](../../examples/custom-mm/) for a working example.

## Key Considerations for Production

1. **Key management**: Use `KmsSigner` (AWS KMS) instead of `PrivateKeySigner` in production
2. **Inventory management**: Track on-chain balances and pending fills
3. **Pricing model**: Use external price feeds, volatility, and order flow to set spreads
4. **Nonce management**: `generateNonce()` uses crypto-random values; never reuse
5. **Deadline strategy**: Shorter deadlines (60-120s) reduce stale quote risk
6. **Monitoring**: Log all quotes, fills, and errors for post-trade analysis
7. **Gas management**: Ensure your wallet has sufficient gas for settlements
8. **Multi-pair**: Run parallel pricing for multiple token pairs

## Further Reading

- Full API reference: [AGENTS.md](../../AGENTS.md)
- Trading quick start: [trading-quick-start skill](../trading-quick-start/SKILL.md)
- Multi-protocol integration: [multi-protocol skill](../multi-protocol-integration/SKILL.md)
