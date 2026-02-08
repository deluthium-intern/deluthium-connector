/**
 * @deluthium/uniswapx-adapter - Filler Logic
 *
 * Core fill evaluation engine that determines whether a UniswapX order
 * is profitable to fill using Deluthium liquidity.
 *
 * Flow:
 * 1. Parse the order's current decay state
 * 2. Query Deluthium for a firm quote on the same pair
 * 3. Compare Deluthium's output vs the required output at current decay
 * 4. Factor in gas costs and minimum profit threshold
 * 5. Return a FillEvaluation with profit metrics
 */

import {
  DeluthiumRestClient,
  type IndicativeQuoteRequest,
  type IndicativeQuoteResponse,
  type ISigner,
} from '@deluthium/sdk';
import type {
  UniswapXOrder,
  DutchOrderV2,
  ExclusiveDutchOrder,
  PriorityOrder,
  FillEvaluation,
  UniswapXAdapterConfig,
} from './types.js';
import { computeCurrentOutput, computeCurrentInput, getOrderStatus } from './order-parser.js';
import { ReactorClient } from './reactor-client.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default minimum profit threshold: 10 bps (0.1%) */
const DEFAULT_MIN_PROFIT_BPS = 10;

// ─── Filler ─────────────────────────────────────────────────────────────────

/**
 * UniswapX order fill evaluator.
 *
 * Queries Deluthium for pricing and determines whether filling an order
 * is profitable after accounting for gas costs and minimum thresholds.
 */
export class UniswapXFiller {
  private readonly deluthiumClient: DeluthiumRestClient;
  private readonly reactorClient: ReactorClient;
  private readonly signer: ISigner;
  private readonly chainId: number;
  private readonly minProfitBps: number;
  constructor(config: UniswapXAdapterConfig) {
    this.deluthiumClient = new DeluthiumRestClient(config.deluthiumConfig);
    this.reactorClient = new ReactorClient(
      config.rpcUrl,
      config.chainId,
      config.reactorDeployment,
    );
    this.signer = config.signer;
    this.chainId = config.chainId;
    this.minProfitBps = config.minProfitBps ?? DEFAULT_MIN_PROFIT_BPS;
  }

  /**
   * Evaluate whether a UniswapX order is profitable to fill via Deluthium.
   *
   * @param order - UniswapX order to evaluate
   * @param currentTime - Optional current timestamp for testing
   * @returns Fill evaluation with profit metrics
   */
  async evaluate(order: UniswapXOrder, currentTime?: number): Promise<FillEvaluation> {
    // 1. Check if order is still valid
    const status = getOrderStatus(order, currentTime);
    if (status !== 'open') {
      return this.buildUnprofitableEvaluation(order, 0n, 0n, 0n, 'Order is not open');
    }

    // 2. Check exclusivity (for ExclusiveDutch orders)
    if (order.orderType === 'ExclusiveDutch') {
      const exclusiveOrder = order as ExclusiveDutchOrder;
      const now = currentTime ?? Math.floor(Date.now() / 1000);
      if (
        exclusiveOrder.exclusiveFiller !== '0x0000000000000000000000000000000000000000' &&
        now < exclusiveOrder.exclusivityEndTimestamp
      ) {
        // Check if we are the exclusive filler
        const ourAddress = await this.signer.getAddress();
        if (ourAddress.toLowerCase() !== exclusiveOrder.exclusiveFiller.toLowerCase()) {
          return this.buildUnprofitableEvaluation(order, 0n, 0n, 0n, 'Exclusive fill period active');
        }
      }
    }

    // 3. Compute current required amounts based on decay curve
    const { inputAmount, totalOutputAmount } = this.computeCurrentAmounts(order, currentTime);

    // 4. Get Deluthium indicative quote for the same pair
    const indicativeQuote = await this.getDeluthiumQuote(order, inputAmount);
    if (!indicativeQuote) {
      return this.buildUnprofitableEvaluation(order, 0n, totalOutputAmount, 0n, 'No Deluthium quote available');
    }

    const deluthiumAmountOut = BigInt(indicativeQuote.amount_out);

    // 5. Estimate gas costs
    const estimatedGasCost = await this.reactorClient.estimateGasCostWei(order);

    // 6. Calculate profit
    const profitWei = deluthiumAmountOut - totalOutputAmount;
    const netProfitWei = profitWei - estimatedGasCost;
    const profitBps = totalOutputAmount > 0n
      ? Number((profitWei * 10000n) / totalOutputAmount)
      : 0;

    // 7. Determine if profitable
    const profitable = profitBps >= this.minProfitBps && netProfitWei > 0n;

    return {
      profitable,
      order,
      deluthiumAmountOut,
      requiredAmountOut: totalOutputAmount,
      profitWei,
      profitBps,
      estimatedGasCost,
      netProfitWei,
    };
  }

