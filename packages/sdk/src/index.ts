/**
 * @deluthium/sdk
 *
 * Core SDK for Deluthium integrations.
 * Provides API clients, EIP-712 signing, chain configuration,
 * type definitions, and shared utilities.
 *
 * @example
 * ```typescript
 * import {
 *   DeluthiumRestClient,
 *   PrivateKeySigner,
 *   signMMQuote,
 *   getChainConfig,
 *   ChainId,
 *   toWei,
 * } from '@deluthium/sdk';
 *
 * const client = new DeluthiumRestClient({
 *   auth: 'your-jwt-token',
 *   chainId: ChainId.BSC,
 * });
 *
 * const pairs = await client.getPairs();
 * const quote = await client.getIndicativeQuote({
 *   src_chain_id: ChainId.BSC,
 *   dst_chain_id: ChainId.BSC,
 *   token_in: '0x...',
 *   token_out: '0x...',
 *   amount_in: toWei('1.0', 18),
 * });
 * ```
 *
 * @packageDocumentation
 */

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  APIResponse,
  Token,
  TradingPair,
  IndicativeQuoteRequest,
  IndicativeQuoteResponse,
  FirmQuoteRequest,
  FirmQuoteResponse,
  MMQuoteParams,
  MMQuoteDomain,
  SignedMMQuote,
  ChainConfig,
  WSMessage,
  WSMessageType,
  DepthUpdate,
  WSRFQRequest,
  WSRFQResponse,
  DeluthiumClientConfig,
  TypedDataDomain,
  TypedDataField,
  ISigner,
  HexString,
  Address,
} from './types/index.js';
export { ZERO_ADDRESS, API_SUCCESS_CODE } from './types/index.js';

// ─── Clients ─────────────────────────────────────────────────────────────────
export { DeluthiumRestClient } from './client/rest.js';
export { DeluthiumWSClient } from './client/websocket.js';
export type { WSEventHandler } from './client/websocket.js';

// ─── Signer ──────────────────────────────────────────────────────────────────
export {
  MM_QUOTE_TYPES,
  buildMMQuoteDomain,
  signMMQuote,
  PrivateKeySigner,
  KmsSigner,
  VaultSigner,
} from './signer/index.js';

// ─── Chain ───────────────────────────────────────────────────────────────────
export {
  getChainConfig,
  tryGetChainConfig,
  registerChain,
  getAllChains,
  getSupportedChains,
  getRfqManagerAddress,
  getWrappedNativeToken,
  ChainId,
} from './chain/index.js';
export type { ChainId as ChainIdType } from './chain/index.js';

// ─── Utilities ───────────────────────────────────────────────────────────────
export {
  toWei,
  fromWei,
  parseAmount,
  formatAmount,
  normalizeAddress,
  isValidAddress,
  isNativeToken,
  resolveTokenAddress,
  calculateDeadline,
  isExpired,
  applySlippage,
  keccak256Hash,
  generateNonce,
  sleep,
  retry,
} from './utils/index.js';

// ─── Errors ──────────────────────────────────────────────────────────────────
export {
  DeluthiumError,
  ValidationError,
  APIError,
  AuthenticationError,
  RateLimitError,
  TimeoutError,
  QuoteExpiredError,
  WebSocketError,
  SigningError,
  ChainError,
} from './errors/index.js';
