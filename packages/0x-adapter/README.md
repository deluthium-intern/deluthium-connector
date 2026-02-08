# @deluthium/0x-adapter

Translation layer between [0x Protocol v4 RFQ](https://docs.0xprotocol.org/) and Deluthium DEX. Enables market makers already integrated with 0x to connect to Deluthium with minimal effort.

## Installation

```bash
npm install @deluthium/0x-adapter
# or
pnpm add @deluthium/0x-adapter
```

## Quick Start

```typescript
import {
  transform0xToDarkPool,
  signDarkPoolQuote,
  ZeroExToDarkPoolProxy,
} from '@deluthium/0x-adapter';
import { PrivateKeySigner } from '@deluthium/sdk';

// Option 1: Transform + Sign manually
const params = transform0xToDarkPool(zeroExOrder, 56);
const signer = new PrivateKeySigner(process.env.PRIVATE_KEY!);
const signed = await signDarkPoolQuote(params, signer, 56);

// Option 2: Use the high-level proxy
const proxy = new ZeroExToDarkPoolProxy({
  chainId: 56,
  jwtToken: process.env.JWT_TOKEN!,
});
const firmQuote = await proxy.submitOrder(zeroExOrder);
```

## Field Mapping

| 0x Field | Deluthium Field | Description |
|----------|-----------------|-------------|
| `makerToken` | `outputToken` | Token the MM provides |
| `takerToken` | `inputToken` | Token the user pays |
| `makerAmount` | `amountOut` | Output quantity (wei) |
| `takerAmount` | `amountIn` | Input quantity (wei) |
| `txOrigin` | `from` | User's sending address |
| `taker` | `to` | User's receiving address |
| `expiry` | `deadline` | Expiration (Unix seconds) |
| `salt` | `nonce` | Anti-replay nonce |

## Supported Chains

- BSC (56) — RFQ Manager: `0x94020Af3...`
- Base (8453) — RFQ Manager: `0x7648CE92...`
- Ethereum (1) — Coming soon

## License

Apache-2.0
