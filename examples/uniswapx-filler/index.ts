/**
 * UniswapX Filler Example
 *
 * Fill UniswapX Dutch auction orders using Deluthium as the liquidity source.
 * The adapter polls for open orders, evaluates profitability, and optionally
 * auto-fills profitable ones.
 */

import 'dotenv/config';
import { UniswapXAdapter } from '@deluthium/uniswapx-adapter';
import { PrivateKeySigner, ChainId } from '@deluthium/sdk';

async function main() {
  const signer = new PrivateKeySigner(process.env.PRIVATE_KEY!);
  const fillerAddress = await signer.getAddress();

  console.log(`UniswapX Filler starting (address: ${fillerAddress})`);
  console.log(`Chain: Ethereum (${ChainId.ETHEREUM})\n`);

  // Create the adapter
  const adapter = new UniswapXAdapter({
    deluthiumConfig: {
      auth: process.env.DELUTHIUM_API_KEY!,
      chainId: ChainId.ETHEREUM,
    },
    signer,
    chainId: ChainId.ETHEREUM,
    rpcUrl: process.env.RPC_URL ?? 'https://eth.llamarpc.com',
    minProfitBps: Number(process.env.MIN_PROFIT_BPS ?? 25),
    autoFill: false, // Set to true for auto-execution
    pollIntervalMs: 2000,
  });

  // Event handlers
  adapter.on('orderDiscovered', (order) => {
    console.log(`New order: ${order.orderHash.slice(0, 16)}...`);
    console.log(`  Type: ${order.orderType}`);
    console.log(`  Input: ${order.input.token.slice(0, 10)}... (${order.input.startAmount})`);
  });

  adapter.on('orderEvaluated', (evaluation) => {
    const status = evaluation.profitable ? 'PROFITABLE' : 'SKIP';
    console.log(`  Evaluated: ${status}`);
    if (evaluation.profitable) {
      console.log(`  Net profit: ${evaluation.netProfitWei} wei (${evaluation.profitBps} bps)`);
    }
  });

  adapter.on('fillConfirmed', (result) => {
    console.log(`  FILLED: tx=${result.txHash}`);
  });

  adapter.on('error', (err) => {
    console.error('Error:', err.message);
  });

  // Start polling
  console.log('Starting order polling...\n');
  await adapter.start();

  // Run for 60 seconds then stop
  setTimeout(() => {
    adapter.stop();
    console.log('\nFiller stopped.');
  }, 60_000);
}

main().catch(console.error);
