/**
 * 1inch Limit Order Example
 *
 * Create 1inch LimitOrderV4-compatible orders backed by Deluthium liquidity.
 * The adapter handles MakerTraits encoding, nonce management, and EIP-712 signing.
 */

import 'dotenv/config';
import {
  createDeluthiumAdapter,
  MakerTraits,
  NonceManager,
  ChainId,
  PrivateKeySigner,
} from '@deluthium/1inch-adapter';

async function main() {
  const signer = new PrivateKeySigner(process.env.PRIVATE_KEY!);
  const makerAddress = await signer.getAddress();

  console.log(`1inch Limit Order maker (address: ${makerAddress})`);
  console.log(`Chain: BSC (${ChainId.BSC})\n`);

  // Create the adapter
  const adapter = createDeluthiumAdapter({
    deluthiumApiUrl: process.env.DELUTHIUM_API_URL ?? 'https://rfq-api.deluthium.ai',
    deluthiumAuth: process.env.DELUTHIUM_API_KEY!,
    privateKey: process.env.PRIVATE_KEY!,
    chainId: ChainId.BSC,
  });

  // Demonstrate MakerTraits encoding
  const traits = new MakerTraits();
  traits.setExpiration(Math.floor(Date.now() / 1000) + 300); // 5 minutes
  traits.setNonceOrEpoch(1n);
  traits.setAllowedSender('0x0000000000000000000000000000000000000000');

  console.log('MakerTraits:');
  console.log(`  Encoded: ${traits.encode()}`);
  console.log(`  Expiration: ${traits.getExpiration()}`);
  console.log(`  Has expiration: ${traits.hasExpiration()}`);

  // NonceManager demo
  const nonceManager = new NonceManager();
  const nonce1 = nonceManager.next();
  const nonce2 = nonceManager.next();
  console.log(`\nNonces: ${nonce1}, ${nonce2}`);

  // Create an order (would call Deluthium API in production)
  console.log('\nReady to create 1inch limit orders backed by Deluthium liquidity.');
  // const order = await adapter.createOrder({
  //   makerAsset: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  //   takerAsset: '0x55d398326f99059fF775485246999027B3197955',
  //   makingAmount: '1000000000000000000',
  // });
}

main().catch(console.error);
