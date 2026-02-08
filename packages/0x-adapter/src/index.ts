/**
 * @deluthium/0x-adapter -- 0x Protocol v4 RFQ to Deluthium translation layer.
 *
 * Enables market makers integrated with 0x Protocol to connect to Deluthium
 * with minimal changes. Provides field mapping, EIP-712 signing via SDK ISigner
 * abstraction, input validation, and an API proxy with retry/timeout.
 */

// Types
export type {
  ZeroExV4RFQOrder,
  AdapterConfig,
  MMQuoteParams,
  MMQuoteDomain,
  SignedMMQuote,
  FirmQuoteRequest,
  FirmQuoteResponse,
  ISigner,
} from './types.js';

// Transform functions
export {
  transform0xToDarkPool,
  isNativeToken,
  getWrappedTokenAddress,
  normalizeTokenAddress,
  signDarkPoolQuote,
  transformAndSign0xOrder,
  DEFAULT_EXTRA_DATA_HASH,
} from './transform.js';

// Validation
export { validateZeroExOrder } from './validation.js';

// API Proxy
export { ZeroExToDarkPoolProxy } from './proxy.js';

// Re-export useful SDK utilities
export {
  PrivateKeySigner,
  ZERO_ADDRESS,
  getChainConfig,
  getRfqManagerAddress,
} from '@deluthium/sdk';
