/**
 * DeluthiumExchange -- CCXT-compatible exchange class for Deluthium DEX.
 *
 * This class extends ccxt.Exchange externally (no fork) and maps Deluthium's
 * RFQ API endpoints to standard CCXT methods (fetchMarkets, createOrder, etc.).
 *
 * All amounts sent to the API are in wei (integer strings). This class handles
 * the conversion automatically -- users pass human-readable amounts.
 */

import ccxt from 'ccxt';
import {
  DeluthiumRestClient,
  toWei,
  fromWei,
  ZERO_ADDRESS,
  API_SUCCESS_CODE,
  type IndicativeQuoteRequest,
  type FirmQuoteRequest,
} from '@deluthium/sdk';

// Use generic record types to avoid ccxt namespace issues
type Dict = Record<string, unknown>;

// ============================================================================
// Configuration
// ============================================================================

interface DeluthiumExchangeConfig {
  /** JWT token for Deluthium API authentication */
  apiKey: string;
  /** Chain ID (56=BSC, 8453=Base, 1=ETH). Default: 56 */
  chainId?: number;
  /** Custom API base URL */
  baseUrl?: string;
  /** Default slippage tolerance in percentage. Default: 0.5 */
  defaultSlippage?: number;
  /** Request timeout in ms. Default: 30000 */
  timeout?: number;
}

interface PairCacheEntry {
  pairId: string;
  chainId: number;
}

// ============================================================================
// Exchange Class
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
const ExchangeBase = ccxt.Exchange as any;

export class DeluthiumExchange extends ExchangeBase {
  private restClient!: DeluthiumRestClient;
  private chainId: number;
  private defaultSlippage: number;
  private pairIdCache: Record<string, PairCacheEntry>;
  private tokenDecimalsCache: Record<string, number>;

  constructor(config: DeluthiumExchangeConfig) {
    const userConfig: Dict = {
      apiKey: config.apiKey,
      timeout: config.timeout ?? 30000,
    };

    super(userConfig);

    this.chainId = config.chainId ?? 56;
    this.defaultSlippage = config.defaultSlippage ?? 0.5;
    this.pairIdCache = {};
    this.tokenDecimalsCache = {};

    this.restClient = new DeluthiumRestClient({
      auth: config.apiKey,
      chainId: this.chainId,
      baseUrl: config.baseUrl,
      timeoutMs: config.timeout ?? 30000,
    });
  }

