# @deluthium/institutional-adapter

Institutional MM adapter for Deluthium -- FIX protocol gateway, unified OTC API, and aggregator bridge for connecting traditional finance market makers (Wintermute, GSR, Jump Trading, Cumberland, B2C2) to Deluthium's RFQ liquidity.

## Architecture

The adapter provides three integration layers:

### Layer 1: Aggregator Bridge (Passive)
Institutional MMs already route through 0x Protocol and 1inch. With the `@deluthium/0x-adapter` and `@deluthium/1inch-adapter` deployed, Deluthium liquidity is automatically accessible to any institutional MM using these aggregators. This layer provides verification tools to confirm the integration path is operational.

### Layer 2: FIX Protocol Gateway (Active)
Industry-standard FIX 4.4 TCP acceptor for direct OTC connectivity. Translates FIX messages to Deluthium RFQ calls:
- **QuoteRequest (R)** → Deluthium indicativeQuote → **Quote (S)**
- **NewOrderSingle (D)** with QuoteID → Deluthium firmQuote → **ExecutionReport (8)**

### Layer 3: Unified OTC API (Active)
REST + WebSocket API with a multi-step RFQ workflow:
```
Request → Quote → Accept/Reject → Execute → Settle
```
Includes full audit trail, counterparty management, and compliance logging.

## Installation

```bash
pnpm add @deluthium/institutional-adapter
```

## Quick Start

```typescript
import { InstitutionalAdapter } from '@deluthium/institutional-adapter';
import { PrivateKeySigner } from '@deluthium/sdk';

const adapter = new InstitutionalAdapter({
  deluthiumConfig: {
    auth: 'your-jwt-token',
    chainId: 56, // BSC
  },
  signer: new PrivateKeySigner(process.env.PRIVATE_KEY!),
  defaultChainId: 56,
  counterparties: {
    wintermute: {
      id: 'wintermute',
      name: 'Wintermute',
      type: 'market-maker',
      fixCompID: 'WINTERMUTE',
      apiKey: 'wm-api-key-xxx',
      defaultSettlement: 'on-chain',
      active: true,
    },
    gsr: {
      id: 'gsr',
      name: 'GSR',
      type: 'market-maker',
      apiKey: 'gsr-api-key-xxx',
      defaultSettlement: 'on-chain',
      active: true,
    },
  },
  tokenMappings: [
    {
      symbol: 'BNB',
      name: 'BNB',
      decimals: 18,
      addresses: { 56: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
    },
    {
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 18,
      addresses: { 56: '0x55d398326f99059fF775485246999027B3197955' },
    },
  ],
  // FIX gateway (optional)
  fixConfig: {
    port: 9876,
    sessions: {
      WINTERMUTE: {
        fixVersion: 'FIX.4.4',
        senderCompID: 'DELUTHIUM',
        targetCompID: 'WINTERMUTE',
        heartbeatIntervalSec: 30,
      },
    },
  },
  // OTC REST API (optional)
  otcApiConfig: {
    port: 8080,
  },
});

// Start all services
await adapter.start();

// Listen for events
adapter.on('quoteGenerated', (quote) => {
  console.log('Quote:', quote.quoteId, quote.price);
});

adapter.on('tradeExecuted', (trade) => {
  console.log('Trade:', trade.tradeId, trade.price, trade.quantity);
});
```

## OTC REST API

### Submit RFQ
```bash
curl -X POST http://localhost:8080/api/v1/rfq \
  -H "Content-Type: application/json" \
  -H "X-API-Key: wm-api-key-xxx" \
  -d '{
    "baseToken": "BNB",
    "quoteToken": "USDT",
    "side": "buy",
    "quantity": "1000000000000000000",
    "settlement": "on-chain"
  }'
```

### Accept Quote
```bash
curl -X POST http://localhost:8080/api/v1/quote/QTE-xxx/accept \
  -H "X-API-Key: wm-api-key-xxx"
```

### Reject Quote
```bash
curl -X POST http://localhost:8080/api/v1/quote/QTE-xxx/reject \
  -H "X-API-Key: wm-api-key-xxx" \
  -d '{"reason": "Price too high"}'
```

### List Active Quotes
```bash
curl http://localhost:8080/api/v1/quotes -H "X-API-Key: wm-api-key-xxx"
```

### Trade History
```bash
curl http://localhost:8080/api/v1/trades?limit=50 -H "X-API-Key: wm-api-key-xxx"
```

### Health Check
```bash
curl http://localhost:8080/api/v1/health
```

## Aggregator Bridge Verification

```typescript
// Verify institutional MMs can reach Deluthium via 0x
const zeroXResult = await adapter.verify0xPath(56);
console.log('0x operational:', zeroXResult.operational);

// Verify via 1inch
const oneInchResult = await adapter.verify1inchPath(56);
console.log('1inch operational:', oneInchResult.operational);

// Verify all paths at once
const allResults = await adapter.verifyAllPaths(56);
```

## FIX Protocol

The FIX gateway supports the following message flows:

| Message Type | Direction | Description |
|---|---|---|
| Logon (A) | Bi-directional | Session establishment |
| Logout (5) | Bi-directional | Session termination |
| Heartbeat (0) | Bi-directional | Keep-alive |
| QuoteRequest (R) | Incoming | Counterparty requests a quote |
| Quote (S) | Outgoing | Deluthium responds with a quote |
| NewOrderSingle (D) | Incoming | Counterparty executes a quoted order |
| ExecutionReport (8) | Outgoing | Trade confirmation or rejection |
| SecurityListRequest (x) | Incoming | Counterparty queries available pairs |
| SecurityList (y) | Outgoing | List of available trading pairs |

## Institutional MM Integration Matrix

| MM Firm | Primary Channel | Secondary Channel |
|---|---|---|
| Wintermute | FIX API | 0x / 1inch aggregator |
| GSR | FIX API + Custom WS | 0x / 1inch aggregator |
| Jump Trading | Custom API | 0x / 1inch aggregator |
| Cumberland | FIX API (OTC) | Direct API |
| B2C2 | FIX API (OTC) | Direct API |

## Audit Trail

All activity is logged for compliance:

```typescript
const audit = adapter.getAuditTrail();

// Query by counterparty
const history = await audit.getCounterpartyHistory('wintermute');

// Query by trade
const tradeLog = await audit.getTradeHistory('TRD-xxx');

// Custom query
const entries = await audit.query({
  eventTypes: ['rfq.received', 'trade.executed'],
  startTime: '2026-01-01T00:00:00Z',
  limit: 100,
});
```

## Dependencies

- `@deluthium/sdk` -- Core SDK (API client, signer, chain config)
- `@deluthium/0x-adapter` -- 0x Protocol integration (Layer 1)
- `@deluthium/1inch-adapter` -- 1inch Protocol integration (Layer 1)

## License

Apache-2.0
