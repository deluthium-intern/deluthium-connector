/**
 * Institutional FIX Protocol Example
 *
 * Run a FIX protocol gateway + OTC API that connects institutional MMs
 * (Wintermute, GSR, Jump) to Deluthium liquidity.
 */

import 'dotenv/config';
import { InstitutionalAdapter } from '@deluthium/institutional-adapter';
import { PrivateKeySigner, ChainId } from '@deluthium/sdk';

async function main() {
  const signer = new PrivateKeySigner(process.env.PRIVATE_KEY!);

  console.log('Institutional Adapter starting...');
  console.log(`Chain: BSC (${ChainId.BSC})\n`);

  // Define counterparties
  const counterparties = {
    wintermute: {
      id: 'wintermute',
      name: 'Wintermute',
      type: 'market-maker' as const,
      apiKey: process.env.WINTERMUTE_API_KEY ?? 'wm-key',
      defaultSettlement: 'on-chain' as const,
      active: true,
    },
    gsr: {
      id: 'gsr',
      name: 'GSR',
      type: 'market-maker' as const,
      apiKey: process.env.GSR_API_KEY ?? 'gsr-key',
      defaultSettlement: 'on-chain' as const,
      active: true,
    },
  };

  // Token mappings (FIX symbol -> on-chain address)
  const tokenMappings = [
    {
      symbol: 'BNB',
      address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      decimals: 18,
      chainId: 56,
    },
    {
      symbol: 'USDT',
      address: '0x55d398326f99059fF775485246999027B3197955',
      decimals: 18,
      chainId: 56,
    },
  ];

  // Create the adapter
  const adapter = new InstitutionalAdapter({
    deluthiumConfig: {
      auth: process.env.DELUTHIUM_API_KEY!,
      chainId: ChainId.BSC,
    },
    signer,
    counterparties,
    tokenMappings,
    defaultChainId: 56,
    defaultQuoteValiditySec: 30,
    defaultFeeRateBps: 5,

    // FIX Gateway configuration
    fixConfig: {
      port: Number(process.env.FIX_PORT ?? 9878),
      host: '0.0.0.0',
      sessions: {
        WINTERMUTE: {
          senderCompId: 'DELUTHIUM',
          targetCompId: 'WINTERMUTE',
          fixVersion: '4.4',
          heartbeatIntervalSec: 30,
        },
      },
    },

    // OTC API configuration
    otcApiConfig: {
      port: Number(process.env.OTC_PORT ?? 3000),
      host: '0.0.0.0',
    },
  });

  // Event handlers
  adapter.on('fixSessionConnected', (sessionId) => {
    console.log(`FIX session connected: ${sessionId}`);
  });

  adapter.on('quoteGenerated', (quote) => {
    console.log(`Quote generated: ${quote.quoteId} (${quote.baseAmount} -> ${quote.quoteAmount})`);
  });

  adapter.on('tradeExecuted', (trade) => {
    console.log(`Trade executed: ${trade.tradeId} (tx: ${trade.txHash})`);
  });

  // Start all services
  await adapter.start();
  console.log(`FIX Gateway listening on port ${process.env.FIX_PORT ?? 9878}`);
  console.log(`OTC API listening on port ${process.env.OTC_PORT ?? 3000}`);

  // Verify aggregator paths
  console.log('\nVerifying aggregator integration paths...');
  const verifications = await adapter.verifyAllPaths(56);
  for (const v of verifications) {
    const status = v.operational ? 'OK' : 'FAIL';
    console.log(`  ${v.aggregator}: ${status} (${v.latencyMs}ms)`);
  }

  console.log('\nInstitutional adapter running. Press Ctrl+C to stop.');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await adapter.stop();
    process.exit(0);
  });
}

main().catch(console.error);