  describe(): Dict {
    return this.deepExtend(super.describe(), {
      id: 'deluthium',
      name: 'Deluthium',
      countries: [],
      version: 'v1',
      rateLimit: 100,
      certified: false,
      pro: false,
      dex: true,
      has: {
        CORS: undefined,
        spot: true,
        margin: false,
        swap: false,
        future: false,
        option: false,
        cancelAllOrders: false,
        cancelOrder: false,
        createOrder: true,
        fetchBalance: false,
        fetchCurrencies: true,
        fetchMarkets: true,
        fetchMyTrades: false,
        fetchOHLCV: true,
        fetchOpenOrders: false,
        fetchOrder: false,
        fetchOrderBook: false,
        fetchOrders: false,
        fetchQuote: true,
        fetchTicker: true,
        fetchTickers: false,
        fetchTrades: false,
      },
      timeframes: {
        '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
        '1h': '1h', '2h': '2h', '4h': '4h', '8h': '8h', '12h': '12h',
        '1d': '1d', '3d': '3d', '1w': '1w', '1M': '1M',
      },
      urls: {
        logo: 'https://deluthium.ai/logo.png',
        api: { private: 'https://rfq-api.deluthium.ai' },
        www: 'https://deluthium.ai',
        doc: 'https://deluthium.ai/docs',
      },
      api: {
        private: {
          get: {
            'v1/listing/pairs': 1,
            'v1/listing/tokens': 1,
            'v1/market/pair': 1,
            'v1/market/klines': 1,
          },
          post: {
            'v1/quote/indicative': 1,
            'v1/quote/firm': 1,
          },
        },
      },
      requiredCredentials: {
        apiKey: true,
        secret: false,
        walletAddress: false,
        privateKey: false,
      },
      options: {
        nativeTokenAddress: ZERO_ADDRESS,
        defaultChainId: this.chainId,
        defaultSlippage: this.defaultSlippage,
      },
      exceptions: {
        exact: {
          INVALID_INPUT: ccxt.BadRequest,
          INVALID_TOKEN: ccxt.BadSymbol,
          INVALID_AMOUNT: ccxt.InvalidOrder,
          INVALID_PAIR: ccxt.BadSymbol,
          INVALID_DEADLINE: ccxt.InvalidOrder,
          QUOTE_EXPIRED: ccxt.OrderNotFound,
          INSUFFICIENT_LIQUIDITY: ccxt.InsufficientFunds,
          MM_NOT_AVAILABLE: ccxt.ExchangeNotAvailable,
          NO_QUOTES: ccxt.ExchangeError,
          SLIPPAGE_EXCEEDED: ccxt.InvalidOrder,
          INTERNAL_ERROR: ccxt.ExchangeError,
          SIGNING_ERROR: ccxt.AuthenticationError,
          TIMEOUT_ERROR: ccxt.RequestTimeout,
        },
        broad: {
          '10095': ccxt.BadRequest,
          '20003': ccxt.ExchangeError,
          '20004': ccxt.BadSymbol,
        },
      },
    });
  }

  // --------------------------------------------------------------------------
  // Wei Conversion
  // --------------------------------------------------------------------------

  toWei(amount: number | string, decimals: number = 18): string {
    return toWei(String(amount), decimals);
  }

  fromWei(wei: string, decimals: number = 18): string {
    return fromWei(wei, decimals);
  }

  getTokenDecimals(tokenAddress: string): number {
    return this.tokenDecimalsCache[tokenAddress] ?? 18;
  }

  // --------------------------------------------------------------------------
  // Market Data
  // --------------------------------------------------------------------------

  async fetchMarkets(params: Dict = {}): Promise<any[]> {
    const chainId = (params['chainId'] as number) ?? this.chainId;
    const pairs = await this.restClient.getPairs(chainId);
    return (pairs as unknown as Dict[]).map(
      (pair) => this.parseMarket(pair, chainId),
    );
  }

  private parseMarket(market: Dict, chainId: number): any {
    const baseToken = (market['base_token'] ?? {}) as Dict;
    const quoteToken = (market['quote_token'] ?? {}) as Dict;
    const pairId = String(market['pair_id'] ?? '');
    const pairSymbol = String(market['pair_symbol'] ?? '');
    const symbol = pairSymbol.replace('-', '/');

    const baseId = String(baseToken['token_address'] ?? '');
    const quoteId = String(quoteToken['token_address'] ?? '');
    const base = String(baseToken['token_symbol'] ?? '');
    const quote = String(quoteToken['token_symbol'] ?? '');
    const isEnabled = market['is_enabled'] !== false;
    const feeRate = Number(market['fee_rate'] ?? 0);

    const baseDecimals = Number(baseToken['decimals'] ?? baseToken['token_decimals'] ?? 18);
    const quoteDecimals = Number(quoteToken['decimals'] ?? quoteToken['token_decimals'] ?? 18);

    const cacheKey = `${symbol}:${chainId}`;
    this.pairIdCache[cacheKey] = { pairId, chainId };
    this.tokenDecimalsCache[baseId] = baseDecimals;
    this.tokenDecimalsCache[quoteId] = quoteDecimals;

    return {
      id: pairId,
      symbol,
      base,
      quote,
      settle: undefined,
      baseId,
      quoteId,
      settleId: undefined,
      type: 'spot',
      spot: true,
      margin: false,
      swap: false,
      future: false,
      option: false,
      active: isEnabled,
      contract: false,
      linear: undefined,
      inverse: undefined,
      taker: feeRate / 10000,
      maker: feeRate / 10000,
      contractSize: undefined,
      expiry: undefined,
      expiryDatetime: undefined,
      strike: undefined,
      optionType: undefined,
      precision: { amount: baseDecimals, price: quoteDecimals },
      limits: {
        leverage: { min: undefined, max: undefined },
        amount: { min: undefined, max: undefined },
        price: { min: undefined, max: undefined },
        cost: { min: undefined, max: undefined },
      },
      created: undefined,
      info: market,
    };
  }

