/**
 * @deluthium/binance-dex-adapter - Split Router
 *
 * Optimizes trade execution by splitting volume between Deluthium RFQ
 * and PancakeSwap AMM.  Uses a two-phase approach:
 *
 * 1. **Grid search** — evaluate 11 split fractions (0 %, 10 %, ... 100 %
 *    to Deluthium) in parallel.
 * 2. **Ternary search refinement** — narrow in on the optimal fraction
 *    around the best grid point with 5 iterations.
 *
 * The optimizer accounts for the additional gas overhead of executing
 * two legs instead of one, so it only recommends a split when the price
 * improvement outweighs the extra gas.
 */

import { applySlippage, calculateDeadline } from '@deluthium/sdk';
import { DeluthiumRestClient } from '@deluthium/sdk';
import type { ISigner } from '@deluthium/sdk';
import { ValidationError, DeluthiumError } from '@deluthium/sdk';
import type {
  DexToken,
  SplitAllocation,
  SplitRoute,
  SplitExecutionResult,
  AllocationExecution,
  PriceSource,
} from './types.js';
import type { PancakeSwapClient } from './pancakeswap-client.js';

// ---- Constants -------------------------------------------------------------

/** Estimated gas for a Deluthium RFQ on-chain settlement. */
const DELUTHIUM_GAS = 120_000n;

/** Number of grid points for the coarse search (0 % to 100 %). */
const GRID_SIZE = 11;

/** Number of ternary-search refinement iterations. */
const REFINE_ITERATIONS = 5;

/** Default swap deadline (seconds from now). */
const DEFAULT_DEADLINE_SEC = 300;

// ---- Internal Types --------------------------------------------------------

interface SplitEvaluation {
  fraction: number;
  totalOutput: bigint;
  totalGasUnits: bigint;
  allocations: SplitAllocation[];
}

// ---- SplitRouter -----------------------------------------------------------

/**
 * Finds and (optionally) executes the optimal split between Deluthium
 * RFQ and PancakeSwap AMM for a given trade.
 *
 * @example
 * ```ts
 * const router = new SplitRouter({
 *   pancakeSwap: pcsClient,
 *   deluthium: deluthiumClient,
 *   signer,
 *   chainId: 56,
 * });
 * const route = await router.computeOptimalSplit(srcToken, destToken, amount);
 * if (route.splitBeneficial) {
 *   console.log('Split improves output by', route.improvementBps, 'bps');
 * }
 * ```
 */
export class SplitRouter {
  private readonly pancakeSwap: PancakeSwapClient;
  private readonly deluthium: DeluthiumRestClient;
  private readonly signer: ISigner;
  private readonly chainId: number;
  private readonly minDeluthiumSplitBps: number;
  private readonly maxSlippageBps: number;

  /**
   * @param options.pancakeSwap         PancakeSwap client instance
   * @param options.deluthium           Deluthium REST client instance
   * @param options.signer              Signer for Deluthium firm quotes
   * @param options.chainId             Chain ID (default 56)
   * @param options.minDeluthiumSplitBps Minimum Deluthium allocation in bps (default 1000 = 10 %)
   * @param options.maxSlippageBps      Maximum slippage tolerance in bps (default 50 = 0.5 %)
   */
  constructor(options: {
    pancakeSwap: PancakeSwapClient;
    deluthium: DeluthiumRestClient;
    signer: ISigner;
    chainId: number;
    minDeluthiumSplitBps?: number;
    maxSlippageBps?: number;
  }) {
    this.pancakeSwap = options.pancakeSwap;
    this.deluthium = options.deluthium;
    this.signer = options.signer;
    this.chainId = options.chainId;
    this.minDeluthiumSplitBps = options.minDeluthiumSplitBps ?? 1000;
    this.maxSlippageBps = options.maxSlippageBps ?? 50;
  }

  // ---- Route Computation ---------------------------------------------------

