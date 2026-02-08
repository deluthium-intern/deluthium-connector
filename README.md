# Deluthium Connector

Unified connector monorepo for integrating Deluthium's RFQ liquidity across crypto market-making infrastructure.

## Quick Start

```bash
# Interactive project setup
npx @deluthium/cli init

# Or install directly
npm install @deluthium/sdk
```

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [`@deluthium/sdk`](packages/sdk) | Core SDK -- API client, signer, chain config, types | Active |
| [`@deluthium/ccxt-adapter`](packages/ccxt-adapter) | CCXT exchange adapter (TS + Python) | Active |
| [`deluthium-hummingbot`](packages/hummingbot-connector) | Hummingbot auto-injected connector | Active |
| [`@deluthium/0x-adapter`](packages/0x-adapter) | 0x Protocol v4 RFQ adapter | Active |
| [`@deluthium/1inch-adapter`](packages/1inch-adapter) | 1inch Limit Order adapter + Oracle | Active |
| [`@deluthium/uniswapx-adapter`](packages/uniswapx-adapter) | UniswapX Dutch auction filler | Active |
| [`@deluthium/hashflow-adapter`](packages/hashflow-adapter) | Hashflow WebSocket RFQ bridge | Active |
| [`@deluthium/paraswap-adapter`](packages/paraswap-adapter) | Paraswap aggregator liquidity source | Active |
| [`@deluthium/dydx-adapter`](packages/dydx-adapter) | dYdX v4 order book bridge | Active |
| [`@deluthium/binance-dex-adapter`](packages/binance-dex-adapter) | PancakeSwap / BNB Chain split-router | Active |
| [`@deluthium/institutional-adapter`](packages/institutional-adapter) | FIX gateway + OTC API | Active |
| [`@deluthium/cli`](packages/cli) | Interactive setup CLI | Active |

## Examples

| Example | Description |
|---------|-------------|
| [`ccxt-basic`](examples/ccxt-basic) | CCXT exchange interface usage |
| [`hummingbot-strategy`](examples/hummingbot-strategy) | Hummingbot strategy with Deluthium |
| [`0x-rfq-maker`](examples/0x-rfq-maker) | 0x RFQ maker with Deluthium backend |
| [`1inch-limit-order`](examples/1inch-limit-order) | 1inch limit orders via Deluthium |
| [`uniswapx-filler`](examples/uniswapx-filler) | Fill UniswapX orders via Deluthium |
| [`hashflow-mm`](examples/hashflow-mm) | Hashflow MM with Deluthium liquidity |
| [`paraswap-pool`](examples/paraswap-pool) | Register as Paraswap liquidity source |
| [`dydx-arbitrage`](examples/dydx-arbitrage) | Cross-venue arbitrage dYdX vs Deluthium |
| [`pancakeswap-router`](examples/pancakeswap-router) | Split-route PancakeSwap + Deluthium |
| [`institutional-fix`](examples/institutional-fix) | FIX protocol quickstart |
| [`custom-mm`](examples/custom-mm) | Build a custom MM with SDK only |

## Development

### Prerequisites

- Node.js >= 18
- pnpm >= 9

### Setup

```bash
pnpm install        # Install dependencies
pnpm build          # Build all packages
pnpm test           # Run tests
pnpm typecheck      # Type-check
pnpm format         # Format code
```

### Monorepo Structure

```
deluthium-connector/
  packages/
    sdk/                   # @deluthium/sdk -- core foundation
    ccxt-adapter/          # CCXT exchange wrapper
    hummingbot-connector/  # Hummingbot connector (Python)
    0x-adapter/            # 0x Protocol adapter
    1inch-adapter/         # 1inch adapter + Solidity oracle
    uniswapx-adapter/      # UniswapX filler
    hashflow-adapter/      # Hashflow RFQ bridge
    paraswap-adapter/      # Paraswap aggregator
    dydx-adapter/          # dYdX order book bridge
    binance-dex-adapter/   # PancakeSwap / BNB DEX
    institutional-adapter/ # FIX + OTC
    cli/                   # Interactive CLI tool
  examples/                # Usage examples for every adapter
  docker/                  # Docker images + docker-compose
  .github/workflows/       # CI/CD (lint, test, build, publish)
```

### Docker

```bash
# Run a specific adapter
docker compose -f docker/docker-compose.yml up uniswapx-filler

# Build a specific adapter image
docker build -f docker/Dockerfile.adapter --build-arg ADAPTER=hashflow-adapter .
```

### CI/CD

- **CI** (`ci.yml`): Runs on every push/PR -- lint, typecheck, test (Node 18/20/22), build
- **Publish** (`publish.yml`): On `v*` tags -- publishes npm, PyPI, and Docker images to GHCR

```bash
git tag v0.2.0 && git push origin v0.2.0  # Triggers automated publish
```

## License

Apache-2.0
