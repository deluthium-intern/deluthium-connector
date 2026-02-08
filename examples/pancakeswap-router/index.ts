/**
 * PancakeSwap Router Example
 *
 * Split-route between Deluthium RFQ and PancakeSwap AMM for optimal execution.
 * Compares prices and computes the best allocation across both venues.
 */

import 'dotenv/config';
import { BinanceDexAdapter } from '@deluthium/binance-dex-adapter';
import { PrivateKeySigner, toWei } from '@deluthium/sdk';

// Well-known BSC tokens
const TOKENS = {
  WBNB: {
    address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    symbol: 'WBNB',
    decimals: 18,
  },
  USDT: {
    address: '0x55d398326f99059fF775485246999027B3197955',
    symbol: 'USDT',
    decimals: 18,
  },
  USDC: {
    address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    symbol: 'USDC',
    decimals: 18,
  },
};

async function main() {
  const signer = new PrivateKeySigner(process.env.PRIVATE_KEY!);

  console.log('PancakeSwap + Deluthium Split Router');
  console.log('Chain: BSC\n');

  // Create the adapter
  const adapter = new BinanceDexAdapter({
    deluthium: {
      auth: process.env.DELUTHIUM_API_KEY!,
      chainId: 56,
    },
    signer,
    chainId: 56,
    rpcUrl: process.env.BSC_RPC_URL,
    useV2Pools: true,
    useV3Pools: true,
    maxSlippageBps: 50,
  });

  await adapter.initialize();
  console.log('Adapter initialized.\n');

  // Compare prices
  const amount = toWei('10', 18); // 10 WBNB
  console.log(`Comparing prices for 10 WBNB -> USDT...\n`);

  const comparison = await adapter.comparePrice(TOKENS.WBNB, TOKENS.USDT, amount);

  console.log('Price Comparison:');
  console.log(`  Deluthium RFQ: ${comparison.deluthiumQuote?.amountOut ?? 'N/A'}`);
  console.log(`  PancakeSwap:   ${comparison.pancakeSwapQuote?.amountOut ?? 'N/A'}`);
  console.log(`  Best venue:    ${comparison.bestQuote.source}`);
  console.log(`  Spread:        ${comparison.spreadBps} bps`);

  // Compute optimal split route
  console.log('\nComputing optimal split route...');
  const route = await adapter.getOptimalRoute(TOKENS.WBNB, TOKENS.USDT, amount);

  console.log(`  Deluthium allocation: ${route.deluthiumPct}%`);
  console.log(`  PancakeSwap allocation: ${route.pancakeSwapPct}%`);
  console.log(`  Expected output: ${route.expectedOutput} USDT`);
  console.log(`  Improvement vs single venue: ${route.improvementBps} bps`);

  // Start continuous price monitoring
  console.log('\nStarting price monitoring...');
  adapter.on('price:updated', (data) => {
    console.log(`  [${new Date().toISOString()}] Best: ${data.bestQuote.source} (spread: ${data.spreadBps} bps)`);
  });

  adapter.startPriceMonitoring(TOKENS.WBNB, TOKENS.USDT, amount);

  // Run for 30 seconds
  setTimeout(() => {
    adapter.stopPriceMonitoring();
    adapter.destroy();
    console.log('\nDone.');
  }, 30_000);
}

main().catch(console.error);
