/**
 * Adapter metadata and configuration templates for the CLI.
 */

export interface AdapterInfo {
  /** Package name */
  name: string;
  /** npm package (or pip for Python) */
  package: string;
  /** Human-readable label */
  label: string;
  /** Short description */
  description: string;
  /** Language(s) */
  language: 'typescript' | 'python' | 'both';
  /** Required config fields */
  configFields: ConfigField[];
  /** Dependencies to install */
  npmDependencies: string[];
  /** Optional pip dependencies */
  pipDependencies?: string[];
  /** Example import statement */
  importExample: string;
  /** Example initialization code */
  initExample: string;
}

export interface ConfigField {
  key: string;
  label: string;
  description: string;
  required: boolean;
  type: 'string' | 'number' | 'boolean';
  default?: string | number | boolean;
  secret?: boolean;
}

export const ADAPTERS: Record<string, AdapterInfo> = {
  ccxt: {
    name: 'ccxt',
    package: '@deluthium/ccxt-adapter',
    label: 'CCXT (Exchange Library)',
    description: 'Use Deluthium through the standard CCXT exchange interface',
    language: 'both',
    configFields: [
      { key: 'apiKey', label: 'API Key (JWT)', description: 'Deluthium JWT token', required: true, type: 'string', secret: true },
      { key: 'chainId', label: 'Chain ID', description: 'Default chain (56=BSC, 8453=Base, 1=ETH)', required: false, type: 'number', default: 56 },
    ],
    npmDependencies: ['@deluthium/sdk', '@deluthium/ccxt-adapter', 'ccxt'],
    pipDependencies: ['ccxt'],
    importExample: "import { DeluthiumExchange } from '@deluthium/ccxt-adapter';",
    initExample: `const exchange = new DeluthiumExchange({
  apiKey: process.env.DELUTHIUM_API_KEY!,
  chainId: 56,
});

const markets = await exchange.fetchMarkets();
console.log('Available markets:', markets.length);`,
  },

  hummingbot: {
    name: 'hummingbot',
    package: 'deluthium-hummingbot',
    label: 'Hummingbot (Trading Bot)',
    description: 'Auto-inject Deluthium connector into Hummingbot',
    language: 'python',
    configFields: [
      { key: 'apiKey', label: 'API Key (JWT)', description: 'Deluthium JWT token', required: true, type: 'string', secret: true },
      { key: 'hummingbotDir', label: 'Hummingbot Directory', description: 'Path to Hummingbot installation', required: true, type: 'string' },
    ],
    npmDependencies: [],
    pipDependencies: ['deluthium-hummingbot'],
    importExample: '# pip install deluthium-hummingbot',
    initExample: `# Install the connector
# pip install deluthium-hummingbot
# deluthium-hummingbot install --hummingbot-dir /path/to/hummingbot

# Then in Hummingbot:
# connect deluthium
# create --script pure_market_making --exchange deluthium`,
  },

  '0x': {
    name: '0x',
    package: '@deluthium/0x-adapter',
    label: '0x Protocol (RFQ Aggregator)',
    description: 'Translate 0x Protocol v4 RFQ orders to Deluthium',
    language: 'typescript',
    configFields: [
      { key: 'apiKey', label: 'API Key (JWT)', description: 'Deluthium JWT token', required: true, type: 'string', secret: true },
      { key: 'privateKey', label: 'Private Key', description: 'EVM private key for signing', required: true, type: 'string', secret: true },
      { key: 'chainId', label: 'Chain ID', description: 'Target chain', required: false, type: 'number', default: 56 },
    ],
    npmDependencies: ['@deluthium/sdk', '@deluthium/0x-adapter'],
    importExample: "import { ZeroExToDarkPoolProxy, PrivateKeySigner } from '@deluthium/0x-adapter';",
    initExample: `const signer = new PrivateKeySigner(process.env.PRIVATE_KEY!);

const proxy = new ZeroExToDarkPoolProxy({
  deluthiumApiUrl: 'https://rfq-api.deluthium.ai',
  deluthiumAuth: process.env.DELUTHIUM_API_KEY!,
  signer,
  chainId: 56,
});

// Transform and sign a 0x RFQ order
const result = await proxy.transformAndSign(zeroExOrder);`,
  },

  '1inch': {
    name: '1inch',
    package: '@deluthium/1inch-adapter',
    label: '1inch (Limit Order Protocol)',
    description: 'Bridge Deluthium quotes to 1inch LimitOrderV4',
    language: 'typescript',
    configFields: [
      { key: 'apiKey', label: 'API Key (JWT)', description: 'Deluthium JWT token', required: true, type: 'string', secret: true },
      { key: 'privateKey', label: 'Private Key', description: 'EVM private key for signing', required: true, type: 'string', secret: true },
      { key: 'chainId', label: 'Chain ID', description: 'Target chain', required: false, type: 'number', default: 56 },
    ],
    npmDependencies: ['@deluthium/sdk', '@deluthium/1inch-adapter'],
    importExample: "import { createDeluthiumAdapter } from '@deluthium/1inch-adapter';",
    initExample: `const adapter = createDeluthiumAdapter({
  deluthiumApiUrl: 'https://rfq-api.deluthium.ai',
  deluthiumAuth: process.env.DELUTHIUM_API_KEY!,
  privateKey: process.env.PRIVATE_KEY!,
  chainId: 56,
});

// Get a 1inch-compatible limit order from Deluthium
const order = await adapter.createOrder({
  makerAsset: '0x...',
  takerAsset: '0x...',
  makingAmount: '1000000000000000000',
});`,
  },

  uniswapx: {
    name: 'uniswapx',
    package: '@deluthium/uniswapx-adapter',
    label: 'UniswapX (Intent-Based Filler)',
    description: 'Fill UniswapX Dutch auction orders via Deluthium liquidity',
    language: 'typescript',
    configFields: [
      { key: 'apiKey', label: 'API Key (JWT)', description: 'Deluthium JWT token', required: true, type: 'string', secret: true },
      { key: 'privateKey', label: 'Private Key', description: 'EVM private key for filling', required: true, type: 'string', secret: true },
      { key: 'chainId', label: 'Chain ID', description: 'Target chain (1=ETH, 42161=Arbitrum, 8453=Base)', required: false, type: 'number', default: 1 },
      { key: 'rpcUrl', label: 'RPC URL', description: 'JSON-RPC endpoint', required: true, type: 'string' },
      { key: 'minProfitBps', label: 'Min Profit (bps)', description: 'Minimum profit threshold in basis points', required: false, type: 'number', default: 25 },
    ],
    npmDependencies: ['@deluthium/sdk', '@deluthium/uniswapx-adapter', 'ethers'],
    importExample: "import { UniswapXAdapter } from '@deluthium/uniswapx-adapter';",
    initExample: `import { PrivateKeySigner, ChainId } from '@deluthium/sdk';

const adapter = new UniswapXAdapter({
  deluthiumConfig: { auth: process.env.DELUTHIUM_API_KEY!, chainId: ChainId.ETHEREUM },
  signer: new PrivateKeySigner(process.env.PRIVATE_KEY!),
  chainId: ChainId.ETHEREUM,
  rpcUrl: process.env.RPC_URL!,
  minProfitBps: 25,
  autoFill: true,
});

adapter.on('orderEvaluated', (eval) => {
  console.log(\`Order \${eval.order.orderHash}: profitable=\${eval.profitable}\`);
});

await adapter.start();`,
  },

  hashflow: {
    name: 'hashflow',
    package: '@deluthium/hashflow-adapter',
    label: 'Hashflow (RFQ Protocol)',
    description: 'Act as a Hashflow market maker backed by Deluthium liquidity',
    language: 'typescript',
    configFields: [
      { key: 'apiKey', label: 'API Key (JWT)', description: 'Deluthium JWT token', required: true, type: 'string', secret: true },
      { key: 'privateKey', label: 'Private Key', description: 'EVM private key for signing', required: true, type: 'string', secret: true },
      { key: 'marketMaker', label: 'Market Maker Name', description: 'Your Hashflow market maker identifier', required: true, type: 'string' },
    ],
    npmDependencies: ['@deluthium/sdk', '@deluthium/hashflow-adapter'],
    importExample: "import { HashflowAdapter } from '@deluthium/hashflow-adapter';",
    initExample: `import { PrivateKeySigner, ChainId } from '@deluthium/sdk';

const signer = new PrivateKeySigner(process.env.PRIVATE_KEY!);

const adapter = new HashflowAdapter({
  deluthiumConfig: { auth: process.env.DELUTHIUM_API_KEY!, chainId: ChainId.BSC },
  signer,
  marketMaker: 'my-mm',
  hashflowWsUrl: 'wss://maker-ws.hashflow.com/v3',
  chains: [56, 1],
  pairs: ['WBNB/USDT', 'ETH/USDC'],
});

adapter.on('rfqReceived', (req) => console.log('RFQ:', req));
await adapter.start();`,
  },

  paraswap: {
    name: 'paraswap',
    package: '@deluthium/paraswap-adapter',
    label: 'Paraswap (DEX Aggregator)',
    description: 'Register Deluthium as a Paraswap liquidity source',
    language: 'typescript',
    configFields: [
      { key: 'apiKey', label: 'API Key (JWT)', description: 'Deluthium JWT token', required: true, type: 'string', secret: true },
      { key: 'privateKey', label: 'Private Key', description: 'EVM private key for signing', required: true, type: 'string', secret: true },
      { key: 'chainId', label: 'Chain ID', description: 'Target chain', required: false, type: 'number', default: 56 },
      { key: 'poolAdapterAddress', label: 'Pool Adapter Address', description: 'Deployed Deluthium pool adapter contract', required: false, type: 'string' },
    ],
    npmDependencies: ['@deluthium/sdk', '@deluthium/paraswap-adapter', 'ethers'],
    importExample: "import { ParaswapAdapter } from '@deluthium/paraswap-adapter';",
    initExample: `import { PrivateKeySigner, ChainId } from '@deluthium/sdk';

const adapter = new ParaswapAdapter({
  deluthium: { auth: process.env.DELUTHIUM_API_KEY!, chainId: ChainId.BSC },
  signer: new PrivateKeySigner(process.env.PRIVATE_KEY!),
  poolAdapterAddress: '0xYourDeployedPoolAdapter',
});

adapter.on('rate:updated', (e) => console.log('Rate:', e));
await adapter.start();`,
  },

  dydx: {
    name: 'dydx',
    package: '@deluthium/dydx-adapter',
    label: 'dYdX (Order Book DEX)',
    description: 'Bridge Deluthium liquidity to dYdX v4 order book',
    language: 'typescript',
    configFields: [
      { key: 'apiKey', label: 'API Key (JWT)', description: 'Deluthium JWT token', required: true, type: 'string', secret: true },
      { key: 'privateKey', label: 'Private Key', description: 'EVM private key', required: true, type: 'string', secret: true },
      { key: 'network', label: 'dYdX Network', description: 'mainnet or testnet', required: false, type: 'string', default: 'testnet' },
    ],
    npmDependencies: ['@deluthium/sdk', '@deluthium/dydx-adapter'],
    importExample: "import { DydxAdapter } from '@deluthium/dydx-adapter';",
    initExample: `import { PrivateKeySigner, ChainId } from '@deluthium/sdk';

const adapter = new DydxAdapter({
  deluthium: { auth: process.env.DELUTHIUM_API_KEY!, chainId: ChainId.BSC },
  signer: new PrivateKeySigner(process.env.PRIVATE_KEY!),
  network: 'testnet',
});

await adapter.initialize();
adapter.on('orderbook:update', (book) => console.log('Book:', book.ticker));
adapter.subscribeMarket('BTC-USD');`,
  },

  'binance-dex': {
    name: 'binance-dex',
    package: '@deluthium/binance-dex-adapter',
    label: 'PancakeSwap / Binance DEX',
    description: 'Split-route between Deluthium RFQ and PancakeSwap AMM',
    language: 'typescript',
    configFields: [
      { key: 'apiKey', label: 'API Key (JWT)', description: 'Deluthium JWT token', required: true, type: 'string', secret: true },
      { key: 'privateKey', label: 'Private Key', description: 'EVM private key', required: true, type: 'string', secret: true },
      { key: 'rpcUrl', label: 'RPC URL', description: 'BNB Chain RPC endpoint', required: false, type: 'string' },
    ],
    npmDependencies: ['@deluthium/sdk', '@deluthium/binance-dex-adapter', 'ethers'],
    importExample: "import { BinanceDexAdapter } from '@deluthium/binance-dex-adapter';",
    initExample: `import { PrivateKeySigner } from '@deluthium/sdk';

const adapter = new BinanceDexAdapter({
  deluthium: { auth: process.env.DELUTHIUM_API_KEY!, chainId: 56 },
  signer: new PrivateKeySigner(process.env.PRIVATE_KEY!),
});

await adapter.initialize();
const comparison = await adapter.comparePrice(srcToken, destToken, amount);
console.log('Best venue:', comparison.bestQuote.source);`,
  },

  institutional: {
    name: 'institutional',
    package: '@deluthium/institutional-adapter',
    label: 'Institutional (FIX / OTC)',
    description: 'FIX protocol gateway + OTC API for Wintermute/GSR/Jump',
    language: 'typescript',
    configFields: [
      { key: 'apiKey', label: 'API Key (JWT)', description: 'Deluthium JWT token', required: true, type: 'string', secret: true },
      { key: 'privateKey', label: 'Private Key', description: 'EVM private key for signing', required: true, type: 'string', secret: true },
      { key: 'fixPort', label: 'FIX Port', description: 'TCP port for FIX acceptor', required: false, type: 'number', default: 9878 },
      { key: 'otcPort', label: 'OTC API Port', description: 'HTTP port for OTC API', required: false, type: 'number', default: 3000 },
    ],
    npmDependencies: ['@deluthium/sdk', '@deluthium/institutional-adapter', '@deluthium/0x-adapter', '@deluthium/1inch-adapter'],
    importExample: "import { InstitutionalAdapter } from '@deluthium/institutional-adapter';",
    initExample: `import { PrivateKeySigner, ChainId } from '@deluthium/sdk';

const adapter = new InstitutionalAdapter({
  deluthiumConfig: { auth: process.env.DELUTHIUM_API_KEY!, chainId: ChainId.BSC },
  signer: new PrivateKeySigner(process.env.PRIVATE_KEY!),
  counterparties: { /* ... */ },
  tokenMappings: [ /* ... */ ],
  defaultChainId: 56,
  fixConfig: { port: 9878, sessions: { /* ... */ } },
  otcApiConfig: { port: 3000 },
});

await adapter.start();`,
  },

  custom: {
    name: 'custom',
    package: '@deluthium/sdk',
    label: 'Custom (SDK Only)',
    description: 'Use the core SDK to build a custom integration',
    language: 'typescript',
    configFields: [
      { key: 'apiKey', label: 'API Key (JWT)', description: 'Deluthium JWT token', required: true, type: 'string', secret: true },
      { key: 'chainId', label: 'Chain ID', description: 'Default chain (56=BSC, 8453=Base, 1=ETH)', required: false, type: 'number', default: 56 },
    ],
    npmDependencies: ['@deluthium/sdk'],
    importExample: "import { DeluthiumRestClient, ChainId, toWei } from '@deluthium/sdk';",
    initExample: `const client = new DeluthiumRestClient({
  auth: process.env.DELUTHIUM_API_KEY!,
  chainId: 56,
});

// Fetch trading pairs
const pairs = await client.getPairs();

// Get an indicative quote
const quote = await client.getIndicativeQuote({
  src_chain_id: 56,
  dst_chain_id: 56,
  token_in: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
  token_out: '0x55d398326f99059fF775485246999027B3197955', // USDT
  amount_in: toWei('1.0', 18),
});

console.log('Quote:', quote);`,
  },
};

export const ADAPTER_CHOICES = Object.entries(ADAPTERS).map(([key, info]) => ({
  name: `${info.label} -- ${info.description}`,
  value: key,
}));
