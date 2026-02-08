/**
 * @deluthium/sdk - Core type definitions
 *
 * Canonical types for the Deluthium RFQ API, EIP-712 structures,
 * chain configuration, and shared interfaces.
 */

// --- API Response Envelope ---

/** Standard API response wrapper. code === 10000 indicates success. */
export interface APIResponse<T = unknown> {
  code: number | string;
  message?: string;
  data?: T;
}

// --- Token and Pair Types ---

export interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chainId: number;
  /** Logo URI (optional) */
  logoUri?: string;
}

export interface TradingPair {
  id: string;
  baseToken: Token;
  quoteToken: Token;
  chainId: number;
  /** Whether pair is actively quoted */
  active: boolean;
  /** Minimum order size in base token units */
  minOrderSize?: string;
  /** Maximum order size in base token units */
  maxOrderSize?: string;
}

// --- Quote Types ---

export interface IndicativeQuoteRequest {
  /** Source chain ID */
  src_chain_id: number;
  /** Destination chain ID (same as src for same-chain) */
  dst_chain_id: number;
  /** Token being sold */
  token_in: string;
  /** Token being bought */
  token_out: string;
  /** Amount of input token in wei (as string) */
  amount_in: string;
  /** Direction: sell or buy */
  side?: 'sell' | 'buy';
}

export interface IndicativeQuoteResponse {
  /** Input token address */
  token_in: string;
  /** Output token address */
  token_out: string;
  /** Input amount in wei */
  amount_in: string;
  /** Indicative output amount in wei */
  amount_out: string;
  /** Price expressed as amount_out / amount_in (human-readable) */
  price: string;
  /** Quote timestamp (ms) */
  timestamp: number;
  /** Quote validity duration (ms) */
  valid_for_ms?: number;
}

export interface FirmQuoteRequest {
  /** Source chain ID */
  src_chain_id: number;
  /** Destination chain ID */
  dst_chain_id: number;
  /** Sender address */
  from_address: string;
  /** Receiver address */
  to_address: string;
  /** Token being sold */
  token_in: string;
  /** Token being bought */
  token_out: string;
  /** Input amount in wei (as string) */
  amount_in: string;
  /** Previously received indicative amount (for slippage reference) */
  indicative_amount_out?: string;
  /** Slippage tolerance in percentage (e.g. 0.5 = 0.5%) */
  slippage: number;
  /** Quote expiry in seconds from now */
  expiry_time_sec: number;
}

export interface FirmQuoteResponse {
  /** Unique quote identifier */
  quote_id: string;
  /** Source chain ID */
  src_chain_id: number;
  /** Encoded calldata for router.swap() */
  calldata: string;
  /** Router contract address to send the transaction to */
  router_address: string;
  /** Sender address */
  from_address: string;
  /** Receiver address */
  to_address: string;
  /** Token being sold */
  token_in: string;
  /** Token being bought */
  token_out: string;
  /** Input amount in wei */
  amount_in: string;
  /** Guaranteed output amount in wei */
  amount_out: string;
  /** Fee rate in basis points */
  fee_rate: number;
  /** Fee amount in output token wei */
  fee_amount: string;
  /** Quote expiry (unix timestamp in seconds) */
  deadline: number;
}

// --- EIP-712 MMQuote (on-chain structure) ---

/** The DarkPool MMQuote struct used for EIP-712 signing */
export interface MMQuoteParams {
  /** RFQ Manager contract address */
  manager: string;
  /** Sender address */
  from: string;
  /** Receiver address */
  to: string;
  /** Input token address (zero address = native) */
  inputToken: string;
  /** Output token address (zero address = native) */
  outputToken: string;
  /** Input amount in wei */
  amountIn: bigint;
  /** Output amount in wei */
  amountOut: bigint;
  /** Expiry timestamp (unix seconds) */
  deadline: number;
  /** Anti-replay nonce */
  nonce: bigint;
  /** Extra data bytes (default "0x") */
  extraData: string;
}

/** EIP-712 domain for MMQuote signing */
export interface MMQuoteDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

/** Signed MMQuote with attached signature */
export interface SignedMMQuote {
  params: MMQuoteParams;
  signature: string;
  /** keccak256 hash of the EIP-712 typed data */
  hash: string;
}

// --- Chain Configuration ---

export interface ChainConfig {
  /** EVM chain ID */
  chainId: number;
  /** Human-readable name */
  name: string;
  /** Short symbol (e.g. "BSC", "ETH") */
  symbol: string;
  /** Native token symbol */
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  /** Default RPC URL(s) */
  rpcUrls: string[];
  /** Block explorer URL */
  explorerUrl: string;
  /** Wrapped native token address */
  wrappedNativeToken: string;
  /** RFQ Manager contract address (undefined = not yet deployed) */
  rfqManagerAddress?: string;
  /** Whether this chain is fully supported */
  supported: boolean;
}

// --- WebSocket Types ---

export type WSMessageType =
  | 'subscribe'
  | 'unsubscribe'
  | 'depth'
  | 'rfq_request'
  | 'rfq_response'
  | 'heartbeat'
  | 'error';

export interface WSMessage<T = unknown> {
  type: WSMessageType;
  channel?: string;
  data?: T;
  id?: string | number;
  timestamp?: number;
}

export interface DepthUpdate {
  pair: string;
  bids: [price: string, quantity: string][];
  asks: [price: string, quantity: string][];
  timestamp: number;
}

export interface WSRFQRequest {
  request_id: string;
  token_in: string;
  token_out: string;
  amount_in: string;
  chain_id: number;
  from_address: string;
  deadline: number;
}

export interface WSRFQResponse {
  request_id: string;
  amount_out: string;
  signature?: string;
  expiry: number;
}

// --- Client Configuration ---

export interface DeluthiumClientConfig {
  /** Base URL for the REST API (default: https://rfq-api.deluthium.ai) */
  baseUrl?: string;
  /** WebSocket URL for real-time data */
  wsUrl?: string;
  /** JWT token or async function that returns one */
  auth: string | (() => string | Promise<string>);
  /** Default chain ID */
  chainId: number;
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** User-agent string for HTTP requests */
  userAgent?: string;
}

// --- Signer Interface ---

export interface TypedDataDomain {
  name?: string;
  version?: string;
  chainId?: number;
  verifyingContract?: string;
  salt?: string;
}

export interface TypedDataField {
  name: string;
  type: string;
}

/** Abstract signer interface -- adapters implement this for their signing needs */
export interface ISigner {
  /** Returns the signer's address */
  getAddress(): Promise<string>;

  /** Signs EIP-712 typed data and returns hex signature */
  signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string>;

  /** Signs a raw message and returns hex signature */
  signMessage(message: string | Uint8Array): Promise<string>;
}

// --- Utility Types ---

/** Hex-encoded string with 0x prefix */
export type HexString = `0x${string}`;

/** Ethereum address (checksummed or lowercased) */
export type Address = HexString;

/** Zero address constant type */
export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/** Success code for Deluthium API responses */
export const API_SUCCESS_CODE = 10000;