  /**
   * Find the optimal split between Deluthium and PancakeSwap.
   *
   * Phase 1 — grid search at 0 %, 10 %, ... 100 % Deluthium allocation.
   * Phase 2 — ternary-search refinement around the best grid point.
   *
   * Returns a SplitRoute that describes the optimal allocation.  Check
   * `route.splitBeneficial` to determine if splitting actually helps
   * compared to the best single-source execution.
   */
  async computeOptimalSplit(
    srcToken: DexToken,
    destToken: DexToken,
    totalSrcAmount: string,
  ): Promise<SplitRoute> {
    const totalAmount = BigInt(totalSrcAmount);
    if (totalAmount <= 0n) {
      throw new ValidationError('totalSrcAmount must be positive', 'totalSrcAmount');
    }

    const [gasPrice, destPerBnb] = await Promise.all([
      this.pancakeSwap.getGasPrice(),
      this.pancakeSwap.getDestTokenPerBnb(destToken),
    ]);

    const minFraction = this.minDeluthiumSplitBps / 10_000;

    // ---- Phase 1: Grid search ----------------------------------------------
    const gridFractions: number[] = [];
    for (let i = 0; i < GRID_SIZE; i++) {
      const f = i / (GRID_SIZE - 1);
      // Skip fractions below the minimum (except the extremes 0 and 1)
      if (f > 0 && f < 1 && f < minFraction) continue;
      if (f > 0 && f < 1 && (1 - f) < minFraction) continue;
      gridFractions.push(f);
    }

    const gridPromises = gridFractions.map(async (fraction) => {
      const evaluation = await this.evaluateSplit(
        srcToken, destToken, totalAmount, fraction,
      );
      return { fraction, evaluation };
    });
    const gridSettled = await Promise.allSettled(gridPromises);

    const gridResults: SplitEvaluation[] = [];
    for (const r of gridSettled) {
      if (r.status === 'fulfilled' && r.value.evaluation) {
        gridResults.push(r.value.evaluation);
      }
    }

    if (gridResults.length === 0) {
      throw new DeluthiumError('Could not obtain quotes at any split fraction');
    }

    // Compute net output (output minus gas cost in dest token)
    const netOf = (ev: SplitEvaluation): bigint => {
      const gasCostDest = destPerBnb > 0n
        ? (ev.totalGasUnits * gasPrice * destPerBnb) / (10n ** 18n)
        : 0n;
      return ev.totalOutput - gasCostDest;
    };

    let bestEval = gridResults[0]!;
    let bestNet = netOf(bestEval);
    for (const ev of gridResults) {
      const net = netOf(ev);
      if (net > bestNet) {
        bestNet = net;
        bestEval = ev;
      }
    }

    // ---- Phase 2: Ternary-search refinement --------------------------------
    const step = 1 / (GRID_SIZE - 1);
    let lo = Math.max(0, bestEval.fraction - step);
    let hi = Math.min(1, bestEval.fraction + step);

    for (let iter = 0; iter < REFINE_ITERATIONS; iter++) {
      const mid1 = lo + (hi - lo) / 3;
      const mid2 = hi - (hi - lo) / 3;

      const [ev1, ev2] = await Promise.all([
        this.evaluateSplit(srcToken, destToken, totalAmount, mid1),
        this.evaluateSplit(srcToken, destToken, totalAmount, mid2),
      ]);

      const net1 = ev1 ? netOf(ev1) : -1n;
      const net2 = ev2 ? netOf(ev2) : -1n;

      if (net1 > bestNet && ev1) { bestNet = net1; bestEval = ev1; }
      if (net2 > bestNet && ev2) { bestNet = net2; bestEval = ev2; }

      if (net1 > net2) { hi = mid2; } else { lo = mid1; }
    }

    // ---- Build result ------------------------------------------------------
    const totalGasCostWei = bestEval.totalGasUnits * gasPrice;
    const gasCostDest = destPerBnb > 0n
      ? (totalGasCostWei * destPerBnb) / (10n ** 18n)
      : 0n;
    const netDestAmount = bestEval.totalOutput > gasCostDest
      ? bestEval.totalOutput - gasCostDest
      : 0n;

    // Find the best single-source net output for comparison
    const singleSourceEvals = gridResults.filter(
      (ev) => ev.fraction === 0 || ev.fraction === 1,
    );
    let bestSingleNet = 0n;
    for (const ev of singleSourceEvals) {
      const net = netOf(ev);
      if (net > bestSingleNet) bestSingleNet = net;
    }

    const improvementBps = bestSingleNet > 0n
      ? Number(((bestNet - bestSingleNet) * 10000n) / bestSingleNet)
      : 0;

    return {
      srcToken,
      destToken,
      totalSrcAmount,
      totalDestAmount: bestEval.totalOutput.toString(),
      allocations: bestEval.allocations,
      totalGasCostWei: totalGasCostWei.toString(),
      netDestAmount: netDestAmount.toString(),
      improvementBps,
      splitBeneficial: improvementBps > 0,
      timestamp: Date.now(),
    };
  }

  // ---- Route Execution -----------------------------------------------------

