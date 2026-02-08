import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getChainConfig,
  tryGetChainConfig,
  registerChain,
  getAllChains,
  getSupportedChains,
  getRfqManagerAddress,
  getWrappedNativeToken,
  ChainId,
} from '../src/chain/index.js';
import { ChainError } from '../src/errors/index.js';

describe('getChainConfig', () => {
  it('returns BSC config', () => {
    const bsc = getChainConfig(ChainId.BSC);
    assert.equal(bsc.chainId, 56);
    assert.equal(bsc.symbol, 'BSC');
    assert.equal(bsc.supported, true);
  });

  it('returns Base config', () => {
    const base = getChainConfig(ChainId.BASE);
    assert.equal(base.chainId, 8453);
    assert.equal(base.supported, true);
  });

  it('throws for unknown chain', () => {
    assert.throws(() => getChainConfig(99999), ChainError);
  });
});

describe('tryGetChainConfig', () => {
  it('returns undefined for unknown chain', () => {
    assert.equal(tryGetChainConfig(99999), undefined);
  });

  it('returns config for known chain', () => {
    const config = tryGetChainConfig(56);
    assert.ok(config);
    assert.equal(config.chainId, 56);
  });
});

describe('registerChain', () => {
  it('registers a new chain', () => {
    registerChain({
      chainId: 43114,
      name: 'Avalanche',
      symbol: 'AVAX',
      nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
      rpcUrls: ['https://api.avax.network/ext/bc/C/rpc'],
      explorerUrl: 'https://snowtrace.io',
      wrappedNativeToken: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
      supported: false,
    });
    const avax = getChainConfig(43114);
    assert.equal(avax.name, 'Avalanche');
  });
});

describe('getAllChains', () => {
  it('returns multiple chains', () => {
    const chains = getAllChains();
    assert.ok(chains.length >= 6); // 6 built-in + any registered
  });
});

describe('getSupportedChains', () => {
  it('only returns supported chains with RFQ manager', () => {
    const supported = getSupportedChains();
    for (const chain of supported) {
      assert.equal(chain.supported, true);
      assert.ok(chain.rfqManagerAddress);
    }
    // BSC and Base should be in there
    const chainIds = supported.map((c) => c.chainId);
    assert.ok(chainIds.includes(56));
    assert.ok(chainIds.includes(8453));
  });
});

describe('getRfqManagerAddress', () => {
  it('returns address for BSC', () => {
    const addr = getRfqManagerAddress(56);
    assert.equal(addr, '0x94020Af3571f253754e5566710A89666d90Df615');
  });

  it('throws for chain without RFQ manager', () => {
    assert.throws(() => getRfqManagerAddress(ChainId.ETHEREUM), ChainError);
  });
});

describe('getWrappedNativeToken', () => {
  it('returns WBNB for BSC', () => {
    assert.equal(getWrappedNativeToken(56), '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c');
  });

  it('returns WETH for Base', () => {
    assert.equal(getWrappedNativeToken(8453), '0x4200000000000000000000000000000000000006');
  });
});