  async fetchCurrencies(params: Dict = {}): Promise<Dict> {
    const chainId = (params['chainId'] as number) ?? this.chainId;
    const tokens = await this.restClient.getTokens(chainId);
    const result: Dict = {};
    for (const token of tokens as unknown as Dict[]) {
      const currency = this.parseCurrency(token, chainId);
      result[currency['code'] as string] = currency;
    }
    return result;
  }

  private parseCurrency(token: Dict, chainId: number): Dict {
    const address = String(token['token_address'] ?? '');
    const code = String(token['token_symbol'] ?? '');
    const name = String(token['token_name'] ?? '');
    const decimals = Number(token['decimals'] ?? token['token_decimals'] ?? 18);

    this.tokenDecimalsCache[address] = decimals;

    return {
      id: address,
      code,
      name,
      type: 'crypto',
      active: true,
      deposit: undefined,
      withdraw: undefined,
      fee: undefined,
      precision: decimals,
      limits: {
        amount: { min: undefined, max: undefined },
        withdraw: { min: undefined, max: undefined },
      },
      networks: {
        [chainId]: {
          id: address,
          network: String(chainId),
          active: true,
          deposit: undefined,
          withdraw: undefined,
          fee: undefined,
          precision: decimals,
          limits: {
            amount: { min: undefined, max: undefined },
            withdraw: { min: undefined, max: undefined },
          },
          info: token,
        },
      },
      info: token,
    };
  }

  async fetchTicker(symbol: string, params: Dict = {}): Promise<any> {
    await this.loadMarkets();
    const market = this.market(symbol) as any;
    const chainId = (params['chainId'] as number) ?? this.chainId;

    const data = await this.restClient.getMarketPair({
      base: market.base as string,
      quote: market.quote as string,
      chainId,
    });

    return this.parseTicker(data as unknown as Dict, market);
  }

  private parseTicker(ticker: Dict, market?: any): any {
    const symbol = market?.symbol;
    const priceVal = ticker['price'] != null ? String(ticker['price']) : undefined;
    const change24h = ticker['change_24h'] != null ? String(ticker['change_24h']) : undefined;
    const baseVolume = ticker['volume_base_24h'] != null ? String(ticker['volume_base_24h']) : undefined;
    const quoteVolume = ticker['volume_quote_24h'] != null ? String(ticker['volume_quote_24h']) : undefined;

    let percentage: number | undefined;
    if (change24h !== undefined) {
      const changeNum = parseFloat(change24h);
      if (!isNaN(changeNum)) {
        percentage = changeNum * 100;
      }
    }

    return this.safeTicker({
      symbol,
      timestamp: undefined,
      datetime: undefined,
      high: undefined,
      low: undefined,
      bid: undefined,
      bidVolume: undefined,
      ask: undefined,
      askVolume: undefined,
      vwap: undefined,
      open: undefined,
      close: priceVal,
      last: priceVal,
      previousClose: undefined,
      change: undefined,
      percentage,
      average: undefined,
      baseVolume,
      quoteVolume,
      info: ticker,
    }, market);
  }

