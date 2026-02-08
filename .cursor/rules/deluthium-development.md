# Deluthium Connector Development Conventions

## Project Structure

This is a pnpm monorepo managed with Turbo. All packages live in `packages/`, examples in `examples/`.

## Language and Runtime

- **TypeScript** with strict mode enabled, target ES2022, module Node16 (ESM)
- **Python** for Hummingbot connector only (`packages/hummingbot-connector/`)
- **Node.js >= 18** required
- **pnpm >= 9** as the package manager

## Module System

All TypeScript packages use **ESM** (ECMAScript Modules):
- Use `.js` extensions in import paths (TypeScript resolves `.ts` to `.js`):
  ```typescript
  import { foo } from './utils/index.js';  // correct
  import { foo } from './utils/index';     // wrong -- missing .js
  ```
- `"type": "module"` is set in all package.json files
- Use `import`/`export`, never `require()`

## Import Patterns

The core SDK (`@deluthium/sdk`) provides sub-path exports for tree-shaking:

```typescript
// Prefer sub-path imports for smaller bundles:
import { DeluthiumRestClient } from '@deluthium/sdk/client';
import { PrivateKeySigner } from '@deluthium/sdk/signer';
import { getChainConfig, ChainId } from '@deluthium/sdk/chain';
import { toWei, fromWei } from '@deluthium/sdk/utils';
import { DeluthiumError, APIError } from '@deluthium/sdk/errors';
import type { FirmQuoteRequest, ISigner } from '@deluthium/sdk/types';

// Barrel import is also available but less optimal:
import { DeluthiumRestClient, PrivateKeySigner, ChainId } from '@deluthium/sdk';
```

## Dependencies

- **ethers v6** (`^6.13.0`) -- used for EIP-712 signing, address utilities
- **ws v8** (`^8.18.0`) -- WebSocket client for Node.js
- No other runtime dependencies in the core SDK

## Error Handling

Use the structured error hierarchy from `@deluthium/sdk/errors`:

```typescript
import {
  DeluthiumError,       // Base class
  ValidationError,      // Invalid input (throw before API call)
  APIError,             // HTTP / business logic error
  AuthenticationError,  // 401/403
  RateLimitError,       // 429 (has retryAfterMs)
  TimeoutError,         // Request timeout
  QuoteExpiredError,    // Quote past deadline
  WebSocketError,       // WS connection failure
  SigningError,         // EIP-712 signing failure
  ChainError,           // Unsupported chain
} from '@deluthium/sdk/errors';
```

Rules:
- Always throw specific error subclasses, never raw `Error`
- Include relevant context (field name, chain ID, HTTP status, etc.)
- Catch errors by type using `instanceof`

## API Response Pattern

All Deluthium API responses use this envelope:

```typescript
interface APIResponse<T> {
  code: number | string;  // 10000 = success
  message?: string;
  data?: T;
}
```

Always check `code === 10000` for success.

## Wei Handling

All token amounts are in wei (smallest unit). Use SDK utilities:

```typescript
import { toWei, fromWei } from '@deluthium/sdk/utils';

const wei = toWei('1.5', 18);       // '1500000000000000000'
const human = fromWei(wei, 18);     // '1.5'
```

Never use `parseFloat` or `Number` for wei values -- they lose precision.

## Chain Configuration

Use the chain registry from `@deluthium/sdk/chain`:

```typescript
import { getChainConfig, ChainId } from '@deluthium/sdk/chain';

const config = getChainConfig(ChainId.BSC);
// config.rfqManagerAddress -- contract address
// config.wrappedNativeToken -- WBNB/WETH address
```

Never hardcode chain IDs or contract addresses. Always use `ChainId` constants and `getChainConfig()`.

## EIP-712 Signing

Use `signMMQuote()` from the SDK. Never construct EIP-712 data manually:

```typescript
import { signMMQuote, buildMMQuoteDomain } from '@deluthium/sdk';
```

## Testing

- Use Node.js built-in test runner with `tsx` for TypeScript execution
- Run: `pnpm test`
- Tests live alongside source files or in `__tests__/` directories

## Formatting

- **Prettier** handles all formatting
- Run: `pnpm format`
- Config is in the root `.prettierrc` or `package.json`

## Build

- **Turbo** orchestrates builds across packages
- Run: `pnpm build` (builds all packages in dependency order)
- Output goes to `dist/` in each package
- TypeScript declarations (`.d.ts`) are generated with source maps

## Adding a New Adapter

1. Create `packages/your-adapter/` with `package.json`, `tsconfig.json`, `src/index.ts`
2. Add `@deluthium/sdk` as a dependency
3. Implement the adapter using SDK's REST/WS clients
4. Add an example in `examples/your-adapter/`
5. Add to `docker/docker-compose.yml`
6. Update the root README.md package table

## Common Patterns

### REST Client Usage

```typescript
const client = new DeluthiumRestClient({
  auth: 'token',
  chainId: ChainId.BSC,
});
const pairs = await client.getPairs();
const quote = await client.getIndicativeQuote({...});
const firm = await client.getFirmQuote({...});
```

### WebSocket Usage

```typescript
const ws = new DeluthiumWSClient({
  auth: 'token',
  chainId: ChainId.BSC,
  wsUrl: 'wss://ws.deluthium.ai',
});
ws.on('depth', (update) => { ... });
ws.on('rfq_request', (rfq) => { ... });
await ws.connect();
ws.subscribe('BNB/USDT');
```

### Signer Usage

```typescript
const signer = new PrivateKeySigner('0x...');
const domain = buildMMQuoteDomain(ChainId.BSC);
const signed = await signMMQuote(params, domain, signer);
```
