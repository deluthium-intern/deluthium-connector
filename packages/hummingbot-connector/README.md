# deluthium-hummingbot

Deluthium DEX-aggregator connector for [Hummingbot](https://hummingbot.org/).

## Quick start

```bash
pip install deluthium-hummingbot
deluthium-hummingbot --hummingbot-dir /path/to/hummingbot
```

The first command installs the Python package.
The second command auto-injects the Deluthium connector into an existing Hummingbot
installation by creating symlinks from the installed package into Hummingbot's
`connector/exchange/deluthium/` directory.

After injection, restart Hummingbot and the `deluthium` exchange will be available
for strategy configuration.

## Configuration

| Key              | Description                          | Default |
|------------------|--------------------------------------|---------|
| `api_key`        | Deluthium API key (required)         | —       |
| `chain_id`       | Target chain ID                      | `56`    |
| `wallet_address` | On-chain wallet address (optional)   | —       |

## Supported chains

| Chain ID | Network   |
|----------|-----------|
| 56       | BSC       |
| 8453     | Base      |
| 1        | Ethereum  |

## License

Apache-2.0
