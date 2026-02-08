/**
 * 0x-to-Deluthium API Proxy.
 *
 * Uses @deluthium/sdk RestClient instead of inline fetch calls,
 * addressing HIGH-02 (retry logic) and HIGH-05 (HTTP status handling).
 */

import {
  DeluthiumRestClient,
  type FirmQuoteRequest,
  type FirmQuoteResponse,
} from '@deluthium/sdk';

import type {
  ZeroExV4RFQOrder,
  AdapterConfig,
} from './types.js';
import { isNativeToken } from './transform.js';

/**
 * 0x to Deluthium API Proxy.
 *
 * High-level interface for MMs migrating from 0x Protocol:
 * 1. Submit orders in 0x format
 * 2. Automatically transform to Deluthium format
 * 3. Get firm quotes with calldata for on-chain execution
 *
 * Uses the SDK RestClient with built-in retry, timeout, and error handling.
 */
export class ZeroExToDarkPoolProxy {
  private apiClient: DeluthiumRestClient;
  private config: Required<Pick<AdapterConfig, 'chainId' | 'defaultSlippage' | 'defaultExpiryTimeSec'>> & AdapterConfig;

  constructor(config: AdapterConfig) {
    this.config = {
      defaultSlippage: 0.5,
      defaultExpiryTimeSec: 60,
      ...config,
    };

    // Use SDK RestClient (addresses HIGH-02: retry logic, HIGH-05: HTTP status handling)
    this.apiClient = new DeluthiumRestClient({
      auth: config.jwtToken,
      chainId: config.chainId,
    });
  }

  /**
   * Convert a 0x RFQ order to Deluthium firm quote request.
   */
  transformToFirmQuoteRequest(
    order: ZeroExV4RFQOrder,
    slippage?: number,
  ): FirmQuoteRequest {
    const chainId = this.config.chainId;
    const toAddress = !isNativeToken(order.taker) ? order.taker : order.txOrigin;

    return {
      src_chain_id: chainId,
      dst_chain_id: chainId,
      from_address: order.txOrigin,
      to_address: toAddress,
      token_in: order.takerToken,
      token_out: order.makerToken,
      amount_in: order.takerAmount,
      slippage: slippage ?? this.config.defaultSlippage,
      expiry_time_sec: this.config.defaultExpiryTimeSec,
    };
  }

  /**
   * Submit a 0x-style order and get a Deluthium firm quote.
   *
   * Main entry point for MMs migrating from 0x Protocol.
   * Accepts a 0x v4 RFQ order format and returns Deluthium calldata.
   */
  async submitOrder(
    order: ZeroExV4RFQOrder,
    slippage?: number,
  ): Promise<FirmQuoteResponse> {
    const request = this.transformToFirmQuoteRequest(order, slippage);
    return this.apiClient.getFirmQuote(request);
  }

  /**
   * Get an indicative quote using 0x-style parameters.
   */
  async getIndicativeQuote(
    takerToken: string,
    makerToken: string,
    takerAmount: string,
  ): Promise<{
    expectedMakerAmount: string;
    feeRate: number;
    feeAmount: string;
  }> {
    const response = await this.apiClient.getIndicativeQuote({
      src_chain_id: this.config.chainId,
      dst_chain_id: this.config.chainId,
      token_in: takerToken,
      token_out: makerToken,
      amount_in: takerAmount,
    });

    const data = response as unknown as Record<string, unknown>;
    return {
      expectedMakerAmount: String(data.amount_out ?? ''),
      feeRate: Number(data.fee_rate ?? 0),
      feeAmount: String(data.fee_amount ?? ''),
    };
  }
}
