/**
 * @deluthium/uniswapx-adapter - Type definitions
 *
 * Types for UniswapX Dutch auction orders, Reactor contracts,
 * Permit2 structures, and adapter configuration.
 */

import type { Address, HexString, ISigner, DeluthiumClientConfig } from '@deluthium/sdk';

// ─── Order Types ────────────────────────────────────────────────────────────

/** Supported UniswapX order types */
export type UniswapXOrderType = 'DutchV2' | 'ExclusiveDutch' | 'Priority';

/** Status of a UniswapX order in its lifecycle */
export type OrderStatus = 'open' | 'expired' | 'filled' | 'cancelled' | 'insufficient-funds' | 'error';

/** Token input for a UniswapX order */
export interface DutchInput {
  /** ERC-20 token address */
  readonly token: Address;
  /** Starting amount (most favorable to swapper, in wei) */
  readonly startAmount: bigint;
  /** Ending amount (least favorable to swapper, in wei) */
  readonly endAmount: bigint;
}

/** Token output for a UniswapX order */
export interface DutchOutput {
  /** ERC-20 token address */
  readonly token: Address;
  /** Starting amount (least favorable to filler, in wei) */
  readonly startAmount: bigint;
  /** Ending amount (most favorable to filler, in wei) */
  readonly endAmount: bigint;
  /** Recipient address for this output */
  readonly recipient: Address;
}

/** Cosigner data for V2 Dutch orders */
export interface CosignerData {
  /** Timestamp after which the order decays */
  readonly decayStartTime: number;
  /** Timestamp at which the order reaches its worst price */
  readonly decayEndTime: number;
  /** Address granted exclusive fill rights (zero address = none) */
  readonly exclusiveFiller: Address;
  /** Timestamp at which exclusive fill rights expire */
  readonly exclusivityOverrideBps: number;
  /** Override amounts for inputs */
  readonly inputOverride: bigint;
  /** Override amounts for outputs */
  readonly outputOverrides: bigint[];
}

/** Parsed UniswapX Dutch auction order (V2) */
export interface DutchOrderV2 {
  /** Order type identifier */
  readonly orderType: 'DutchV2';
  /** Unique order hash */
  readonly orderHash: HexString;
  /** Chain ID where the order was created */
  readonly chainId: number;
  /** Swapper address (order creator) */
  readonly swapper: Address;
  /** Permit2 nonce */
  readonly nonce: bigint;
  /** Order deadline (unix timestamp seconds) */
  readonly deadline: number;
  /** Reactor contract address that will execute the fill */
  readonly reactor: Address;
  /** Cosigner address for price resolution */
  readonly cosigner: Address;
  /** Cosigner-provided data */
  readonly cosignerData: CosignerData;
  /** Token being sold by the swapper */
  readonly input: DutchInput;
  /** Token(s) expected by the swapper in return */
  readonly outputs: DutchOutput[];
  /** Raw encoded order bytes for on-chain submission */
  readonly encodedOrder: HexString;
  /** Swapper's Permit2 signature */
  readonly signature: HexString;
}

/** Exclusive Dutch order (V1) */
export interface ExclusiveDutchOrder {
  readonly orderType: 'ExclusiveDutch';
  readonly orderHash: HexString;
  readonly chainId: number;
  readonly swapper: Address;
  readonly nonce: bigint;
  readonly deadline: number;
  readonly reactor: Address;
  /** Filler with exclusive rights */
  readonly exclusiveFiller: Address;
  /** Timestamp when exclusivity period ends */
  readonly exclusivityEndTimestamp: number;
  /** Decay start timestamp */
  readonly decayStartTime: number;
  /** Decay end timestamp */
  readonly decayEndTime: number;
  readonly input: DutchInput;
  readonly outputs: DutchOutput[];
  readonly encodedOrder: HexString;
  readonly signature: HexString;
}

/** Priority order type */
export interface PriorityOrder {
  readonly orderType: 'Priority';
  readonly orderHash: HexString;
  readonly chainId: number;
  readonly swapper: Address;
  readonly nonce: bigint;
  readonly deadline: number;
  readonly reactor: Address;
  /** Base input amount */
  readonly input: DutchInput;
  /** Priority-fee-adjusted outputs */
  readonly outputs: DutchOutput[];
  /** Minimum priority fee in wei */
  readonly basePriorityFee: bigint;
  readonly encodedOrder: HexString;
  readonly signature: HexString;
}

/** Union of all supported order types */
export type UniswapXOrder = DutchOrderV2 | ExclusiveDutchOrder | PriorityOrder;

