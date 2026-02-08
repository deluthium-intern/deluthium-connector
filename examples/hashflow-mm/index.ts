/**
 * Hashflow Market Maker Example
 *
 * Act as a Hashflow market maker that sources quotes from Deluthium.
 * Connects to Hashflow WebSocket, publishes price levels, and responds
 * to incoming RFQ requests.
 */

import 'dotenv/config';
import { HashflowAdapter, DEFAULT_HASHFLOW_WS_URL } from '@deluthium/hashflow-adapter';
import { PrivateKeySigner, ChainId } from '@deluthium/sdk';

async function main() {
  const signer = new PrivateKeySigner(process.env.PRIVATE_KEY!);
  const mmAddress = await signer.getAddress();

  console.log(`Hashflow MM starting (address: ${mmAddress})`);

  // Create the adapter
  const adapter = new HashflowAdapter({
    deluthiumConfig: {
      auth: process.env.DELUTHIUM_API_KEY!,
      chainId: ChainId.BSC,
    },
    signer,
    marketMaker: process.env.HASHFLOW_MM_NAME ?? 'deluthium-mm',
    hashflowWsUrl: process.env.HASHFLOW_WS_URL ?? DEFAULT_HASHFLOW_WS_URL,
    chains: [56, 1],       // BSC + Ethereum
    pairs: ['WBNB/USDT', 'ETH/USDC'],
    priceRefreshIntervalMs: 5000,
    spreadBps: 10,
    numLevels: 5,
    levelTtlSeconds: 30,
    maxQuoteExpirySec: 60,
    autoReconnect: true,
  });

  // Register token mappings
  adapter.registerPairTokens('WBNB/USDT', 56, {
    baseToken: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    quoteToken: '0x55d398326f99059fF775485246999027B3197955',
    baseDecimals: 18,
    quoteDecimals: 18,
  });

  // Event handlers
  adapter.on('connected', () => {
    console.log('Connected to Hashflow WebSocket');
  });

  adapter.on('rfqReceived', (request) => {
    console.log(`RFQ received: ${request.rfqId}`);
    console.log(`  Pair: ${request.baseToken}/${request.quoteToken}`);
    console.log(`  Amount: ${request.baseTokenAmount || request.quoteTokenAmount}`);
  });

  adapter.on('rfqResponded', (response) => {
    console.log(`  Responded: ${response.quoteData?.baseTokenAmount} -> ${response.quoteData?.quoteTokenAmount}`);
  });

  adapter.on('rfqDeclined', (rfqId, reason) => {
    console.log(`  Declined ${rfqId}: ${reason}`);
  });

  adapter.on('error', (err) => {
    console.error('Error:', err.message);
  });

  // Start
  console.log('\nConnecting to Hashflow...');
  await adapter.start();
  console.log('Hashflow MM running. Publishing prices and handling RFQs.\n');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await adapter.stop();
    process.exit(0);
  });
}

main().catch(console.error);
