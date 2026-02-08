/**
 * @deluthium/paraswap-adapter - Swap Executor
 *
 * Builds and submits swap transactions through the Augustus Swapper contract.
 *
 * Flow:
 *  1. Caller provides a BuildTxRequest (token pair, amounts, sender, etc.).
 *  2. The executor requests a firm quote from Deluthium, which returns
 *     signed calldata for the Deluthium RFQ Manager.
 *  3. The executor encodes an outer transaction targeting the Augustus Swapper,
 *     wrapping the Deluthium calldata so that Augustus routes through our
 *     DeluthiumParaswapPool adapter contract on-chain.
 *  4. The caller receives a ready-to-sign BuiltTransaction.
 *
 * @packageDocumentation
 */

import { JsonRpcProvider, Contract, AbiCoder, type TransactionResponse } from 'ethers';

import {
  DeluthiumRestClient,
  normalizeAddress,
  isNativeToken,
  resolveTokenAddress,
  isExpired,
  retry,
  DeluthiumError,
  ValidationError,
  type ISigner,
  type FirmQuoteRequest,
  type FirmQuoteResponse,
} from '@deluthium/sdk';

import {
  AUGUSTUS_ADDRESSES,
  type ParaswapAdapterConfig,
  type BuildTxRequest,
  type BuiltTransaction,
  type ParaswapAdapterEvent,
  type SwapExecutedEvent,
} from './types.js';

// ---- Constants --------------------------------------------------------------

/** Default maximum slippage: 50 bps = 0.50 % */
const DEFAULT_MAX_SLIPPAGE_BPS = 50;

/** Default firm-quote expiry: 120 seconds */
const DEFAULT_QUOTE_EXPIRY_SEC = 120;

/** Default gas limit estimate for a Paraswap Augustus swap */
const DEFAULT_GAS_LIMIT = '350000';

// ---- Augustus Router ABI (minimal) -----------------------------------------

/**
 * Minimal ABI for the Augustus Swapper V6 swapOnCustom method.
 * This is the entry point Augustus uses to route through custom pool adapters.
 */
const AUGUSTUS_SWAP_ABI = [
  'function swapOnCustom(address fromToken, address toToken, uint256 fromAmount, uint256 toAmount, address[] callees, bytes exchangeData) external payable returns (uint256)',
];

// ABI for the on-chain DeluthiumParaswapPool adapter (used during deployment/integration)
// 'function swap(address fromToken, address toToken, uint256 fromAmount, uint256 toAmount, address beneficiary, bytes calldata rfqData) external payable returns (uint256 receivedAmount)'
// 'function getRate(address fromToken, address toToken, uint256 fromAmount) external view returns (uint256 toAmount)'

// ---- Executor Class ---------------------------------------------------------

/**
 * Executes swaps via the Augustus Swapper by obtaining firm quotes from
 * Deluthium and encoding the appropriate transaction calldata.
 *
 * @example
 * ```typescript
 * const executor = new Executor(config, client, emitter);
 *
 * const builtTx = await executor.buildTransaction({
 *   srcToken: '0xSRC',
 *   destToken: '0xDST',
 *   srcAmount: '1000000000000000000',
 *   destAmount: '2000000000',
 *   minDestAmount: '1980000000',
 *   sender: '0xUSER',
 *   receiver: '0xUSER',
 *   chainId: 56,
 *   deadline: Math.floor(Date.now() / 1000) + 300,
 * });
 * ```
 */
export class Executor {
  /** Deluthium REST client */
  private readonly client: DeluthiumRestClient;

  /** Signer for transaction submission */
  private readonly signer: ISigner;

  /** Chain ID */
  private readonly chainId: number;

  /** Augustus Swapper contract address */
  private readonly augustusAddress: string;

  /** Pool adapter contract address */
  private readonly poolAdapterAddress: string | undefined;

  /** Maximum slippage in basis points */
  private readonly maxSlippageBps: number;

  /** Event emitter callback */
  private readonly emit: (event: ParaswapAdapterEvent, data: unknown) => void;

  /**
   * Create a new Executor instance.
   *
   * @param config - Adapter configuration
   * @param client - Initialised Deluthium REST client
   * @param emit - Callback to emit adapter events
   */
  constructor(
    config: ParaswapAdapterConfig,
    client: DeluthiumRestClient,
    emit: (event: ParaswapAdapterEvent, data: unknown) => void,
  ) {
    this.client = client;
    this.signer = config.signer;
    this.chainId = config.chainId ?? config.deluthium.chainId;
    this.maxSlippageBps = config.maxSlippageBps ?? DEFAULT_MAX_SLIPPAGE_BPS;
    this.poolAdapterAddress = config.poolAdapterAddress;
    this.emit = emit;

    // Resolve Augustus address
    this.augustusAddress = config.augustusAddress ?? this.resolveAugustusAddress(this.chainId);
  }

