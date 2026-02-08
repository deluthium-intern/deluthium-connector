/**
 * dYdX Arbitrage Example
 *
 * Cross-venue arbitrage between dYdX v4 perp order book and Deluthium RFQ.
 * Monitors price differences and detects arbitrage opportunities.
 */

import 'dotenv/config';
import { DydxAdapter } from '@deluthium/dydx-adapter';
import { PrivateKeySigner, ChainId } from '@deluthium/sdk';

async function main() {
  const signer = new PrivateKeySigner(process.env.PRIVATE_KEY!);

  console.log('dYdX Arbitrage Scanner starting...');
  console.log(`Network: ${process.env.DYDX_NETWORK ?? 'testnet'}\n`);

  // Create the adapter
  const adapter = new DydxAdapter({
    deluthium: {
      auth: process.env.DELUTHIUM_API_KEY!,
      chainId: ChainId.BSC,
    },
    signer,
    network: (process.env.DYDX_NETWORK as 'mainnet' | 'testnet') ?? 'testnet',
  });

  // Initialize
  await adapter.initialize(process.env.DYDX_ADDRESS);
  console.log('Adapter initialized.');

  // Subscribe to market data
  adapter.on('orderbook:update', (book) => {
    const bestBid = book.bids[0];
    const bestAsk = book.asks[0];
    if (bestBid && bestAsk) {
      console.log(`${book.ticker}: bid=${bestBid.price} ask=${bestAsk.price}`);
    }
  });

  adapter.on('arbitrage:detected', (opp) => {
    console.log('\n*** ARBITRAGE DETECTED ***');
    console.log(`  Pair: ${opp.ticker}`);
    console.log(`  dYdX price: ${opp.dydxPrice}`);
    console.log(`  Deluthium price: ${opp.deluthiumPrice}`);
    console.log(`  Spread: ${opp.spreadBps} bps`);
    console.log(`  Direction: ${opp.direction}`);
    console.log('');
  });

  // Add arbitrage pairs to monitor
  adapter.addArbitragePair({
    dydxTicker: 'BTC-USD',
    deluthiumTokenIn: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',  // BTCB on BSC
    deluthiumTokenOut: '0x55d398326f99059fF775485246999027B3197955', // USDT on BSC
    chainId: 56,
    minSpreadBps: 15,
  });

  adapter.addArbitragePair({
    dydxTicker: 'ETH-USD',
    deluthiumTokenIn: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',  // ETH on BSC
    deluthiumTokenOut: '0x55d398326f99059fF775485246999027B3197955', // USDT on BSC
    chainId: 56,
    minSpreadBps: 15,
  });

  // Start market data + arbitrage scanner
  await adapter.connectMarketData();
  adapter.subscribeMarket('BTC-USD');
  adapter.subscribeMarket('ETH-USD');
  await adapter.startArbitrage();

  console.log('Monitoring BTC-USD and ETH-USD for arbitrage opportunities...\n');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await adapter.shutdown();
    process.exit(0);
  });
}

main().catch(console.error);
