// ── Types ────────────────────────────────────────────────────────────────────
export type {
  DeluthiumQuote,
  OneInchOrderV4,
  OneInchRfqOrder,
  AdapterConfig,
  ISigner,
  SignedOneInchOrder,
  OneInchChainConfig,
  ValidationErrorInfo,
  NonceInfo,
} from './types.js';
export { ORDER_TYPES } from './types.js';

// ── Constants ────────────────────────────────────────────────────────────────
export {
  ChainId,
  ONEINCH_ROUTER_V6,
  ONEINCH_ROUTER_V6_ZKSYNC,
  DELUTHIUM_RFQ_MANAGERS,
  WRAPPED_NATIVE_TOKENS,
  ZERO_ADDRESS,
  NATIVE_TOKEN_ADDRESS,
  CHAIN_CONFIGS,
  UINT_40_MAX,
  UINT_80_MAX,
  UINT_160_MAX,
  DEFAULTS,
  getChainConfig,
  getOneInchRouter,
  getWrappedNativeToken,
  getOneInchDomain,
} from './constants.js';

// ── Errors ───────────────────────────────────────────────────────────────────
export {
  AdapterError,
  ValidationError,
  UnsupportedChainError,
  ConfigurationError,
  SignatureError,
  APIError,
  AuthenticationError,
  RateLimitError,
  TimeoutError,
  QuoteExpiredError,
  isAdapterError,
  isRetryableError,
} from './errors.js';

// ── Address Utilities ────────────────────────────────────────────────────────
export {
  normalizeAddress,
  isValidAddress,
  isNativeTokenAddress,
  addressEquals,
  extractAddressBytes,
  formatAddress,
} from './address.js';

// ── MakerTraits ──────────────────────────────────────────────────────────────
export { MakerTraits } from './MakerTraits.js';
export type { BitRange } from './MakerTraits.js';

// ── NonceManager ─────────────────────────────────────────────────────────────
export {
  NonceManager,
  getDefaultNonceManager,
  resetDefaultNonceManager,
} from './NonceManager.js';

// ── Validation ───────────────────────────────────────────────────────────────
export type { ValidationResult } from './validation.js';
export {
  isValidAddress as isValidAddressCheck,
  isNativeToken,
  validateDeluthiumQuote,
  validateOneInchOrder,
  calculateSlippage,
  isSlippageAcceptable,
  assertValidDeluthiumQuote,
  assertValidOneInchOrder,
} from './validation.js';

// ── Utilities ────────────────────────────────────────────────────────────────
export {
  generateSalt,
  generateSaltWithExtension,
  computeOrderHash,
  bigintToHex,
  hexToBigint,
  currentTimestamp,
  calculateDeadline,
  isExpired,
  formatAmount,
  parseAmount,
  sleep,
  retry,
  deepClone,
  compactSignature,
} from './utils.js';

// ── Adapter ──────────────────────────────────────────────────────────────────
export { DeluthiumAdapter, createDeluthiumAdapter } from './DeluthiumAdapter.js';

// ── Signers ──────────────────────────────────────────────────────────────────
export {
  isSigner,
  PrivateKeySigner,
  createRandomSigner,
  KmsSigner,
} from './signer/index.js';
export type { KmsSignerConfig } from './signer/index.js';
