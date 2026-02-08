import type { TypedDataDomain, TypedDataField } from 'ethers';
import type {
  AdapterConfig,
  DeluthiumQuote,
  ISigner,
  OneInchOrderV4,
  OneInchRfqOrder,
  SignedOneInchOrder,
} from './types.js';
import { ORDER_TYPES } from './types.js';
import {
  getChainConfig,
  getOneInchDomain,
  getWrappedNativeToken,
  ZERO_ADDRESS,
} from './constants.js';
import { ConfigurationError, SignatureError } from './errors.js';
import { normalizeAddress, isNativeTokenAddress } from './address.js';
import { MakerTraits } from './MakerTraits.js';
import { NonceManager, getDefaultNonceManager } from './NonceManager.js';
import { assertValidDeluthiumQuote, assertValidOneInchOrder } from './validation.js';
import { computeOrderHash, compactSignature } from './utils.js';

/**
 * Main adapter that converts Deluthium quotes into signed 1inch Limit-Order V4
 * orders ready for on-chain submission.
 */
export class DeluthiumAdapter {
  private readonly chainId: number;
  private readonly mmVaultAddress: string;
  private readonly signer: ISigner;
  private readonly allowedTaker: string;
  private readonly enableNativeUnwrap: boolean;
  private nonceManager: NonceManager;

  constructor(config: AdapterConfig) {
    // Validate chain
    getChainConfig(config.chainId); // throws if unsupported

    if (!config.mmVaultAddress) {
      throw new ConfigurationError('mmVaultAddress is required');
    }
    if (!config.signer) {
      throw new ConfigurationError('signer is required');
    }

    this.chainId = config.chainId;
    this.mmVaultAddress = normalizeAddress(config.mmVaultAddress, 'mmVaultAddress');
    this.signer = config.signer;
    this.allowedTaker = config.allowedTaker
      ? normalizeAddress(config.allowedTaker, 'allowedTaker')
      : ZERO_ADDRESS;
    this.enableNativeUnwrap = config.enableNativeUnwrap ?? false;
    this.nonceManager = getDefaultNonceManager();
  }

  // ── Order Building ───────────────────────────────────────────────────────

  /**
   * Converts a Deluthium quote into a 1inch V4 order (unsigned).
   */
  async buildOneInchOrderFromDeluthium(quote: DeluthiumQuote): Promise<OneInchOrderV4> {
    assertValidDeluthiumQuote(quote);

    const makerAddress = await this.signer.getAddress();

    // Resolve token addresses – replace native sentinel with wrapped
    const makerAsset = isNativeTokenAddress(quote.outputToken)
      ? getWrappedNativeToken(this.chainId)
      : normalizeAddress(quote.outputToken, 'outputToken');

    const takerAsset = isNativeTokenAddress(quote.inputToken)
      ? getWrappedNativeToken(this.chainId)
      : normalizeAddress(quote.inputToken, 'inputToken');

    // Build maker traits
    const expiration = BigInt(quote.deadline);
    const nonce = this.nonceManager.getNextNonce(makerAddress);

    const traits = MakerTraits.forRfq(expiration, nonce);

    if (this.allowedTaker !== ZERO_ADDRESS) {
      traits.withAllowedSender(this.allowedTaker);
    }

    if (this.enableNativeUnwrap && isNativeTokenAddress(quote.outputToken)) {
      traits.enableNativeUnwrap();
    }

    // Generate salt
    const salt = NonceManager.generateSalt();

    const order: OneInchOrderV4 = {
      salt,
      maker: normalizeAddress(makerAddress),
      receiver: normalizeAddress(quote.to, 'to'),
      makerAsset,
      takerAsset,
      makingAmount: BigInt(quote.amountOut),
      takingAmount: BigInt(quote.amountIn),
      makerTraits: traits.asBigInt(),
    };

    assertValidOneInchOrder(order);
    return order;
  }

  /**
   * Signs a 1inch V4 order using the configured signer.
   */
  async signOneInchOrder(order: OneInchOrderV4): Promise<SignedOneInchOrder> {
    const domain: TypedDataDomain = getOneInchDomain(this.chainId);
    const types: Record<string, TypedDataField[]> = {
      Order: ORDER_TYPES.Order as unknown as TypedDataField[],
    };
    const values: Record<string, unknown> = {
      salt: order.salt,
      maker: order.maker,
      receiver: order.receiver,
      makerAsset: order.makerAsset,
      takerAsset: order.takerAsset,
      makingAmount: order.makingAmount,
      takingAmount: order.takingAmount,
      makerTraits: order.makerTraits,
    };

    let signature: string;
    try {
      signature = await this.signer.signTypedData(domain, types, values);
    } catch (err) {
      throw new SignatureError(
        `Failed to sign order: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const compact = compactSignature(signature);
    const orderHash = computeOrderHash(order, this.chainId);

    return { order, signature: compact, orderHash };
  }

  /**
   * One-step convenience: build + sign.
   */
  async buildAndSignOrder(quote: DeluthiumQuote): Promise<SignedOneInchOrder> {
    const order = await this.buildOneInchOrderFromDeluthium(quote);
    return this.signOneInchOrder(order);
  }

  /**
   * Builds a 1inch RFQ-specific order struct from a Deluthium quote.
   */
  async build1inchRfqOrder(quote: DeluthiumQuote): Promise<OneInchRfqOrder> {
    assertValidDeluthiumQuote(quote);

    const makerAddress = await this.signer.getAddress();

    const makerAsset = isNativeTokenAddress(quote.outputToken)
      ? getWrappedNativeToken(this.chainId)
      : normalizeAddress(quote.outputToken, 'outputToken');

    const takerAsset = isNativeTokenAddress(quote.inputToken)
      ? getWrappedNativeToken(this.chainId)
      : normalizeAddress(quote.inputToken, 'inputToken');

    const nonce = this.nonceManager.getNextNonce(makerAddress);

    return {
      makerAsset,
      takerAsset,
      makingAmount: BigInt(quote.amountOut),
      takingAmount: BigInt(quote.amountIn),
      maker: normalizeAddress(makerAddress),
      allowedSender: this.allowedTaker,
      expiration: BigInt(quote.deadline),
      nonce,
    };
  }

  /**
   * Validates a quote without building an order.
   */
  validateQuote(quote: DeluthiumQuote): void {
    assertValidDeluthiumQuote(quote);
  }

  // ── Accessors ────────────────────────────────────────────────────────────

  async getSignerAddress(): Promise<string> {
    return this.signer.getAddress();
  }

  getChainId(): number {
    return this.chainId;
  }

  getMmVaultAddress(): string {
    return this.mmVaultAddress;
  }

  getNonceManager(): NonceManager {
    return this.nonceManager;
  }

  setNonceManager(manager: NonceManager): void {
    this.nonceManager = manager;
  }

  advanceEpoch(): bigint {
    return this.nonceManager.advanceEpoch();
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a configured {@link DeluthiumAdapter} instance.
 */
export function createDeluthiumAdapter(config: AdapterConfig): DeluthiumAdapter {
  return new DeluthiumAdapter(config);
}
