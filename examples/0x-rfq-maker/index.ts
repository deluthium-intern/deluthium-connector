/**
 * 0x RFQ Maker Example
 *
 * Demonstrates running as a 0x Protocol v4 RFQ maker with Deluthium as the
 * backend liquidity source. Incoming 0x RFQ orders are transformed into
 * Deluthium firm quotes, signed, and returned.
 */

import 'dotenv/config';
import {
  ZeroExToDarkPoolProxy,
  PrivateKeySigner,
  validateZeroExOrder,
  type ZeroExV4RFQOrder,
} from '@deluthium/0x-adapter';

async function main() {
  const signer = new PrivateKeySigner(process.env.PRIVATE_KEY!);
  const makerAddress = await signer.getAddress();

  console.log(`0x RFQ Maker starting (address: ${makerAddress})`);

  // Create the adapter proxy
  const proxy = new ZeroExToDarkPoolProxy({
    deluthiumApiUrl: process.env.DELUTHIUM_API_URL ?? 'https://rfq-api.deluthium.ai',
    deluthiumAuth: process.env.DELUTHIUM_API_KEY!,
    signer,
    chainId: Number(process.env.CHAIN_ID ?? 56),
  });

  // Example: handle an incoming 0x RFQ order
  const exampleOrder: ZeroExV4RFQOrder = {
    makerToken: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
    takerToken: '0x55d398326f99059fF775485246999027B3197955', // USDT
    makerAmount: '1000000000000000000', // 1 WBNB
    takerAmount: '300000000000000000000', // 300 USDT
    maker: makerAddress,
    taker: '0x0000000000000000000000000000000000000000',
    txOrigin: '0x0000000000000000000000000000000000000000',
    pool: '0x0000000000000000000000000000000000000000000000000000000000000000',
    expiry: String(Math.floor(Date.now() / 1000) + 300),
    salt: String(Date.now()),
  };

  // Validate
  const validation = validateZeroExOrder(exampleOrder);
  console.log('Validation:', validation.valid ? 'PASS' : `FAIL: ${validation.errors?.join(', ')}`);

  // Transform and sign (would send to Deluthium API in production)
  console.log('\nTransforming 0x order to Deluthium format...');
  // const result = await proxy.transformAndSign(exampleOrder);
  // console.log('Signed quote:', result);

  console.log('\n0x RFQ Maker ready to serve quotes via Deluthium.');
}

main().catch(console.error);
