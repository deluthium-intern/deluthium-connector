/**
 * @deluthium/binance-dex-adapter - Price Comparator
 *
 * Fetches quotes from both Deluthium RFQ and PancakeSwap AMM pools,
 * compares effective prices net of gas costs, and identifies the
 * best execution venue for a given trade.
 */

import { DeluthiumRestClient } from '@deluthium/sdk';
import { fromWei } from '@deluthium/sdk';
import { DeluthiumError } from '@deluthium/sdk';
import type {
  DexToken,
  PriceComparison,
  PriceSource,
  SourceQuote,
} from './types.js';
import type { PancakeSwapClient, PancakeSwapQuoteResult } from './pancakeswap-client.js';

/** Estimated gas units for a Deluthium RFQ on-chain settlement. */
const DELUTHIUM_GAS_ESTIMATE = 120_000n;

/**
 * Compares prices between Deluthium RFQ and PancakeSwap AMM.
 *
 * For each quote source the comparator computes:
 * - Effective price (dest / src, human-readable)
 * - Gas cost in native token (BNB) and USD
 * - Net output after deducting gas costs
 */
export class PriceComparator {
  private readonly pancakeSwap: PancakeSwapClient;
  private readonly deluthium: DeluthiumRestClient;
  private readonly chainId: number;

  constructor(options: {
    pancakeSwap: PancakeSwapClient;
    deluthium: DeluthiumRestClient;
    chainId: number;
  }) {
    this.pancakeSwap = options.pancakeSwap;
    this.deluthium = options.deluthium;
    this.chainId = options.chainId;
  }

  /**
   * Fetch quotes from all available sources and compare them.
   *
   * Queries Deluthium indicative quote, PancakeSwap V2 and V3 in parallel.
   * Computes net output for each source and selects the best one.
   *
   * @param srcToken  Source token
   * @param destToken Destination token
   * @param srcAmount Input amount in wei (string)
   * @returns PriceComparison with all quotes sorted by net output
   * @throws {DeluthiumError} if no quotes from any source
   */
  async compare(
    srcToken: DexToken,
    destToken: DexToken,
    srcAmount: string,
  ): Promise<PriceComparison> {
    const [
      deluthiumQuote,
      pcsQuotes,
      gasPrice,
      bnbPriceUsd,
      destPerBnb,
    ] = await Promise.all([
      this.getDeluthiumQuote(srcToken, destToken, srcAmount),
      this.getPancakeSwapQuotes(srcToken, destToken, srcAmount),
      this.pancakeSwap.getGasPrice(),
      this.pancakeSwap.getBnbPriceUsd(),
      this.pancakeSwap.getDestTokenPerBnb(destToken),
    ]);

    const allQuotes: SourceQuote[] = [];

    if (deluthiumQuote) {
      const expiresAt = deluthiumQuote.timestamp + (deluthiumQuote.validForMs ?? 30_000);
      allQuotes.push(
        this.buildSourceQuote(
          'deluthium', srcToken, destToken, srcAmount,
          deluthiumQuote.amountOut, DELUTHIUM_GAS_ESTIMATE,
          gasPrice, bnbPriceUsd, destPerBnb, expiresAt,
        ),
      );
    }

    for (const pcsQuote of pcsQuotes) {
      const source: PriceSource =
        pcsQuote.version === 'v2' ? 'pancakeswap_v2' : 'pancakeswap_v3';
      allQuotes.push(
        this.buildSourceQuote(
          source, srcToken, destToken, srcAmount,
          pcsQuote.amountOut.toString(), pcsQuote.estimatedGasUnits,
          gasPrice, bnbPriceUsd, destPerBnb,
        ),
      );
    }

    if (allQuotes.length === 0) {
      throw new DeluthiumError('No quotes available from any source');
    }

    allQuotes.sort(
      (a, b) => (BigInt(b.netDestAmount) > BigInt(a.netDestAmount) ? 1 : -1),
    );

    const bestQuote = allQuotes[0]!;
    const worstQuote = allQuotes[allQuotes.length - 1]!;
    const bestNet = BigInt(bestQuote.netDestAmount);
    const worstNet = BigInt(worstQuote.netDestAmount);
    const spreadBps =
      worstNet > 0n ? Number(((bestNet - worstNet) * 10000n) / worstNet) : 0;

    return {
      srcToken,
      destToken,
      srcAmount,
      quotes: allQuotes,
      bestQuote,
      spreadBps,
      timestamp: Date.now(),
    };
  }

  /** Get a Deluthium indicative quote. Returns null on failure. */
  private async getDeluthiumQuote(
    srcToken: DexToken,
    destToken: DexToken,
    srcAmount: string,
  ): Promise<{ amountOut: string; timestamp: number; validForMs?: number } | null> {
    try {
      const response = await this.deluthium.getIndicativeQuote({
        src_chain_id: this.chainId,
        dst_chain_id: this.chainId,
        token_in: srcToken.address,
        token_out: destToken.address,
        amount_in: srcAmount,
      });
      return {
        amountOut: response.amount_out,
        timestamp: response.timestamp,
        validForMs: response.valid_for_ms,
      };
    } catch {
      return null;
    }
  }

  /** Get PancakeSwap quotes (V2 and V3 in parallel). */
  private async getPancakeSwapQuotes(
    srcToken: DexToken,
    destToken: DexToken,
    srcAmount: string,
  ): Promise<PancakeSwapQuoteResult[]> {
    const [v2, v3] = await Promise.all([
      this.pancakeSwap.getV2Quote(srcToken, destToken, srcAmount).catch(() => null),
      this.pancakeSwap.getV3Quote(srcToken, destToken, srcAmount).catch(() => null),
    ]);
    const results: PancakeSwapQuoteResult[] = [];
    if (v2) results.push(v2);
    if (v3) results.push(v3);
    return results;
  }

  /**
   * Build a fully-populated SourceQuote from raw data.
   */
  private buildSourceQuote(
    source: PriceSource,
    srcToken: DexToken,
    destToken: DexToken,
    srcAmount: string,
    destAmount: string,
    gasUnits: bigint,
    gasPrice: bigint,
    bnbPriceUsd: number,
    destPerBnb: bigint,
    expiresAt?: number,
  ): SourceQuote {
    const gasCostWei = gasUnits * gasPrice;
    const gasCostBnb = Number(gasCostWei) / 1e18;
    const gasCostUsd = gasCostBnb * bnbPriceUsd;
    const gasCostInDestWei =
      destPerBnb > 0n ? (gasCostWei * destPerBnb) / (10n ** 18n) : 0n;

    const destBigInt = BigInt(destAmount);
    const netDestAmount =
      destBigInt > gasCostInDestWei ? destBigInt - gasCostInDestWei : 0n;

    const srcHuman = Number(fromWei(srcAmount, srcToken.decimals));
    const destHuman = Number(fromWei(destAmount, destToken.decimals));
    const effectivePrice = srcHuman > 0 ? (destHuman / srcHuman).toString() : '0';

    return {
      source, srcToken, destToken, srcAmount, destAmount,
      effectivePrice,
      gasCostWei: gasCostWei.toString(),
      gasCostUsd: gasCostUsd.toFixed(6),
      netDestAmount: netDestAmount.toString(),
      timestamp: Date.now(),
      valid: destBigInt > 0n,
      expiresAt,
    };
  }
}
