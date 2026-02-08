import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { PrivateKeySigner, signMMQuote, buildMMQuoteDomain, MM_QUOTE_TYPES } from '../src/signer/index.js';
import { SigningError } from '../src/errors/index.js';
import { ChainId } from '../src/chain/index.js';

// Generate a deterministic test wallet
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

describe('PrivateKeySigner', () => {
  it('returns correct address', async () => {
    const signer = new PrivateKeySigner(TEST_PRIVATE_KEY);
    const address = await signer.getAddress();
    const expected = new Wallet(TEST_PRIVATE_KEY).address;
    assert.equal(address, expected);
  });

  it('throws on invalid private key', () => {
    assert.throws(() => new PrivateKeySigner('not-a-key'), SigningError);
  });

  it('can sign a message', async () => {
    const signer = new PrivateKeySigner(TEST_PRIVATE_KEY);
    const sig = await signer.signMessage('hello');
    assert.ok(sig.startsWith('0x'));
    assert.ok(sig.length > 100);
  });

  it('can sign typed data', async () => {
    const signer = new PrivateKeySigner(TEST_PRIVATE_KEY);
    const domain = buildMMQuoteDomain(ChainId.BSC);
    const value = {
      manager: '0x94020Af3571f253754e5566710A89666d90Df615',
      from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      to: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      inputToken: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      outputToken: '0x55d398326f99059fF775485246999027B3197955',
      amountIn: '1000000000000000000',
      amountOut: '500000000000000000000',
      deadline: '1700000000',
      nonce: '12345',
      extraDataHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    };
    const sig = await signer.signTypedData(domain, MM_QUOTE_TYPES, value);
    assert.ok(sig.startsWith('0x'));
    assert.equal(sig.length, 132); // 65 bytes = 130 hex chars + 0x
  });
});

describe('signMMQuote', () => {
  it('produces a signed quote with hash', async () => {
    const signer = new PrivateKeySigner(TEST_PRIVATE_KEY);
    const result = await signMMQuote(
      signer,
      {
        manager: '0x94020Af3571f253754e5566710A89666d90Df615',
        from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        to: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        inputToken: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        outputToken: '0x55d398326f99059fF775485246999027B3197955',
        amountIn: 1000000000000000000n,
        amountOut: 500000000000000000000n,
        deadline: 1700000000,
        nonce: 12345n,
        extraData: '0x',
      },
      ChainId.BSC,
    );

    assert.ok(result.signature.startsWith('0x'));
    assert.ok(result.hash.startsWith('0x'));
    assert.equal(result.params.manager, '0x94020Af3571f253754e5566710A89666d90Df615');
  });
});

describe('buildMMQuoteDomain', () => {
  it('builds correct domain for BSC', () => {
    const domain = buildMMQuoteDomain(ChainId.BSC);
    assert.equal(domain.name, 'DarkPool Pool');
    assert.equal(domain.version, '1');
    assert.equal(domain.chainId, 56);
    assert.equal(domain.verifyingContract, '0x94020Af3571f253754e5566710A89666d90Df615');
  });
});
