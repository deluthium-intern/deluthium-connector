/**
 * Custom Market Maker Example
 *
 * Build a custom market maker using the Deluthium SDK directly.
 * This example demonstrates the full SDK API: REST client, WebSocket client,
 * EIP-712 signing, and chain configuration.
 */

import 'dotenv/config';
import {
  DeluthiumRestClient,
  DeluthiumWSClient,
  PrivateKeySigner,
  signMMQuote,
  buildMMQuoteDomain,
  getChainConfig,
  getRfqManagerAddress,
  ChainId,
  toWei,
  fromWei,
  normalizeAddress,
  calculateDeadline,
  generateNonce,
} from '@deluthium/sdk';

async function main() {
  const chainId = ChainId.BSC;
  const chainConfig = getChainConfig(chainId);

  console.log(`Custom MM starting on ${chainConfig.name}`);
  console.log(`RFQ Manager: ${getRfqManagerAddress(chainId)}\n`);

  // ─── REST Client ──────────────────────────────────────────────────────

  const client = new DeluthiumRestClient({
    auth: process.env.DELUTHIUM_API_KEY!,
    chainId,
  });

  // Fetch trading pairs
  console.log('Fetching trading pairs...');
  const pairs = await client.getPairs();
  console.log(`Found ${pairs.length} pairs:`);
  for (const pair of pairs.slice(0, 5)) {
    console.log(`  ${pair.baseToken.symbol}/${pair.quoteToken.symbol} (active: ${pair.active})`);
  }

  // Get an indicative quote
  if (pairs.length > 0) {
    const pair = pairs[0];
    console.log(`\nFetching indicative quote for ${pair.baseToken.symbol}/${pair.quoteToken.symbol}...`);

    const quote = await client.getIndicativeQuote({
      src_chain_id: chainId,
      dst_chain_id: chainId,
      token_in: pair.baseToken.address,
      token_out: pair.quoteToken.address,
      amount_in: toWei('1.0', pair.baseToken.decimals),
    });

    console.log(`  Input:  1.0 ${pair.baseToken.symbol}`);
    console.log(`  Output: ${fromWei(quote.amount_out, pair.quoteToken.decimals)} ${pair.quoteToken.symbol}`);
    console.log(`  Price:  ${quote.price}`);
  }

  // ─── Signing ──────────────────────────────────────────────────────────

  const signer = new PrivateKeySigner(process.env.PRIVATE_KEY!);
  const address = await signer.getAddress();
  console.log(`\nSigner address: ${normalizeAddress(address)}`);

  // Sign an MMQuote (EIP-712)
  const domain = buildMMQuoteDomain(chainId);
  const quoteParams = {
    manager: getRfqManagerAddress(chainId)!,
    from: address,
    to: address,
    inputToken: normalizeAddress('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'),
    outputToken: normalizeAddress('0x55d398326f99059fF775485246999027B3197955'),
    amountIn: BigInt(toWei('1.0', 18)),
    amountOut: BigInt(toWei('300.0', 18)),
    deadline: calculateDeadline(300),
    nonce: generateNonce(),
    extraData: '0x',
  };

  const signedQuote = await signMMQuote(quoteParams, domain, signer);
  console.log(`\nSigned MMQuote:`);
  console.log(`  Hash: ${signedQuote.hash.slice(0, 20)}...`);
  console.log(`  Signature: ${signedQuote.signature.slice(0, 20)}...`);

  // ─── WebSocket Client ─────────────────────────────────────────────────

  console.log('\nWebSocket client ready for real-time data.');
  console.log('Connect with:');
  console.log("  const ws = new DeluthiumWSClient({ auth: '...', chainId: 56 });");
  console.log("  ws.on('depth', (update) => console.log(update));");
  console.log("  await ws.connect();");

  console.log('\nCustom MM setup complete.');
}

main().catch(console.error);
