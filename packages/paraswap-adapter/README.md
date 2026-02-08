# @deluthium/paraswap-adapter

Register Deluthium as a liquidity source on the [Paraswap](https://paraswap.io) aggregator. This adapter publishes indicative rates from Deluthium's RFQ API to Paraswap's routing engine and executes swaps through the Augustus Swapper contract.

## Architecture

```
Paraswap Routing Engine
        |
        v
  RateProvider  ----> Deluthium REST API (indicative quotes)
        |
        v
    Executor    ----> Deluthium REST API (firm quotes)
        |                    |
        v                    v
  Augustus Swapper    DeluthiumParaswapPool (on-chain)
                             |
                             v
                      Deluthium RFQ Manager (settlement)
```

**Components:**

- **`ParaswapAdapter`** -- Main entry point. Composes the rate provider and executor, manages lifecycle, emits events.
- **`RateProvider`** -- Periodically fetches indicative quotes from Deluthium and caches them. When Paraswap queries rates, cached quotes are returned instantly.
- **`Executor`** -- Builds swap transactions through Augustus Swapper by obtaining firm quotes from Deluthium and encoding the appropriate calldata.
- **`DeluthiumParaswapPool.sol`** -- On-chain pool adapter contract that Augustus calls to settle swaps through Deluthium's RFQ Manager.

## Installation

```bash
npm install @deluthium/paraswap-adapter @deluthium/sdk ethers
```

## Quick Start

```typescript
import { ParaswapAdapter } from '@deluthium/paraswap-adapter';
import { PrivateKeySigner, ChainId } from '@deluthium/sdk';

const adapter = new ParaswapAdapter({
  deluthium: {
    auth: process.env.DELUTHIUM_JWT!,
    chainId: ChainId.BSC,
  },
  signer: new PrivateKeySigner(process.env.PRIVATE_KEY!),
  poolAdapterAddress: '0xYourDeployedPoolAdapter',
  rateRefreshIntervalMs: 5000,
  maxSlippageBps: 50,
});

// Subscribe to events
adapter.on('rate:updated', (event) => {
  console.log(`Rate updated: ${event.pair} = ${event.rate}`);
});

adapter.on('swap:executed', (event) => {
  console.log(`Swap executed: ${event.txHash}`);
});

// Start rate publishing
await adapter.start();
console.log(`Active rates: ${adapter.activeCacheSize}`);
```

## Querying Rates

Once the adapter is running, you can query cached rates:

```typescript
const rate = adapter.getRate({
  srcToken: { address: '0xTokenA', decimals: 18, symbol: 'TOKA' },
  destToken: { address: '0xTokenB', decimals: 6, symbol: 'TOKB' },
  srcAmount: '1000000000000000000', // 1 TOKA in wei
  chainId: 56,
  side: 'SELL',
});

if (rate) {
  console.log(`Can swap ${rate.srcAmount} -> ${rate.destAmount}`);
  console.log(`Pool: ${rate.poolId}`);
}
```

## Building Swap Transactions

```typescript
import { applySlippage, calculateDeadline } from '@deluthium/sdk';

// Build a transaction (does not submit)
const tx = await adapter.buildSwapTransaction({
  srcToken: '0xTokenA',
  destToken: '0xTokenB',
  srcAmount: '1000000000000000000',
  destAmount: '2000000000', // expected output from getRate()
  minDestAmount: applySlippage('2000000000', 0.5), // 0.5% slippage
  sender: '0xYourAddress',
  receiver: '0xYourAddress',
  chainId: 56,
  deadline: calculateDeadline(300), // 5 minutes
});

console.log(`To: ${tx.to}`);
console.log(`Value: ${tx.value}`);
console.log(`Gas: ${tx.gasLimit}`);
// Sign and submit `tx` with your wallet
```

## Executing Swaps

For convenience, you can build and execute in one call:

```typescript
const txHash = await adapter.executeSwap(
  {
    srcToken: '0xTokenA',
    destToken: '0xTokenB',
    srcAmount: '1000000000000000000',
    destAmount: '2000000000',
    minDestAmount: '1990000000',
    sender: '0xYourAddress',
    receiver: '0xYourAddress',
    chainId: 56,
    deadline: calculateDeadline(300),
  },
  'https://bsc-dataseed.binance.org',
);

console.log(`Transaction: ${txHash}`);
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `deluthium` | `DeluthiumClientConfig` | required | SDK client config (auth, chainId, etc.) |
| `signer` | `ISigner` | required | Signer for on-chain transactions |
| `chainId` | `number` | from deluthium config | Chain ID to operate on |
| `augustusAddress` | `string` | auto-resolved | Augustus Swapper contract address |
| `poolAdapterAddress` | `string` | - | Deployed DeluthiumParaswapPool address |
| `rateRefreshIntervalMs` | `number` | `5000` | How often to refresh rates (ms) |
| `maxSlippageBps` | `number` | `50` | Max slippage tolerance (basis points) |
| `rateMarkupBps` | `number` | `5` | Rate markup on indicative quotes (bps) |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `rate:updated` | `RateUpdateEvent` | A trading pair rate was refreshed |
| `rate:error` | `{ error, timestamp }` | Rate fetch failed for a pair |
| `swap:executed` | `SwapExecutedEvent` | A swap was successfully executed |
| `swap:error` | `{ error, request, timestamp }` | A swap execution failed |
| `pool:registered` | `PoolRegistrationStatus` | Pool registered with Augustus |
| `pool:deregistered` | `PoolRegistrationStatus` | Pool deregistered |

## Smart Contract

The `contracts/DeluthiumParaswapPool.sol` contract must be deployed on the target chain and registered with Paraswap's Augustus Router. It:

- Accepts `swap()` calls only from the Augustus Swapper
- Pulls input tokens, approves the Deluthium RFQ Manager, and settles the trade
- Verifies minimum output amounts and transfers results to the beneficiary
- Includes admin functions for pausing, ownership transfer, and emergency withdrawals

### Deployment

```bash
# Using Hardhat or Foundry
forge create contracts/DeluthiumParaswapPool.sol:DeluthiumParaswapPool \
  --constructor-args $AUGUSTUS_ADDRESS $RFQ_MANAGER_ADDRESS $WRAPPED_NATIVE_ADDRESS \
  --rpc-url $RPC_URL \
  --private-key $DEPLOYER_KEY
```

## Supported Chains

| Chain | Chain ID | Augustus Address |
|-------|----------|-----------------|
| Ethereum | 1 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` |
| BNB Chain | 56 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` |
| Polygon | 137 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` |
| Arbitrum | 42161 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` |
| Optimism | 10 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` |
| Avalanche | 43114 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` |
| Base | 8453 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` |

## License

Apache-2.0
