/**
 * @deluthium/binance-dex-adapter - PancakeSwap Client
 *
 * Integration with PancakeSwap V2 and V3 on BNB Chain.
 * Provides quoting, pool discovery, gas estimation, and swap execution.
 */

import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { fromWei } from '@deluthium/sdk';
import { ValidationError, DeluthiumError } from '@deluthium/sdk';
import type { DexToken, PancakeSwapContracts, PancakeSwapPool } from './types.js';
import { PANCAKESWAP_ADDRESSES, BNB_CHAIN_TOKENS } from './types.js';

const V2_ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
];

const V3_QUOTER_ABI = [
  'function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

const V2_FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
];

const V3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

const V2_PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

const V3_POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

const V3_FEE_TIERS = [100, 500, 2500, 10000] as const;
const V2_SWAP_GAS = 150_000n;
const V3_SWAP_GAS = 200_000n;
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const CACHE_TTL_MS = 15_000;
const DEFAULT_GAS_PRICE = 3_000_000_000n;
const DEFAULT_BNB_PRICE_USD = 300;

/** Result from a single PancakeSwap quote attempt. */
export interface PancakeSwapQuoteResult {
  /** Pool version that produced the quote. */
  version: 'v2' | 'v3';
  /** Output amount in wei. */
  amountOut: bigint;
  /** Token path (native resolved to WBNB). */
  path: string[];
  /** V3 fee tier (when version is v3). */
  feeTier?: number;
  /** Estimated gas units for this swap. */
  estimatedGasUnits: bigint;
}

/** Result from executeSwapV2. */
export interface SwapExecutionResult {
  /** Transaction hash (empty on pre-send failure). */
  txHash: string;
  /** Whether the transaction was mined successfully. */
  success: boolean;
  /** Gas consumed (string wei). */
  gasUsed: string;
  /** Error message when success is false. */
  error?: string;
}

/**
 * Client for PancakeSwap V2 + V3 on BNB Chain.
 *
 * Wraps the on-chain Router, QuoterV2 and Factory contracts behind a
 * TypeScript interface with caching, multi-hop fallback paths, and
 * automatic native-token resolution (BNB to WBNB).
 */
export class PancakeSwapClient {
  private readonly provider: JsonRpcProvider;
  private readonly chainId: number;
  private readonly contracts: PancakeSwapContracts;
  private readonly v2Router: Contract;
  private readonly v3Quoter: Contract;
  private readonly v2Factory: Contract;
  private readonly v3Factory: Contract;
  private readonly useV2: boolean;
  private readonly useV3: boolean;
  private wallet: Wallet | null = null;
  private bnbPriceCache: { price: number; timestamp: number } | null = null;
  private gasPriceCache: { price: bigint; timestamp: number } | null = null;

  /**
   * @param options.rpcUrl   JSON-RPC endpoint for BNB Chain
   * @param options.chainId  Chain ID (default 56)
   * @param options.useV2    Include V2 AMM pools (default true)
   * @param options.useV3    Include V3 pools (default true)
   * @throws {ValidationError} if no PancakeSwap deployment exists for the chain
   */
  constructor(options: {
    rpcUrl: string;
    chainId?: number;
    useV2?: boolean;
    useV3?: boolean;
  }) {
    this.chainId = options.chainId ?? 56;
    this.useV2 = options.useV2 ?? true;
    this.useV3 = options.useV3 ?? true;
    this.provider = new JsonRpcProvider(options.rpcUrl);
    const contracts = PANCAKESWAP_ADDRESSES[this.chainId];
    if (!contracts) {
      throw new ValidationError(
        `No PancakeSwap contracts for chain ${this.chainId}`,
        'chainId',
      );
    }
    this.contracts = contracts;
    this.v2Router = new Contract(contracts.v2Router, V2_ROUTER_ABI, this.provider);
    this.v3Quoter = new Contract(contracts.quoterV2, V3_QUOTER_ABI, this.provider);
    this.v2Factory = new Contract(contracts.v2Factory, V2_FACTORY_ABI, this.provider);
    this.v3Factory = new Contract(contracts.v3Factory, V3_FACTORY_ABI, this.provider);
  }