  // ---- Public API -----------------------------------------------------------

  /**
   * Build a swap transaction targeting the Augustus Swapper.
   *
   * Steps:
   *  1. Validate the request.
   *  2. Request a firm quote from Deluthium.
   *  3. Encode the Augustus swapOnCustom calldata wrapping the firm quote.
   *  4. Return a BuiltTransaction ready for signing/submission.
   *
   * @param request - Transaction build parameters
   * @returns Ready-to-sign transaction
   * @throws ValidationError if input validation fails
   * @throws DeluthiumError if the firm quote request fails
   */
  async buildTransaction(request: BuildTxRequest): Promise<BuiltTransaction> {
    this.validateBuildRequest(request);

    // 1. Get firm quote from Deluthium
    const firmQuote = await this.getFirmQuote(request);

    // 2. Encode the Augustus swap calldata
    const calldata = this.encodeAugustusSwap(request, firmQuote);

    // 3. Determine value (non-zero only for native -> token swaps)
    const value = isNativeToken(request.srcToken) ? request.srcAmount : '0';

    return {
      to: this.augustusAddress,
      value,
      data: calldata,
      gasLimit: DEFAULT_GAS_LIMIT,
      chainId: this.chainId,
    };
  }

  /**
   * Build and execute a swap in a single call.
   *
   * This is a convenience method that builds the transaction, signs it
   * with the configured signer, submits it to the network, and waits
   * for confirmation.
   *
   * @param request - Transaction build parameters
   * @param provider - JSON-RPC provider for transaction submission
   * @returns Transaction hash
   * @throws DeluthiumError on quote or submission failure
   */
  async executeSwap(
    request: BuildTxRequest,
    provider: JsonRpcProvider,
  ): Promise<string> {
    const builtTx = await this.buildTransaction(request);

    try {
      // Get the signer address for nonce management
      const signerAddress = await this.signer.getAddress();

      // Build the raw transaction object
      const tx = {
        to: builtTx.to,
        value: BigInt(builtTx.value),
        data: builtTx.data,
        gasLimit: BigInt(builtTx.gasLimit),
        chainId: builtTx.chainId,
      };

      // Use the provider signer to send the transaction
      const signer = await provider.getSigner(signerAddress);
      const txResponse: TransactionResponse = await signer.sendTransaction(tx);

      // Wait for 1 confirmation
      const receipt = await txResponse.wait(1);
      const txHash = receipt?.hash ?? txResponse.hash;

      // Emit success event
      const swapEvent: SwapExecutedEvent = {
        txHash,
        srcToken: request.srcToken,
        destToken: request.destToken,
        srcAmount: request.srcAmount,
        destAmount: request.destAmount,
        sender: request.sender,
        receiver: request.receiver,
        timestamp: Date.now(),
      };
      this.emit('swap:executed', swapEvent);

      return txHash;
    } catch (err) {
      this.emit('swap:error', {
        error: err instanceof Error ? err.message : String(err),
        request,
        timestamp: Date.now(),
      });
      throw new DeluthiumError(
        `Swap execution failed: ${err instanceof Error ? err.message : String(err)}`,
        'SWAP_EXECUTION_ERROR',
      );
    }
  }

  /**
   * Estimate gas for a swap transaction.
   *
   * @param request - Transaction build parameters
   * @param provider - JSON-RPC provider
   * @returns Estimated gas limit as string
   */
  async estimateGas(
    request: BuildTxRequest,
    provider: JsonRpcProvider,
  ): Promise<string> {
    const builtTx = await this.buildTransaction(request);

    try {
      const gasEstimate = await provider.estimateGas({
        to: builtTx.to,
        value: BigInt(builtTx.value),
        data: builtTx.data,
        from: request.sender,
      });

      // Add 20% buffer to the estimate
      const buffered = (gasEstimate * 120n) / 100n;
      return buffered.toString();
    } catch {
      // Fall back to the default gas limit if estimation fails
      return DEFAULT_GAS_LIMIT;
    }
  }

  /**
   * Get the Augustus Swapper address for the configured chain.
   */
  getAugustusAddress(): string {
    return this.augustusAddress;
  }

  /**
   * Get the pool adapter contract address (if configured).
   */
  getPoolAdapterAddress(): string | undefined {
    return this.poolAdapterAddress;
  }

  // ---- Internal: Firm Quote -------------------------------------------------