  async fetchOHLCV(
    symbol: string,
    timeframe: string = '1h',
    _since?: number,
    limit?: number,
    params: Dict = {},
  ): Promise<any[]> {
    await this.loadMarkets();
    const market = this.market(symbol) as any;
    const chainId = (params['chainId'] as number) ?? this.chainId;

    const data = await this.restClient.getKlines({
      pair: `${market.base}-${market.quote}`,
      interval: (this as any).timeframes?.[timeframe] ?? timeframe,
      limit: limit ?? 500,
      chainId,
    });
    return (data as unknown as Dict[]).map(
      (candle) => this.parseOHLCV(candle),
    );
  }

  private parseOHLCV(ohlcv: Dict): any[] {
    const openTime = ohlcv['open_time'] as number | undefined;
    const timestamp = openTime !== undefined ? openTime * 1000 : Date.now();
    return [
      timestamp,
      Number(ohlcv['open'] ?? 0),
      Number(ohlcv['high'] ?? 0),
      Number(ohlcv['low'] ?? 0),
      Number(ohlcv['close'] ?? 0),
      Number(ohlcv['volume_base'] ?? 0),
    ];
  }

  // --------------------------------------------------------------------------
  // Trading (RFQ)
  // --------------------------------------------------------------------------

  async fetchQuote(
    symbol: string,
    amount: number,
    side: string = 'buy',
    params: Dict = {},
  ): Promise<Dict> {
    await this.loadMarkets();
    const market = this.market(symbol) as any;
    const chainId = (params['chainId'] as number) ?? this.chainId;

    const tokenIn = side === 'buy' ? market.quoteId : market.baseId;
    const tokenOut = side === 'buy' ? market.baseId : market.quoteId;

    const tokenInDecimals = this.getTokenDecimals(tokenIn as string);
    const amountInWei = this.toWei(amount, tokenInDecimals);

    const request: IndicativeQuoteRequest = {
      src_chain_id: chainId,
      dst_chain_id: chainId,
      token_in: tokenIn as string,
      token_out: tokenOut as string,
      amount_in: amountInWei,
    };

    const data = await this.restClient.getIndicativeQuote(request);
    const result = data as unknown as Dict;
    return {
      symbol: market.symbol,
      amount_in: String(result['amount_in'] ?? ''),
      amount_out: String(result['amount_out'] ?? ''),
      fee_rate: result['fee_rate'],
      fee_amount: String(result['fee_amount'] ?? ''),
      info: data,
    };
  }

  async createOrder(
    symbol: string,
    type: string,
    side: string,
    amount: number,
    _price?: number,
    params: Dict = {},
  ): Promise<any> {
    if (type !== 'market') {
      throw new ccxt.InvalidOrder(
        this.id + ' createOrder() only supports market orders (RFQ-based exchange)',
      );
    }

    await this.loadMarkets();
    const market = this.market(symbol) as any;
    const chainId = (params['chainId'] as number) ?? this.chainId;
    const dstChainId = (params['dstChainId'] as number) ?? chainId;
    const slippage = (params['slippage'] as number) ?? this.defaultSlippage;
    const walletAddress = (params['walletAddress'] ?? params['from_address']) as string | undefined;

    if (!walletAddress) {
      throw new ccxt.ArgumentsRequired(
        this.id + ' createOrder() requires params.walletAddress',
      );
    }

    const tokenIn = side === 'buy' ? market.quoteId : market.baseId;
    const tokenOut = side === 'buy' ? market.baseId : market.quoteId;
    const tokenInDecimals = this.getTokenDecimals(tokenIn as string);
    const amountInWei = this.toWei(amount, tokenInDecimals);
    const toAddress = (params['to_address'] ?? params['toAddress'] ?? walletAddress) as string;

    const request: FirmQuoteRequest = {
      src_chain_id: chainId,
      dst_chain_id: dstChainId,
      from_address: walletAddress,
      to_address: toAddress,
      token_in: tokenIn as string,
      token_out: tokenOut as string,
      amount_in: amountInWei,
      slippage,
      expiry_time_sec: (params['expiryTimeSec'] as number) ?? 60,
    };

    const indicativeAmountOut = params['indicative_amount_out'] as string | undefined;
    if (indicativeAmountOut) {
      (request as any).indicative_amount_out = indicativeAmountOut;
    }

    const data = await this.restClient.getFirmQuote(request) as unknown as Dict;
    return this.parseOrder(data, market, side);
  }