  // ---- Wallet Management ---------------------------------------------------

  /** Connect a wallet for on-chain swap execution. */
  connectWallet(privateKey: string): void {
    this.wallet = new Wallet(privateKey, this.provider);
  }

  /** Get the connected wallet, or null. */
  getWallet(): Wallet | null {
    return this.wallet;
  }

  // ---- Quoting -------------------------------------------------------------

  /**
   * Get a V2 AMM quote via Router.getAmountsOut.
   * Tries direct path first, then falls back to two-hop through WBNB.
   *
   * @returns Quote result, or null if no V2 route exists
   */
  async getV2Quote(
    srcToken: DexToken,
    destToken: DexToken,
    srcAmount: string,
  ): Promise<PancakeSwapQuoteResult | null> {
    if (!this.useV2) return null;
    const tokenIn = this.resolveForDex(srcToken);
    const tokenOut = this.resolveForDex(destToken);
    const amountIn = BigInt(srcAmount);

    // Direct path
    try {
      const amounts: bigint[] = await this.v2Router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
      return {
        version: 'v2',
        amountOut: amounts[amounts.length - 1]!,
        path: [tokenIn, tokenOut],
        estimatedGasUnits: V2_SWAP_GAS,
      };
    } catch {
      // Direct pair does not exist
    }

    // Two-hop via WBNB
    const wbnb = this.contracts.wbnb;
    if (
      tokenIn.toLowerCase() !== wbnb.toLowerCase() &&
      tokenOut.toLowerCase() !== wbnb.toLowerCase()
    ) {
      try {
        const amounts: bigint[] = await this.v2Router.getAmountsOut(
          amountIn, [tokenIn, wbnb, tokenOut],
        );
        return {
          version: 'v2',
          amountOut: amounts[amounts.length - 1]!,
          path: [tokenIn, wbnb, tokenOut],
          estimatedGasUnits: V2_SWAP_GAS * 2n,
        };
      } catch {
        // No two-hop route
      }
    }
    return null;
  }