// ─── Reactor Types ──────────────────────────────────────────────────────────

/** Known Reactor contract addresses per chain */
export interface ReactorDeployment {
  /** Chain ID */
  readonly chainId: number;
  /** V2DutchOrderReactor address */
  readonly v2DutchReactor?: Address;
  /** ExclusiveDutchOrderReactor address */
  readonly exclusiveDutchReactor?: Address;
  /** PriorityOrderReactor address */
  readonly priorityReactor?: Address;
  /** Permit2 contract address */
  readonly permit2: Address;
}

/** Result of a fill transaction */
export interface FillResult {
  /** Transaction hash */
  readonly txHash: HexString;
  /** Order hash that was filled */
  readonly orderHash: HexString;
  /** Whether the fill was successful */
  readonly success: boolean;
  /** Gas used in wei */
  readonly gasUsed?: bigint;
  /** Block number */
  readonly blockNumber?: number;
  /** Error message if fill failed */
  readonly error?: string;
}

// ─── Fill Evaluation ────────────────────────────────────────────────────────

/** Result of evaluating whether to fill an order */
export interface FillEvaluation {
  /** Whether filling is profitable */
  readonly profitable: boolean;
  /** The order being evaluated */
  readonly order: UniswapXOrder;
  /** Deluthium quote amount out (what we can get) */
  readonly deluthiumAmountOut: bigint;
  /** Required amount out at current decay point */
  readonly requiredAmountOut: bigint;
  /** Profit in output token wei (negative = unprofitable) */
  readonly profitWei: bigint;
  /** Profit as percentage of required output */
  readonly profitBps: number;
  /** Estimated gas cost in output token wei */
  readonly estimatedGasCost: bigint;
  /** Net profit after gas (profitWei - estimatedGasCost) */
  readonly netProfitWei: bigint;
}

// ─── Permit2 Types ──────────────────────────────────────────────────────────

/** Permit2 PermitSingle structure */
export interface PermitSingle {
  readonly details: {
    readonly token: Address;
    readonly amount: bigint;
    readonly expiration: number;
    readonly nonce: number;
  };
  readonly spender: Address;
  readonly sigDeadline: number;
}

/** Permit2 PermitBatch structure */
export interface PermitBatch {
  readonly details: Array<{
    readonly token: Address;
    readonly amount: bigint;
    readonly expiration: number;
    readonly nonce: number;
  }>;
  readonly spender: Address;
  readonly sigDeadline: number;
}

/** Permit2 witness data for order verification */
export interface PermitWitnessTransfer {
  readonly permitted: {
    readonly token: Address;
    readonly amount: bigint;
  };
  readonly nonce: bigint;
  readonly deadline: number;
  readonly witness: HexString;
  readonly witnessTypeName: string;
  readonly witnessType: string;
}

// ─── Adapter Configuration ──────────────────────────────────────────────────

/** Configuration for the UniswapX adapter */
export interface UniswapXAdapterConfig {
  /** Deluthium SDK client configuration */
  readonly deluthiumConfig: DeluthiumClientConfig;
  /** Signer for fill transactions */
  readonly signer: ISigner;
  /** Chain ID to operate on */
  readonly chainId: number;
  /** RPC URL for on-chain interactions */
  readonly rpcUrl: string;
  /** Minimum profit threshold in basis points (default: 10 = 0.1%) */
  readonly minProfitBps?: number;
  /** Maximum gas price willing to pay (in gwei, default: 50) */
  readonly maxGasPriceGwei?: number;
  /** Order source URL (UniswapX API endpoint) */
  readonly orderApiUrl?: string;
  /** Polling interval for new orders in ms (default: 2000) */
  readonly pollIntervalMs?: number;
  /** Whether to auto-fill profitable orders (default: false, evaluation only) */
  readonly autoFill?: boolean;
  /** Custom Reactor deployment (overrides built-in) */
  readonly reactorDeployment?: ReactorDeployment;
}

// ─── Event Types ────────────────────────────────────────────────────────────

/** Events emitted by the adapter */
export interface UniswapXAdapterEvents {
  /** New order discovered */
  orderDiscovered: (order: UniswapXOrder) => void;
  /** Order evaluated for fill profitability */
  orderEvaluated: (evaluation: FillEvaluation) => void;
  /** Fill transaction submitted */
  fillSubmitted: (orderHash: HexString, txHash: HexString) => void;
  /** Fill transaction confirmed */
  fillConfirmed: (result: FillResult) => void;
  /** Fill transaction failed */
  fillFailed: (orderHash: HexString, error: Error) => void;
  /** Adapter error */
  error: (error: Error) => void;
}
