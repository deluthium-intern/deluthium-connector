/**
 * @deluthium/uniswapx-adapter - Reactor Client
 *
 * Interacts with UniswapX Reactor contracts on-chain to execute order fills.
 * Supports V2DutchOrderReactor, ExclusiveDutchOrderReactor, and PriorityOrderReactor.
 *
 * Key responsibilities:
 * - Build and send fill transactions
 * - Estimate gas costs
 * - Monitor transaction status
 * - Manage Reactor contract deployments
 */

import { Contract, JsonRpcProvider, Wallet, type ContractTransactionResponse } from 'ethers';
import type { Address, HexString } from '@deluthium/sdk';
import { ValidationError, ChainError } from '@deluthium/sdk';
import type { UniswapXOrder, ReactorDeployment, FillResult } from './types.js';
import { PERMIT2_ADDRESS } from './permit2.js';

// ─── Known Reactor Deployments ──────────────────────────────────────────────

/** Official UniswapX Reactor contract deployments by chain */
const REACTOR_DEPLOYMENTS: Map<number, ReactorDeployment> = new Map([
  [1, { // Ethereum Mainnet
    chainId: 1,
    v2DutchReactor: '0x00000011F84B9aa48e5f8aA8B9897600006289Be' as Address,
    exclusiveDutchReactor: '0x6000da47483062A0D734Ba3dc7576Ce6A0B645C4' as Address,
    priorityReactor: '0x00000024115AA990F0bAE0B6b0D5B8F68b684cd6' as Address,
    permit2: PERMIT2_ADDRESS,
  }],
  [42161, { // Arbitrum One
    chainId: 42161,
    v2DutchReactor: '0x00000011F84B9aa48e5f8aA8B9897600006289Be' as Address,
    exclusiveDutchReactor: '0x6000da47483062A0D734Ba3dc7576Ce6A0B645C4' as Address,
    priorityReactor: undefined,
    permit2: PERMIT2_ADDRESS,
  }],
  [8453, { // Base
    chainId: 8453,
    v2DutchReactor: '0x00000011F84B9aa48e5f8aA8B9897600006289Be' as Address,
    exclusiveDutchReactor: '0x6000da47483062A0D734Ba3dc7576Ce6A0B645C4' as Address,
    priorityReactor: undefined,
    permit2: PERMIT2_ADDRESS,
  }],
  [137, { // Polygon
    chainId: 137,
    v2DutchReactor: '0x00000011F84B9aa48e5f8aA8B9897600006289Be' as Address,
    exclusiveDutchReactor: '0x6000da47483062A0D734Ba3dc7576Ce6A0B645C4' as Address,
    priorityReactor: undefined,
    permit2: PERMIT2_ADDRESS,
  }],
  [10, { // Optimism
    chainId: 10,
    v2DutchReactor: '0x00000011F84B9aa48e5f8aA8B9897600006289Be' as Address,
    exclusiveDutchReactor: '0x6000da47483062A0D734Ba3dc7576Ce6A0B645C4' as Address,
    priorityReactor: undefined,
    permit2: PERMIT2_ADDRESS,
  }],
  [56, { // BNB Chain
    chainId: 56,
    v2DutchReactor: '0x00000011F84B9aa48e5f8aA8B9897600006289Be' as Address,
    exclusiveDutchReactor: undefined,
    priorityReactor: undefined,
    permit2: PERMIT2_ADDRESS,
  }],
]);

// ─── Reactor ABI ────────────────────────────────────────────────────────────

/**
 * Minimal ABI for UniswapX Reactor contracts.
 * All Reactor types share the same execute/executeBatch interface.
 */
const REACTOR_ABI = [
  // Execute a single order fill
  'function execute((bytes order, bytes sig) signedOrder) external payable',
  // Execute a single order fill with filler callback
  'function executeWithCallback((bytes order, bytes sig) signedOrder, bytes callbackData) external payable',
  // Execute a batch of order fills
  'function executeBatch((bytes order, bytes sig)[] signedOrders) external payable',
  // Execute a batch of order fills with filler callback
  'function executeBatchWithCallback((bytes order, bytes sig)[] signedOrders, bytes callbackData) external payable',
];