  /**
   * Request a firm (binding) quote from Deluthium for the given swap.
   *
   * @param request - Build transaction request
   * @returns Firm quote response with calldata
   */
  private async getFirmQuote(request: BuildTxRequest): Promise<FirmQuoteResponse> {
    const slippagePercent = this.maxSlippageBps / 100;

    const firmRequest: FirmQuoteRequest = {
      src_chain_id: this.chainId,
      dst_chain_id: this.chainId,
      from_address: normalizeAddress(request.sender),
      to_address: normalizeAddress(request.receiver),
      token_in: resolveTokenAddress(request.srcToken, this.chainId),
      token_out: resolveTokenAddress(request.destToken, this.chainId),
      amount_in: request.srcAmount,
      indicative_amount_out: request.destAmount,
      slippage: slippagePercent,
      expiry_time_sec: DEFAULT_QUOTE_EXPIRY_SEC,
    };

    return retry(
      () => this.client.getFirmQuote(firmRequest),
      2, // 2 retries for firm quotes (time-sensitive)
      500,
    );
  }

  // ---- Internal: Calldata Encoding ------------------------------------------

  /**
   * Encode the Augustus swapOnCustom calldata.
   *
   * This wraps the Deluthium firm quote calldata into the Augustus swap
   * interface, directing execution through our pool adapter contract.
   *
   * @param request - Original build request
   * @param firmQuote - Deluthium firm quote with RFQ calldata
   * @returns ABI-encoded calldata hex string
   */
  private encodeAugustusSwap(
    request: BuildTxRequest,
    firmQuote: FirmQuoteResponse,
  ): string {
    const abiCoder = AbiCoder.defaultAbiCoder();

    // Build the exchange data blob:
    // Encode the pool adapter address + firm quote calldata for Augustus
    const adapterAddress = this.poolAdapterAddress ?? firmQuote.router_address;

    const exchangeData = abiCoder.encode(
      ['address', 'address', 'address', 'uint256', 'uint256', 'address', 'bytes'],
      [
        resolveTokenAddress(request.srcToken, this.chainId),
        resolveTokenAddress(request.destToken, this.chainId),
        request.sender,
        request.srcAmount,
        request.minDestAmount,
        request.receiver,
        firmQuote.calldata,
      ],
    );

    // Encode the full Augustus swapOnCustom call
    const augustusContract = new Contract(this.augustusAddress, AUGUSTUS_SWAP_ABI);
    const callees = [adapterAddress];

    return augustusContract.interface.encodeFunctionData('swapOnCustom', [
      resolveTokenAddress(request.srcToken, this.chainId),
      resolveTokenAddress(request.destToken, this.chainId),
      request.srcAmount,
      request.minDestAmount,
      callees,
      exchangeData,
    ]);
  }

  // ---- Internal: Validation -------------------------------------------------

  /**
   * Validate a BuildTxRequest before processing.
   *
   * @throws ValidationError if any field is invalid
   */
  private validateBuildRequest(request: BuildTxRequest): void {
    if (!request.srcToken) {
      throw new ValidationError('srcToken is required', 'srcToken');
    }
    if (!request.destToken) {
      throw new ValidationError('destToken is required', 'destToken');
    }
    if (!request.srcAmount || request.srcAmount === '0') {
      throw new ValidationError('srcAmount must be a positive value', 'srcAmount');
    }
    if (!request.destAmount || request.destAmount === '0') {
      throw new ValidationError('destAmount must be a positive value', 'destAmount');
    }
    if (!request.minDestAmount) {
      throw new ValidationError('minDestAmount is required', 'minDestAmount');
    }
    if (!request.sender) {
      throw new ValidationError('sender address is required', 'sender');
    }
    if (!request.receiver) {
      throw new ValidationError('receiver address is required', 'receiver');
    }
    if (request.deadline && isExpired(request.deadline)) {
      throw new ValidationError('Transaction deadline has already passed', 'deadline');
    }

    // Validate that the chain has an Augustus address
    if (!this.augustusAddress) {
      throw new ValidationError(
        `No Augustus Swapper address configured for chain ${this.chainId}`,
        'chainId',
      );
    }

    // Validate min dest amount <= dest amount
    if (BigInt(request.minDestAmount) > BigInt(request.destAmount)) {
      throw new ValidationError(
        'minDestAmount cannot exceed destAmount',
        'minDestAmount',
      );
    }
  }

  // ---- Internal: Address Resolution -----------------------------------------

  /**
   * Resolve the Augustus Swapper address for a chain.
   *
   * @param chainId - Chain ID
   * @returns Augustus address
   * @throws ValidationError if no Augustus address is known for the chain
   */
  private resolveAugustusAddress(chainId: number): string {
    const address = AUGUSTUS_ADDRESSES[chainId];
    if (!address) {
      throw new ValidationError(
        `Paraswap Augustus Swapper not deployed on chain ${chainId}. ` +
        `Provide augustusAddress in config.`,
        'chainId',
      );
    }
    return address;
  }
}