  /**
   * Get the best V3 quote across all fee tiers.
   * Uses QuoterV2.quoteExactInputSingle via staticCall.
   *
   * @returns Best V3 quote, or null if no pool has liquidity
   */
  async getV3Quote(
    srcToken: DexToken,
    destToken: DexToken,
    srcAmount: string,
  ): Promise<PancakeSwapQuoteResult | null> {
    if (!this.useV3) return null;
    const tokenIn = this.resolveForDex(srcToken);
    const tokenOut = this.resolveForDex(destToken);
    const amountIn = BigInt(srcAmount);
    let best: PancakeSwapQuoteResult | null = null;

    const attempts = V3_FEE_TIERS.map(async (feeTier) => {
      try {
        const result = await this.v3Quoter.quoteExactInputSingle.staticCall({
          tokenIn,
          tokenOut,
          amountIn,
          fee: feeTier,
          sqrtPriceLimitX96: 0n,
        });
        const amountOut = result[0] as bigint;
        const gasEstimate = result[3] as bigint;
        return {
          version: 'v3' as const,
          amountOut,
          path: [tokenIn, tokenOut],
          feeTier,
          estimatedGasUnits: gasEstimate > 0n ? gasEstimate : V3_SWAP_GAS,
        } satisfies PancakeSwapQuoteResult;
      } catch {
        return null;
      }
    });

    const results = await Promise.allSettled(attempts);
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value !== null) {
        if (!best || r.value.amountOut > best.amountOut) {
          best = r.value;
        }
      }
    }
    return best;
  }

  /**
   * Get the best quote across both V2 and V3.
   * Queries in parallel, returns whichever has the highest output.
   */
  async getBestQuote(
    srcToken: DexToken,
    destToken: DexToken,
    srcAmount: string,
  ): Promise<PancakeSwapQuoteResult | null> {
    const [v2, v3] = await Promise.all([
      this.getV2Quote(srcToken, destToken, srcAmount),
      this.getV3Quote(srcToken, destToken, srcAmount),
    ]);
    if (!v2 && !v3) return null;
    if (!v2) return v3;
    if (!v3) return v2;
    return v2.amountOut >= v3.amountOut ? v2 : v3;
  }

  // ---- Pool Discovery ------------------------------------------------------

  /**
   * Discover all PancakeSwap pools (V2 + V3) for a token pair.
   *
   * @returns Array of discovered pools (may be empty)
   */
  async discoverPools(tokenA: DexToken, tokenB: DexToken): Promise<PancakeSwapPool[]> {
    const addrA = this.resolveForDex(tokenA);
    const addrB = this.resolveForDex(tokenB);
    const pools: PancakeSwapPool[] = [];

    // V2 pair
    if (this.useV2) {
      try {
        const pairAddress: string = await this.v2Factory.getPair(addrA, addrB);
        if (pairAddress !== ZERO_ADDR) {
          const pair = new Contract(pairAddress, V2_PAIR_ABI, this.provider);
          const [reserve0, reserve1] = await pair.getReserves();
          const token0Addr: string = (await pair.token0() as string).toLowerCase();
          const isAToken0 = token0Addr === addrA.toLowerCase();
          pools.push({
            address: pairAddress,
            version: 'v2',
            token0: isAToken0 ? tokenA : tokenB,
            token1: isAToken0 ? tokenB : tokenA,
            reserve0: (reserve0 as bigint).toString(),
            reserve1: (reserve1 as bigint).toString(),
          });
        }
      } catch {
        // V2 discovery failed
      }
    }

    // V3 pools (one per fee tier)
    if (this.useV3) {
      const v3Attempts = V3_FEE_TIERS.map(async (fee) => {
        try {
          const poolAddress: string = await this.v3Factory.getPool(addrA, addrB, fee);
          if (poolAddress === ZERO_ADDR) return null;
          const pool = new Contract(poolAddress, V3_POOL_ABI, this.provider);
          const [slot0Result, token0Addr] = await Promise.all([
            pool.slot0(),
            pool.token0() as Promise<string>,
          ]);
          const sqrtPriceX96 = slot0Result[0] as bigint;
          const tick = Number(slot0Result[1]);
          const isAToken0 = (token0Addr as string).toLowerCase() === addrA.toLowerCase();
          return {
            address: poolAddress,
            version: 'v3' as const,
            token0: isAToken0 ? tokenA : tokenB,
            token1: isAToken0 ? tokenB : tokenA,
            feeBps: fee,
            sqrtPriceX96: sqrtPriceX96.toString(),
            tick,
          } satisfies PancakeSwapPool;
        } catch {
          return null;
        }
      });
      const settled = await Promise.allSettled(v3Attempts);
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value !== null) {
          pools.push(r.value);
        }
      }
    }
    return pools;
  }

  // ---- Gas and Price Helpers -----------------------------------------------

  /** Get (cached) gas price from the provider. */
  async getGasPrice(): Promise<bigint> {
    if (this.gasPriceCache && Date.now() - this.gasPriceCache.timestamp < CACHE_TTL_MS) {
      return this.gasPriceCache.price;
    }
    try {
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice ?? DEFAULT_GAS_PRICE;
      this.gasPriceCache = { price: gasPrice, timestamp: Date.now() };
      return gasPrice;
    } catch {
      return this.gasPriceCache?.price ?? DEFAULT_GAS_PRICE;
    }
  }

  /** Get (cached) BNB price in USD via WBNB/USDT V2 pair. */
  async getBnbPriceUsd(): Promise<number> {
    if (this.bnbPriceCache && Date.now() - this.bnbPriceCache.timestamp < CACHE_TTL_MS) {
      return this.bnbPriceCache.price;
    }
    try {
      const oneBnb = 10n ** 18n;
      const amounts: bigint[] = await this.v2Router.getAmountsOut(
        oneBnb, [this.contracts.wbnb, BNB_CHAIN_TOKENS.USDT.address],
      );
      const price = Number(fromWei(amounts[1]!.toString(), BNB_CHAIN_TOKENS.USDT.decimals));
      this.bnbPriceCache = { price, timestamp: Date.now() };
      return price;
    } catch {
      return this.bnbPriceCache?.price ?? DEFAULT_BNB_PRICE_USD;
    }
  }

  /**
   * Get amount of destToken per 1 BNB via PancakeSwap V2.
   * Used for converting gas costs into destination token terms.
   *
   * @returns Amount of destToken in wei per 1 BNB, or 0n on failure
   */
  async getDestTokenPerBnb(destToken: DexToken): Promise<bigint> {
    const destAddr = this.resolveForDex(destToken);
    if (destAddr.toLowerCase() === this.contracts.wbnb.toLowerCase()) {
      return 10n ** BigInt(destToken.decimals);
    }
    try {
      const oneBnb = 10n ** 18n;
      const amounts: bigint[] = await this.v2Router.getAmountsOut(
        oneBnb, [this.contracts.wbnb, destAddr],
      );
      return amounts[1]!;
    } catch {
      return 0n;
    }
  }

  // ---- Swap Execution ------------------------------------------------------

  /**
   * Execute a V2 Router swap on-chain.
   *
   * Requires a connected wallet (see connectWallet).
   * The caller must ensure the input token is approved to the V2 Router
   * before calling this method (unless the input is native BNB).
   *
   * @param srcToken     Input token
   * @param destToken    Output token
   * @param srcAmount    Input amount in wei (string)
   * @param minAmountOut Minimum acceptable output (apply slippage first)
   * @param recipient    Address to receive output tokens
   * @param deadline     Unix timestamp (seconds) after which the tx reverts
   * @param path         Optional explicit swap path; defaults to direct route
   */
  async executeSwapV2(
    srcToken: DexToken,
    destToken: DexToken,
    srcAmount: string,
    minAmountOut: string,
    recipient: string,
    deadline: number,
    path?: string[],
  ): Promise<SwapExecutionResult> {
    if (!this.wallet) {
      throw new ValidationError(
        'Wallet not connected. Call connectWallet(privateKey) first.',
        'wallet',
      );
    }

    const swapPath = path ?? [this.resolveForDex(srcToken), this.resolveForDex(destToken)];
    const router = new Contract(this.contracts.v2Router, V2_ROUTER_ABI, this.wallet);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let tx: any;

      if (srcToken.isNative) {
        tx = await router.swapExactETHForTokens(
          BigInt(minAmountOut), swapPath, recipient, deadline,
          { value: BigInt(srcAmount) },
        );
      } else if (destToken.isNative) {
        tx = await router.swapExactTokensForETH(
          BigInt(srcAmount), BigInt(minAmountOut), swapPath, recipient, deadline,
        );
      } else {
        tx = await router.swapExactTokensForTokens(
          BigInt(srcAmount), BigInt(minAmountOut), swapPath, recipient, deadline,
        );
      }

      const receipt = await tx.wait();
      return {
        txHash: tx.hash as string,
        success: receipt !== null && receipt.status === 1,
        gasUsed: receipt?.gasUsed?.toString() ?? '0',
      };
    } catch (err) {
      if (err instanceof DeluthiumError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      return {
        txHash: '',
        success: false,
        gasUsed: '0',
        error: `PancakeSwap V2 swap failed: ${message}`,
      };
    }
  }

  // ---- Accessors -----------------------------------------------------------

  /** Resolve a DexToken to the address PancakeSwap expects (native to WBNB). */
  resolveForDex(token: DexToken): string {
    return token.isNative ? this.contracts.wbnb : token.address;
  }

  /** Get the underlying ethers provider. */
  getProvider(): JsonRpcProvider {
    return this.provider;
  }

  /** Get PancakeSwap contract addresses for the current chain. */
  getContracts(): PancakeSwapContracts {
    return this.contracts;
  }

  /** Get the chain ID this client is configured for. */
  getChainId(): number {
    return this.chainId;
  }
}