// ─── Reactor Client ─────────────────────────────────────────────────────────

/**
 * Client for interacting with UniswapX Reactor contracts.
 *
 * Manages fill transaction construction, gas estimation, and execution.
 */
export class ReactorClient {
  private readonly provider: JsonRpcProvider;
  private readonly chainId: number;
  private readonly deployment: ReactorDeployment;
  private wallet: Wallet | null = null;

  constructor(rpcUrl: string, chainId: number, customDeployment?: ReactorDeployment) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.chainId = chainId;

    if (customDeployment) {
      this.deployment = customDeployment;
    } else {
      const builtin = REACTOR_DEPLOYMENTS.get(chainId);
      if (!builtin) {
        throw new ChainError(
          `No UniswapX Reactor deployment found for chain ${chainId}. Provide a custom deployment.`,
          chainId,
        );
      }
      this.deployment = builtin;
    }
  }

  /**
   * Connect a wallet for sending transactions.
   * Required before calling execute/executeBatch.
   *
   * @param privateKey - Private key for the filler wallet
   */
  connectWallet(privateKey: string): void {
    this.wallet = new Wallet(privateKey, this.provider);
  }

  /**
   * Get the Reactor contract address for a specific order type.
   *
   * @param orderType - UniswapX order type
   * @returns Reactor contract address
   * @throws ValidationError if no Reactor exists for this order type on this chain
   */
  getReactorAddress(orderType: UniswapXOrder['orderType']): Address {
    let address: Address | undefined;

    switch (orderType) {
      case 'DutchV2':
        address = this.deployment.v2DutchReactor;
        break;
      case 'ExclusiveDutch':
        address = this.deployment.exclusiveDutchReactor;
        break;
      case 'Priority':
        address = this.deployment.priorityReactor;
        break;
    }

    if (!address) {
      throw new ValidationError(
        `No ${orderType} Reactor deployed on chain ${this.chainId}`,
        'orderType',
      );
    }

    return address;
  }

  /**
   * Get the Reactor deployment info for this chain.
   */
  getDeployment(): ReactorDeployment {
    return this.deployment;
  }

  /**
   * Estimate gas for filling a single order.
   *
   * @param order - UniswapX order to fill
   * @returns Estimated gas in wei
   */
  async estimateGas(order: UniswapXOrder): Promise<bigint> {
    const reactorAddress = this.getReactorAddress(order.orderType);
    const reactor = new Contract(reactorAddress, REACTOR_ABI, this.provider);

    try {
      const signedOrder = {
        order: order.encodedOrder,
        sig: order.signature,
      };

      const gasEstimate = await reactor.execute.estimateGas(signedOrder);
      // Add 20% buffer for gas estimation uncertainty
      return (gasEstimate * 120n) / 100n;
    } catch {
      // If estimation fails, return a conservative default
      // UniswapX fills typically cost 200k-500k gas
      return 400_000n;
    }
  }

  /**
   * Estimate the gas cost in wei (gas * gasPrice).
   *
   * @param order - Order to estimate for
   * @returns Gas cost in wei (native token)
   */
  async estimateGasCostWei(order: UniswapXOrder): Promise<bigint> {
    const [gasEstimate, feeData] = await Promise.all([
      this.estimateGas(order),
      this.provider.getFeeData(),
    ]);

    const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 30_000_000_000n; // 30 gwei fallback
    return gasEstimate * gasPrice;
  }

  /**
   * Execute a fill for a single UniswapX order.
   *
   * The filler must have:
   * 1. Sufficient output tokens to fulfill the order
   * 2. Approved Permit2 to spend those tokens
   * 3. A connected wallet (via connectWallet)
   *
   * @param order - UniswapX order to fill
   * @param overrides - Optional transaction overrides (gasLimit, value, etc.)
   * @returns Fill result with transaction details
   */
  async execute(
    order: UniswapXOrder,
    overrides?: { gasLimit?: bigint; value?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint },
  ): Promise<FillResult> {
    this.ensureWalletConnected();

    const reactorAddress = this.getReactorAddress(order.orderType);
    const reactor = new Contract(reactorAddress, REACTOR_ABI, this.wallet!);

    const signedOrder = {
      order: order.encodedOrder,
      sig: order.signature,
    };

    try {
      const tx: ContractTransactionResponse = await reactor.execute(
        signedOrder,
        overrides ?? {},
      );

      const receipt = await tx.wait();

      return {
        txHash: tx.hash as HexString,
        orderHash: order.orderHash,
        success: receipt !== null && receipt.status === 1,
        gasUsed: receipt?.gasUsed,
        blockNumber: receipt?.blockNumber,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        txHash: '0x' as HexString,
        orderHash: order.orderHash,
        success: false,
        error: `Fill execution failed: ${message}`,
      };
    }
  }

  /**
   * Execute fills for multiple orders in a single transaction (batch).
   *
   * @param orders - Array of orders to fill
   * @param overrides - Optional transaction overrides
   * @returns Fill result for the batch
   */
  async executeBatch(
    orders: UniswapXOrder[],
    overrides?: { gasLimit?: bigint; value?: bigint },
  ): Promise<FillResult> {
    this.ensureWalletConnected();

    if (orders.length === 0) {
      throw new ValidationError('No orders provided for batch execution', 'orders');
    }

    // All orders in a batch must use the same Reactor
    const orderType = orders[0]!.orderType;
    if (!orders.every((o) => o.orderType === orderType)) {
      throw new ValidationError(
        'All orders in a batch must be the same type',
        'orderType',
      );
    }

    const reactorAddress = this.getReactorAddress(orderType);
    const reactor = new Contract(reactorAddress, REACTOR_ABI, this.wallet!);

    const signedOrders = orders.map((o) => ({
      order: o.encodedOrder,
      sig: o.signature,
    }));

    try {
      const tx: ContractTransactionResponse = await reactor.executeBatch(
        signedOrders,
        overrides ?? {},
      );

      const receipt = await tx.wait();

      return {
        txHash: tx.hash as HexString,
        orderHash: orders[0]!.orderHash, // Primary order hash
        success: receipt !== null && receipt.status === 1,
        gasUsed: receipt?.gasUsed,
        blockNumber: receipt?.blockNumber,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        txHash: '0x' as HexString,
        orderHash: orders[0]!.orderHash,
        success: false,
        error: `Batch fill execution failed: ${message}`,
      };
    }
  }

  /**
   * Get the current gas price from the provider.
   *
   * @returns Gas price in wei
   */
  async getGasPrice(): Promise<bigint> {
    const feeData = await this.provider.getFeeData();
    return feeData.gasPrice ?? 30_000_000_000n;
  }

  /**
   * Get the current block number.
   */
  async getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  // ─── Internal ───────────────────────────────────────────────────────

  private ensureWalletConnected(): void {
    if (!this.wallet) {
      throw new ValidationError(
        'Wallet not connected. Call connectWallet(privateKey) first.',
        'wallet',
      );
    }
  }
}

// ─── Deployment Registry ────────────────────────────────────────────────────

/**
 * Register a custom Reactor deployment for a chain.
 *
 * @param deployment - Reactor deployment info
 */
export function registerReactorDeployment(deployment: ReactorDeployment): void {
  REACTOR_DEPLOYMENTS.set(deployment.chainId, deployment);
}

/**
 * Get the Reactor deployment for a chain (or undefined).
 */
export function getReactorDeployment(chainId: number): ReactorDeployment | undefined {
  return REACTOR_DEPLOYMENTS.get(chainId);
}

/**
 * Get all chains with Reactor deployments.
 */
export function getSupportedChains(): number[] {
  return Array.from(REACTOR_DEPLOYMENTS.keys());
}
