/**
 * Paraswap Pool Example
 *
 * Register Deluthium as a liquidity source on Paraswap.
 * The adapter publishes rates and builds swap transactions through Augustus.
 */

import 'dotenv/config';
import { ParaswapAdapter } from '@deluthium/paraswap-adapter';
import { PrivateKeySigner, ChainId } from '@deluthium/sdk';

async function main() {
  const signer = new PrivateKeySigner(process.env.PRIVATE_KEY!);
  const address = await signer.getAddress();

  console.log(`Paraswap Pool adapter starting (address: ${address})`);
  console.log(`Chain: BSC (${ChainId.BSC})\n`);

  // Create the adapter
  const adapter = new ParaswapAdapter({
    deluthium: {
      auth: process.env.DELUTHIUM_API_KEY!,
      chainId: ChainId.BSC,
    },
    signer,
    poolAdapterAddress: process.env.POOL_ADAPTER_ADDRESS,
    rateRefreshIntervalMs: 3000,
    maxSlippageBps: 30,
  });

  // Event listeners
  adapter.on('rate:updated', (event) => {
    console.log(`Rate updated: ${event.pair} = ${event.rate}`);
  });

  adapter.on('swap:executed', (event) => {
    console.log(`Swap executed: ${event.txHash}`);
  });

  // Start publishing rates
  console.log('Starting rate publisher...');
  await adapter.start();
  console.log(`Active rates: ${adapter.activeCacheSize}`);

  // Query a rate
  const rate = adapter.getRate({
    srcToken: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
    destToken: '0x55d398326f99059fF775485246999027B3197955', // USDT
    srcAmount: '1000000000000000000', // 1 WBNB
  });

  if (rate) {
    console.log(`\nRate for 1 WBNB -> USDT: ${rate.destAmount}`);
  }

  // Show registration status
  const status = adapter.getRegistrationStatus();
  console.log('\nRegistration status:', JSON.stringify(status, null, 2));

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    adapter.stop();
    process.exit(0);
  });
}

main().catch(console.error);
