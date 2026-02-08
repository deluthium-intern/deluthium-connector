/**
 * 0x Protocol v4 RFQ to Deluthium type definitions.
 *
 * Defines the 0x-specific types and the adapter configuration.
 * Shared Deluthium types (MMQuoteParams, etc.) are imported from @deluthium/sdk.
 */

// Re-export core SDK types used throughout the adapter
export type {
  MMQuoteParams,
  MMQuoteDomain,
  SignedMMQuote,
  FirmQuoteRequest,
  FirmQuoteResponse,
  ISigner,
} from '@deluthium/sdk';

// ============================================================================
// 0x Protocol Types
// ============================================================================

/**
 * 0x Protocol v4 RFQ Order Structure.
 *
 * Standard structure used by 0x Protocol for Request-for-Quote orders.
 * Market makers sign these orders off-chain, and takers fill them on-chain.
 *
 * @see https://docs.0xprotocol.org/en/latest/basics/orders.html#rfq-orders
 */
export interface ZeroExV4RFQOrder {
  /** Token address the maker is selling (ERC20). Maps to Deluthium outputToken. */
  makerToken: string;
  /** Token address the taker is selling. Maps to Deluthium inputToken. */
  takerToken: string;
  /** Amount of makerToken the maker is selling (wei string). Maps to Deluthium amountOut. */
  makerAmount: string;
  /** Amount of takerToken the taker must pay (wei string). Maps to Deluthium amountIn. */
  takerAmount: string;
  /** Address of the order maker (market maker). */
  maker: string;
  /** Address allowed to fill (0x0 = any taker). Can map to Deluthium 'to'. */
  taker: string;
  /** Address allowed to be tx.origin when filling. Maps to Deluthium 'from'. */
  txOrigin: string;
  /** Liquidity pool identifier (bytes32). Not used in Deluthium. */
  pool: string;
  /** Order expiration timestamp (Unix seconds). Maps to Deluthium deadline. */
  expiry: number;
  /** Unique order nonce/salt (uint256 as string). Maps to Deluthium nonce. */
  salt: string;
}

/**
 * Adapter configuration options.
 */
export interface AdapterConfig {
  /** Chain ID to use (56=BSC, 8453=Base, 1=ETH). */
  chainId: number;
  /** JWT token for Deluthium API authentication. */
  jwtToken: string;
  /** Default slippage tolerance as percentage (e.g. 0.5 = 0.5%). Default: 0.5 */
  defaultSlippage?: number;
  /** Default expiry time in seconds. Default: 60 */
  defaultExpiryTimeSec?: number;
}
