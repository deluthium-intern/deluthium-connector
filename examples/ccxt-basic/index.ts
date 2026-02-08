/**
 * CCXT Basic Example
 *
 * Demonstrates using Deluthium through the standard CCXT exchange interface.
 * Fetch markets, get a ticker, and create an order -- all via familiar CCXT methods.
 */

import 'dotenv/config';
import { DeluthiumExchange } from '@deluthium/ccxt-adapter';

async function main() {
  // Create a Deluthium exchange instance (CCXT-compatible)
  const exchange = new DeluthiumExchange({
    apiKey: process.env.DELUTHIUM_API_KEY!,
    chainId: 56, // BSC
  });

  // Fetch available markets
  console.log('Fetching markets...');
  const markets = await exchange.fetchMarkets();
  console.log(`Found ${markets.length} markets\n`);

  for (const market of markets.slice(0, 5)) {
    console.log(`  ${market.symbol} (${market.id})`);
  }

  // Fetch a ticker (indicative quote)
  if (markets.length > 0) {
    const symbol = markets[0].symbol;
    console.log(`\nFetching ticker for ${symbol}...`);

    const ticker = await exchange.fetchTicker(symbol);
    console.log(`  Bid: ${ticker.bid}`);
    console.log(`  Ask: ${ticker.ask}`);
    console.log(`  Last: ${ticker.last}`);
  }

  // Create a market order (firm quote + execution)
  // Uncomment to execute:
  // const order = await exchange.createOrder('WBNB/USDT', 'market', 'buy', 1.0);
  // console.log('Order:', order);
}

main().catch(console.error);