  private parseOrder(order: Dict, market?: any, side?: string): any {
    const quoteId = String(order['quote_id'] ?? '');
    const symbol = market?.symbol;
    const amountIn = order['amount_in'] != null ? String(order['amount_in']) : undefined;
    const amountOut = order['amount_out'] != null ? String(order['amount_out']) : undefined;
    const deadline = order['deadline'] as number | undefined;
    const deadlineTimestamp = deadline !== undefined ? deadline * 1000 : undefined;

    return {
      id: quoteId,
      clientOrderId: undefined,
      timestamp: Date.now(),
      datetime: new Date().toISOString(),
      lastTradeTimestamp: undefined,
      lastUpdateTimestamp: undefined,
      status: 'open',
      symbol,
      type: 'market',
      timeInForce: undefined,
      postOnly: undefined,
      reduceOnly: undefined,
      side,
      price: undefined,
      triggerPrice: undefined,
      takeProfitPrice: undefined,
      stopLossPrice: undefined,
      average: undefined,
      amount: amountIn !== undefined ? parseFloat(amountIn) : undefined,
      filled: undefined,
      remaining: undefined,
      cost: undefined,
      trades: undefined,
      fee: {
        cost: order['fee_amount'] !== undefined ? parseFloat(String(order['fee_amount'])) : undefined,
        currency: market?.quote,
      },
      info: {
        ...order,
        expected_output: amountOut,
        deadline_timestamp: deadlineTimestamp,
      },
    };
  }

  // --------------------------------------------------------------------------
  // Auth (Bearer JWT)
  // --------------------------------------------------------------------------

  sign(
    path: string,
    api: string = 'private',
    method: string = 'GET',
    params: Dict = {},
    _headers?: Dict,
    _body?: string,
  ): { url: string; method: string; body?: string; headers: Record<string, string> } {
    let url = (this as any).urls.api[api] + '/' + path;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (this as any).apiKey,
    };

    let body: string | undefined;
    if (method === 'GET') {
      if (Object.keys(params).length > 0) {
        url += '?' + (this as any).urlencode(params);
      }
    } else {
      body = JSON.stringify(params);
    }

    return { url, method, body, headers };
  }

  // --------------------------------------------------------------------------
  // Error Handling
  // --------------------------------------------------------------------------

  handleErrors(
    httpCode: number,
    _reason: string,
    _url: string,
    _method: string,
    _headers: Dict,
    body: string,
    response: Dict | undefined,
  ): void {
    if (httpCode === 401) {
      throw new ccxt.AuthenticationError(this.id + ' ' + body);
    }
    if (response === undefined) {
      return;
    }

    const code = response['code'];

    if (code === API_SUCCESS_CODE || code === String(API_SUCCESS_CODE)) {
      return;
    }

    if (typeof code === 'string') {
      const exactExceptions = ((this as any).exceptions?.exact ?? {}) as Dict;
      if (code in exactExceptions) {
        const ExceptionClass = exactExceptions[code] as any;
        throw new ExceptionClass(this.id + ' ' + body);
      }
      const message = String(response['message'] ?? code);
      throw new ccxt.ExchangeError(this.id + ' ' + message);
    }

    if (typeof code === 'number') {
      const broadExceptions = ((this as any).exceptions?.broad ?? {}) as Dict;
      const codeStr = String(code);
      if (codeStr in broadExceptions) {
        const ExceptionClass = broadExceptions[codeStr] as any;
        throw new ExceptionClass(this.id + ' ' + body);
      }
      const message = String(response['message'] ?? 'Unknown error');
      throw new ccxt.ExchangeError(this.id + ' ' + message);
    }
  }
}
