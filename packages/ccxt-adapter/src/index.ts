/**
 * @deluthium/ccxt — Deluthium exchange adapter for CCXT
 *
 * Extends ccxt.Exchange externally (no fork required). Install alongside
 * your existing CCXT setup and use the standard exchange interface for
 * Deluthium RFQ-based swaps.
 *
 * @packageDocumentation
 */

export { DeluthiumExchange } from './deluthium-exchange.js';

// Re-export useful SDK types for convenience
export type {
  IndicativeQuoteRequest,
  IndicativeQuoteResponse,
  FirmQuoteRequest,
  FirmQuoteResponse,
  TradingPair,
  Token,
  DeluthiumClientConfig,
} from '@deluthium/sdk';