  /**
   * Execute a previously computed split route.
   *
   * For each allocation:
   * - **Deluthium**: requests a firm quote and, if a wallet is connected
   *   to the PancakeSwap client, sends the settlement transaction.
   * - **PancakeSwap**: executes a V2 swap via the connected wallet.
   *
   * @param route The SplitRoute to execute
   * @returns Execution result with per-allocation details
   * @throws {ValidationError} if a wallet is required but not connected
   */
  async executeSplit(route: SplitRoute): Promise<SplitExecutionResult> {
    const wallet = this.pancakeSwap.getWallet();
    const signerAddress = await this.signer.getAddress();
    const slippagePct = this.maxSlippageBps / 100;
    const deadline = calculateDeadline(DEFAULT_DEADLINE_SEC);
    const executions: AllocationExecution[] = [];
    let totalActualOutput = 0n;

    for (const allocation of route.allocations) {
      if (allocation.source === 'deluthium') {
        // ---- Deluthium leg ---------------------------------------------------
        try {
          const firmQuote = await this.deluthium.getFirmQuote({
            src_chain_id: this.chainId,
            dst_chain_id: this.chainId,
            from_address: signerAddress,
            to_address: signerAddress,
            token_in: route.srcToken.address,
            token_out: route.destToken.address,
            amount_in: allocation.srcAmount,
            slippage: slippagePct,
            expiry_time_sec: DEFAULT_DEADLINE_SEC,
          });

          let txHash: string | undefined;
          if (wallet) {
            const tx = await wallet.sendTransaction({
              to: firmQuote.router_address,
              data: firmQuote.calldata,
              value: route.srcToken.isNative ? BigInt(allocation.srcAmount) : 0n,
            });
            const receipt = await tx.wait();
            txHash = tx.hash;
            if (!receipt || receipt.status !== 1) {
              executions.push({
                allocation, actualOutput: '0', success: false,
                txHash, error: 'Deluthium settlement tx reverted',
              });
              continue;
            }
          }

          totalActualOutput += BigInt(firmQuote.amount_out);
          executions.push({
            allocation, actualOutput: firmQuote.amount_out,
            success: true, txHash,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          executions.push({
            allocation, actualOutput: '0', success: false,
            error: `Deluthium execution failed: ${msg}`,
          });
        }
      } else {
        // ---- PancakeSwap leg -------------------------------------------------
        if (!wallet) {
          executions.push({
            allocation, actualOutput: '0', success: false,
            error: 'Wallet not connected for PancakeSwap execution',
          });
          continue;
        }
        try {
          const minOut = applySlippage(allocation.destAmount, slippagePct);
          const result = await this.pancakeSwap.executeSwapV2(
            route.srcToken, route.destToken,
            allocation.srcAmount, minOut,
            await wallet.getAddress(), deadline,
          );

          if (result.success) {
            totalActualOutput += BigInt(allocation.destAmount);
            executions.push({
              allocation, actualOutput: allocation.destAmount,
              success: true, txHash: result.txHash,
            });
          } else {
            executions.push({
              allocation, actualOutput: '0', success: false,
              txHash: result.txHash, error: result.error,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          executions.push({
            allocation, actualOutput: '0', success: false,
            error: `PancakeSwap execution failed: ${msg}`,
          });
        }
      }
    }

    const expectedTotal = BigInt(route.totalDestAmount);
    const realizedSlippageBps = expectedTotal > 0n
      ? Number(((expectedTotal - totalActualOutput) * 10000n) / expectedTotal)
      : 0;

    // Gas used is tracked per-execution; sum not available without receipt data
    const totalGasUsed = '0';

    return {
      route,
      executions,
      totalActualOutput: totalActualOutput.toString(),
      realizedSlippageBps,
      totalGasUsed,
      success: executions.every((e) => e.success),
      executedAt: Date.now(),
    };
  }

  // ---- Private: Split Evaluation -------------------------------------------

  /**
   * Evaluate a specific split fraction.
   *
   * @param srcToken       Input token
   * @param destToken      Output token
   * @param totalAmount    Total input in wei (bigint)
   * @param deluthiumFrac  Fraction allocated to Deluthium (0 to 1)
   * @returns Evaluation result, or null if quotes failed
   */
  private async evaluateSplit(
    srcToken: DexToken,
    destToken: DexToken,
    totalAmount: bigint,
    deluthiumFrac: number,
  ): Promise<SplitEvaluation | null> {
    const allocations: SplitAllocation[] = [];
    let totalOutput = 0n;
    let totalGasUnits = 0n;

    // Deluthium portion
    if (deluthiumFrac > 0) {
      const delAmount = (totalAmount * BigInt(Math.round(deluthiumFrac * 10000))) / 10000n;
      if (delAmount <= 0n) return null;

      try {
        const quote = await this.deluthium.getIndicativeQuote({
          src_chain_id: this.chainId,
          dst_chain_id: this.chainId,
          token_in: srcToken.address,
          token_out: destToken.address,
          amount_in: delAmount.toString(),
        });
        totalOutput += BigInt(quote.amount_out);
        totalGasUnits += DELUTHIUM_GAS;
        allocations.push({
          source: 'deluthium',
          fraction: deluthiumFrac,
          srcAmount: delAmount.toString(),
          destAmount: quote.amount_out,
        });
      } catch {
        return null;
      }
    }

    // PancakeSwap portion
    const pcsFrac = 1 - deluthiumFrac;
    if (pcsFrac > 0) {
      const pcsAmount = totalAmount - (
        allocations.length > 0 ? BigInt(allocations[0]!.srcAmount) : 0n
      );
      if (pcsAmount <= 0n) return null;

      const quote = await this.pancakeSwap.getBestQuote(
        srcToken, destToken, pcsAmount.toString(),
      );
      if (!quote) return null;

      const source: PriceSource =
        quote.version === 'v2' ? 'pancakeswap_v2' : 'pancakeswap_v3';
      totalOutput += quote.amountOut;
      totalGasUnits += quote.estimatedGasUnits;
      allocations.push({
        source,
        fraction: pcsFrac,
        srcAmount: pcsAmount.toString(),
        destAmount: quote.amountOut.toString(),
      });
    }

    return {
      fraction: deluthiumFrac,
      totalOutput,
      totalGasUnits,
      allocations,
    };
  }
}