  /**
   * Evaluate multiple orders and return only profitable ones, sorted by profit.
   *
   * @param orders - Array of UniswapX orders
   * @param currentTime - Optional current timestamp for testing
   * @returns Array of profitable evaluations, sorted by net profit (descending)
   */
  async evaluateBatch(orders: UniswapXOrder[], currentTime?: number): Promise<FillEvaluation[]> {
    const evaluations = await Promise.all(
      orders.map((order) => this.evaluate(order, currentTime)),
    );

    return evaluations
      .filter((e) => e.profitable)
      .sort((a, b) => {
        // Sort by net profit descending
        if (b.netProfitWei > a.netProfitWei) return 1;
        if (b.netProfitWei < a.netProfitWei) return -1;
        return 0;
      });
  }

  /**
   * Get the underlying Reactor client for executing fills.
   */
  getReactorClient(): ReactorClient {
    return this.reactorClient;
  }

  /**
   * Get the underlying Deluthium REST client.
   */
  getDeluthiumClient(): DeluthiumRestClient {
    return this.deluthiumClient;
  }

  // ─── Internal Methods ─────────────────────────────────────────────

  /**
   * Compute the current input and total output amounts based on order type and decay.
   */
  private computeCurrentAmounts(
    order: UniswapXOrder,
    currentTime?: number,
  ): { inputAmount: bigint; totalOutputAmount: bigint } {
    switch (order.orderType) {
      case 'DutchV2': {
        const dutchOrder = order as DutchOrderV2;
        const { decayStartTime, decayEndTime } = dutchOrder.cosignerData;

        const inputAmount = computeCurrentInput(
          dutchOrder.input,
          decayStartTime,
          decayEndTime,
          currentTime,
        );

        const totalOutputAmount = dutchOrder.outputs.reduce(
          (sum, output) =>
            sum + computeCurrentOutput(output, decayStartTime, decayEndTime, currentTime),
          0n,
        );

        return { inputAmount, totalOutputAmount };
      }

      case 'ExclusiveDutch': {
        const exclusiveOrder = order as ExclusiveDutchOrder;
        const { decayStartTime, decayEndTime } = exclusiveOrder;

        const inputAmount = computeCurrentInput(
          exclusiveOrder.input,
          decayStartTime,
          decayEndTime,
          currentTime,
        );

        const totalOutputAmount = exclusiveOrder.outputs.reduce(
          (sum, output) =>
            sum + computeCurrentOutput(output, decayStartTime, decayEndTime, currentTime),
          0n,
        );

        return { inputAmount, totalOutputAmount };
      }

      case 'Priority': {
        const priorityOrder = order as PriorityOrder;
        // Priority orders don't have time-based decay -- use start amounts
        return {
          inputAmount: priorityOrder.input.startAmount,
          totalOutputAmount: priorityOrder.outputs.reduce(
            (sum, output) => sum + output.startAmount,
            0n,
          ),
        };
      }
    }
  }

  /**
   * Query Deluthium for an indicative quote matching the order's trade.
   */
  private async getDeluthiumQuote(
    order: UniswapXOrder,
    inputAmount: bigint,
  ): Promise<IndicativeQuoteResponse | null> {
    try {
      // For UniswapX, swapper sells input token and wants output token
      // As a filler, we provide the output token and receive the input token
      // So we query Deluthium: "If I sell [input token], how much [output token] do I get?"
      const primaryOutput = order.outputs[0];
      if (!primaryOutput) return null;

      const request: IndicativeQuoteRequest = {
        src_chain_id: this.chainId,
        dst_chain_id: this.chainId,
        token_in: order.input.token,
        token_out: primaryOutput.token,
        amount_in: inputAmount.toString(),
      };

      return await this.deluthiumClient.getIndicativeQuote(request);
    } catch {
      return null;
    }
  }

  /**
   * Build an unprofitable evaluation result.
   */
  private buildUnprofitableEvaluation(
    order: UniswapXOrder,
    deluthiumAmountOut: bigint,
    requiredAmountOut: bigint,
    estimatedGasCost: bigint,
    _reason: string,
  ): FillEvaluation {
    const profitWei = deluthiumAmountOut - requiredAmountOut;
    return {
      profitable: false,
      order,
      deluthiumAmountOut,
      requiredAmountOut,
      profitWei,
      profitBps: requiredAmountOut > 0n
        ? Number((profitWei * 10000n) / requiredAmountOut)
        : 0,
      estimatedGasCost,
      netProfitWei: profitWei - estimatedGasCost,
    };
  }
}
