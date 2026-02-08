/**
 * @deluthium/institutional-adapter - Type definitions
 *
 * Types for the institutional MM adapter covering:
 * - FIX protocol messages and sessions
 * - OTC RFQ workflow states
 * - Audit trail events
 * - Aggregator bridge verification
 * - Adapter configuration
 */

import type {
  FirmQuoteResponse,
  IndicativeQuoteResponse,
  ISigner,
  DeluthiumClientConfig,
} from '@deluthium/sdk';

// ============================================================================
// FIX Protocol Types
// ============================================================================

/**
 * Supported FIX protocol versions.
 */
export type FIXVersion = 'FIX.4.4' | 'FIXT.1.1';

/**
 * FIX message types used in institutional RFQ flow.
 *
 * @see https://www.fixtrading.org/online-specification/
 */
export enum FIXMsgType {
  /** Logon (A) */
  Logon = 'A',
  /** Logout (5) */
  Logout = '5',
  /** Heartbeat (0) */
  Heartbeat = '0',
  /** Test Request (1) */
  TestRequest = '1',
  /** Reject (3) */
  Reject = '3',
  /** Business Reject (j) */
  BusinessReject = 'j',
  /** Quote Request (R) */
  QuoteRequest = 'R',
  /** Quote (S) */
  Quote = 'S',
  /** Quote Cancel (Z) */
  QuoteCancel = 'Z',
  /** New Order Single (D) */
  NewOrderSingle = 'D',
  /** Execution Report (8) */
  ExecutionReport = '8',
  /** Order Cancel Request (F) */
  OrderCancelRequest = 'F',
  /** Market Data Request (V) */
  MarketDataRequest = 'V',
  /** Market Data Snapshot (W) */
  MarketDataSnapshot = 'W',
  /** Security List Request (x) */
  SecurityListRequest = 'x',
  /** Security List (y) */
  SecurityList = 'y',
}

/**
 * FIX execution report status (OrdStatus, tag 39).
 */
export enum FIXOrdStatus {
  New = '0',
  PartiallyFilled = '1',
  Filled = '2',
  DoneForDay = '3',
  Canceled = '4',
  Replaced = '5',
  PendingCancel = '6',
  Rejected = '8',
  Expired = 'C',
}

/**
 * FIX order side (tag 54).
 */
export enum FIXSide {
  Buy = '1',
  Sell = '2',
}

/**
 * FIX order type (tag 40).
 */
export enum FIXOrdType {
  Market = '1',
  Limit = '2',
  PreviouslyQuoted = 'D',
}

/**
 * FIX time-in-force (tag 59).
 */
export enum FIXTimeInForce {
  Day = '0',
  GoodTillCancel = '1',
  ImmediateOrCancel = '3',
  FillOrKill = '4',
  GoodTillDate = '6',
}

/**
 * Parsed FIX message as a record of tag-value pairs.
 * Tags are stored as string numbers, values as strings.
 */
export interface FIXMessage {
  /** Raw tag-value pairs */
  fields: Map<number, string>;
  /** FIX version (BeginString, tag 8) */
  beginString: FIXVersion;
  /** Body length (tag 9) */
  bodyLength: number;
  /** Message type (tag 35) */
  msgType: string;
  /** Sequence number (tag 34) */
  msgSeqNum: number;
  /** Sender CompID (tag 49) */
  senderCompID: string;
  /** Target CompID (tag 56) */
  targetCompID: string;
  /** Sending time (tag 52) */
  sendingTime: string;
  /** Checksum (tag 10) */
  checkSum: string;
}

/**
 * FIX Quote Request fields mapped to Deluthium concepts.
 */
export interface FIXQuoteRequestFields {
  /** Quote request ID (tag 131) */
  quoteReqID: string;
  /** Symbol/pair (tag 55), e.g. "BTC/USDT" */
  symbol: string;
  /** Side: buy or sell (tag 54) */
  side: FIXSide;
  /** Order quantity (tag 38) */
  orderQty: string;
  /** Currency (tag 15) */
  currency?: string;
  /** Settlement date (tag 64) */
  settlDate?: string;
  /** Account (tag 1) */
  account?: string;
  /** Transact time (tag 60) */
  transactTime?: string;
  /** Quote validity in seconds */
  validUntilTime?: string;
}

/**
 * FIX Quote response fields.
 */
export interface FIXQuoteFields {
  /** Quote request ID (tag 131) */
  quoteReqID: string;
  /** Quote ID (tag 117) */
  quoteID: string;
  /** Symbol (tag 55) */
  symbol: string;
  /** Bid price (tag 132) */
  bidPx?: string;
  /** Offer price (tag 133) */
  offerPx?: string;
  /** Bid size (tag 134) */
  bidSize?: string;
  /** Offer size (tag 135) */
  offerSize?: string;
  /** Valid until time (tag 62) */
  validUntilTime: string;
  /** Transact time (tag 60) */
  transactTime: string;
  /** Quote type (tag 537) -- 0=Indicative, 1=Tradeable */
  quoteType: '0' | '1';
}

/**
 * FIX Execution Report fields.
 */
export interface FIXExecutionReportFields {
  /** Order ID (tag 37) */
  orderID: string;
  /** Exec ID (tag 17) */
  execID: string;
  /** Exec type (tag 150) */
  execType: string;
  /** Ord status (tag 39) */
  ordStatus: FIXOrdStatus;
  /** Symbol (tag 55) */
  symbol: string;
  /** Side (tag 54) */
  side: FIXSide;
  /** Leaves qty (tag 151) */
  leavesQty: string;
  /** Cum qty (tag 14) */
  cumQty: string;
  /** Avg price (tag 6) */
  avgPx: string;
  /** Last quantity (tag 32) */
  lastQty?: string;
  /** Last price (tag 31) */
  lastPx?: string;
  /** Transact time (tag 60) */
  transactTime: string;
  /** Text/reason (tag 58) */
  text?: string;
}

/**
 * FIX session configuration for a single counterparty.
 */
export interface FIXSessionConfig {
  /** FIX protocol version */
  fixVersion: FIXVersion;
  /** Our CompID */
  senderCompID: string;
  /** Counterparty CompID */
  targetCompID: string;
  /** Heartbeat interval in seconds (default 30) */
  heartbeatIntervalSec?: number;
  /** Whether to reset sequence numbers on logon */
  resetOnLogon?: boolean;
  /** Maximum number of messages in resend window */
  maxResendWindow?: number;
  /** Session start time (UTC, "HH:MM:SS") */
  startTime?: string;
  /** Session end time (UTC, "HH:MM:SS") */
  endTime?: string;
  /** Password for logon (tag 554) */
  password?: string;
  /** Default account for orders */
  defaultAccount?: string;
}

/**
 * FIX session state tracking.
 */
export interface FIXSessionState {
  /** Whether the session has completed logon */
  loggedOn: boolean;
  /** Outbound message sequence number */
  outMsgSeqNum: number;
  /** Expected inbound message sequence number */
  inMsgSeqNum: number;
  /** Last heartbeat sent timestamp (ms) */
  lastHeartbeatSent: number;
  /** Last heartbeat received timestamp (ms) */
  lastHeartbeatReceived: number;
  /** Number of messages sent */
  messagesSent: number;
  /** Number of messages received */
  messagesReceived: number;
  /** Session creation time */
  createdAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
}

// ============================================================================
// FIX Server Configuration
// ============================================================================

/**
 * FIX gateway server configuration.
 */
export interface FIXServerConfig {
  /** TCP port to listen on (default 9876) */
  port: number;
  /** Bind address (default "0.0.0.0") */
  host?: string;
  /** TLS key file path (optional, for FIX over TLS) */
  tlsKeyPath?: string;
  /** TLS cert file path */
  tlsCertPath?: string;
  /** Maximum number of concurrent sessions */
  maxSessions?: number;
  /** Session configurations by counterparty CompID */
  sessions: Record<string, FIXSessionConfig>;
  /** IP allowlist -- only connections from these IPs will be accepted (CRIT-02) */
  allowedIPs?: string[];
}

// ============================================================================
// OTC API Types
// ============================================================================

/**
 * RFQ workflow states.
 */
export enum RFQStatus {
  /** RFQ received, awaiting quote */
  Pending = 'pending',
  /** Quote generated, awaiting acceptance */
  Quoted = 'quoted',
  /** Quote accepted by counterparty */
  Accepted = 'accepted',
  /** Quote rejected by counterparty */
  Rejected = 'rejected',
  /** Trade executed on-chain */
  Executed = 'executed',
  /** Trade settled (funds transferred) */
  Settled = 'settled',
  /** Quote expired without action */
  Expired = 'expired',
  /** Trade failed on-chain */
  Failed = 'failed',
  /** RFQ cancelled by requester */
  Cancelled = 'cancelled',
}

/**
 * OTC RFQ request from an institutional counterparty.
 */
export interface OTCRFQRequest {
  /** Unique request ID */
  requestId: string;
  /** Counterparty identifier */
  counterpartyId: string;
  /** Base token symbol (e.g. "BTC", "ETH") */
  baseToken: string;
  /** Quote token symbol (e.g. "USDT", "USDC") */
  quoteToken: string;
  /** Side: buy or sell */
  side: 'buy' | 'sell';
  /** Quantity in base token units (human-readable) */
  quantity: string;
  /** Chain ID (if on-chain settlement) */
  chainId?: number;
  /** Base token address (for on-chain) */
  baseTokenAddress?: string;
  /** Quote token address (for on-chain) */
  quoteTokenAddress?: string;
  /** Settlement type */
  settlement: 'on-chain' | 'otc-bilateral' | 'prime-broker';
  /** Optional: max slippage tolerance (%) */
  maxSlippage?: number;
  /** Optional: quote validity requested (seconds) */
  quoteValiditySec?: number;
  /** Metadata / notes */
  metadata?: Record<string, unknown>;
  /** Request timestamp (ISO 8601) */
  timestamp: string;
}

/**
 * OTC quote response to a counterparty.
 */
export interface OTCQuoteResponse {
  /** Links back to the original request */
  requestId: string;
  /** Unique quote identifier */
  quoteId: string;
  /** Counterparty identifier */
  counterpartyId: string;
  /** Current status */
  status: RFQStatus;
  /** Bid price (if applicable) */
  bidPrice?: string;
  /** Ask price (if applicable) */
  askPrice?: string;
  /** Execution price */
  price: string;
  /** Quantity in base token */
  quantity: string;
  /** Total notional in quote token */
  notional: string;
  /** Fee rate in bps */
  feeRateBps: number;
  /** Fee amount in quote token */
  feeAmount: string;
  /** Quote expiry (ISO 8601) */
  expiresAt: string;
  /** On-chain data (if settlement is on-chain) */
  onChainData?: {
    chainId: number;
    routerAddress: string;
    calldata: string;
    firmQuoteId: string;
  };
  /** Quote creation timestamp */
  createdAt: string;
}

/**
 * OTC trade record (post-execution).
 */
export interface OTCTradeRecord {
  /** Unique trade ID */
  tradeId: string;
  /** Quote this trade executed */
  quoteId: string;
  /** Original request ID */
  requestId: string;
  /** Counterparty */
  counterpartyId: string;
  /** Base token */
  baseToken: string;
  /** Quote token */
  quoteToken: string;
  /** Side */
  side: 'buy' | 'sell';
  /** Executed price */
  price: string;
  /** Executed quantity */
  quantity: string;
  /** Total notional */
  notional: string;
  /** Fee */
  feeAmount: string;
  /** Execution timestamp */
  executedAt: string;
  /** Settlement status */
  settlementStatus: 'pending' | 'settling' | 'settled' | 'failed';
  /** On-chain transaction hash (if applicable) */
  txHash?: string;
  /** Chain ID (if on-chain) */
  chainId?: number;
}

// ============================================================================
// Audit Trail Types
// ============================================================================

/**
 * Audit event types for compliance tracking.
 */
export enum AuditEventType {
  /** New RFQ received */
  RFQReceived = 'rfq.received',
  /** Quote generated */
  QuoteGenerated = 'quote.generated',
  /** Quote sent to counterparty */
  QuoteSent = 'quote.sent',
  /** Quote accepted */
  QuoteAccepted = 'quote.accepted',
  /** Quote rejected */
  QuoteRejected = 'quote.rejected',
  /** Quote expired */
  QuoteExpired = 'quote.expired',
  /** Trade executed */
  TradeExecuted = 'trade.executed',
  /** Trade settled */
  TradeSettled = 'trade.settled',
  /** Trade failed */
  TradeFailed = 'trade.failed',
  /** FIX session logon */
  FIXLogon = 'fix.logon',
  /** FIX session logout */
  FIXLogout = 'fix.logout',
  /** FIX message sent */
  FIXMessageSent = 'fix.message_sent',
  /** FIX message received */
  FIXMessageReceived = 'fix.message_received',
  /** Counterparty verified */
  CounterpartyVerified = 'counterparty.verified',
  /** Error occurred */
  Error = 'error',
}

/**
 * Audit log entry with full context.
 */
export interface AuditEntry {
  /** Unique event ID */
  eventId: string;
  /** Event type */
  eventType: AuditEventType;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Actor (system, counterparty ID, user) */
  actor: string;
  /** Human-readable description */
  description: string;
  /** Related entity IDs */
  relatedIds: {
    requestId?: string;
    quoteId?: string;
    tradeId?: string;
    sessionId?: string;
    counterpartyId?: string;
  };
  /** Structured event data */
  data?: Record<string, unknown>;
  /** IP address of counterparty (if applicable) */
  sourceIp?: string;
  /** Severity level */
  severity: 'info' | 'warn' | 'error' | 'critical';
}

/**
 * Audit trail sink interface -- implementations persist entries.
 */
export interface AuditSink {
  /** Write an audit entry */
  write(entry: AuditEntry): Promise<void>;
  /** Query audit entries */
  query(filter: AuditQueryFilter): Promise<AuditEntry[]>;
}

/**
 * Filter for querying audit entries.
 */
export interface AuditQueryFilter {
  /** Filter by event type(s) */
  eventTypes?: AuditEventType[];
  /** Filter by actor */
  actor?: string;
  /** Filter by related request ID */
  requestId?: string;
  /** Filter by related quote ID */
  quoteId?: string;
  /** Filter by related trade ID */
  tradeId?: string;
  /** Filter by counterparty */
  counterpartyId?: string;
  /** Start time (ISO 8601) */
  startTime?: string;
  /** End time (ISO 8601) */
  endTime?: string;
  /** Maximum entries to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// ============================================================================
// Aggregator Bridge Types
// ============================================================================

/**
 * Result of verifying an aggregator integration path.
 */
export interface AggregatorVerificationResult {
  /** Aggregator name ("0x" or "1inch") */
  aggregator: string;
  /** Whether the integration path is functional */
  operational: boolean;
  /** Test results for each check */
  checks: AggregatorCheck[];
  /** Verification timestamp */
  verifiedAt: string;
  /** Overall latency (ms) */
  latencyMs: number;
  /** Error message if not operational */
  error?: string;
}

/**
 * Individual check within aggregator verification.
 */
export interface AggregatorCheck {
  /** Check name */
  name: string;
  /** Whether the check passed */
  passed: boolean;
  /** Latency for this check (ms) */
  latencyMs: number;
  /** Details or error message */
  details: string;
}

// ============================================================================
// Token Symbol-to-Address Mapping
// ============================================================================

/**
 * Maps token symbols to on-chain addresses per chain.
 */
export interface TokenMapping {
  symbol: string;
  name: string;
  decimals: number;
  addresses: Record<number, string>; // chainId -> address
}

// ============================================================================
// Institutional Adapter Configuration
// ============================================================================

/**
 * Known institutional counterparty configuration.
 */
export interface CounterpartyConfig {
  /** Unique counterparty identifier */
  id: string;
  /** Display name */
  name: string;
  /** Counterparty type */
  type: 'market-maker' | 'hedge-fund' | 'prop-trading' | 'otc-desk' | 'other';
  /** FIX CompID (if using FIX) */
  fixCompID?: string;
  /** API key (if using OTC API) */
  apiKey?: string;
  /** Allowed IP addresses */
  allowedIPs?: string[];
  /** Default settlement method */
  defaultSettlement: 'on-chain' | 'otc-bilateral' | 'prime-broker';
  /** Custom fee rate override (bps) */
  feeRateBps?: number;
  /** Maximum trade size in USD */
  maxTradeSizeUsd?: number;
  /** Enabled token pairs */
  enabledPairs?: string[];
  /** Wallet address for on-chain settlements */
  walletAddress?: string;
  /** Active status */
  active: boolean;
}

/**
 * Full institutional adapter configuration.
 */
export interface InstitutionalAdapterConfig {
  /** Deluthium SDK client configuration */
  deluthiumConfig: DeluthiumClientConfig;
  /** Signer for on-chain operations */
  signer: ISigner;
  /** FIX gateway configuration (optional -- omit to disable FIX) */
  fixConfig?: FIXServerConfig;
  /** OTC API configuration */
  otcApiConfig?: {
    /** HTTP port for REST API (default 8080) */
    port: number;
    /** Bind host (default "0.0.0.0") */
    host?: string;
    /** API key header name (default "X-API-Key") */
    apiKeyHeader?: string;
    /** Enable WebSocket server (default true) */
    enableWebSocket?: boolean;
    /** CORS origins (default ["*"]) */
    corsOrigins?: string[];
  };
  /** Known counterparties */
  counterparties: Record<string, CounterpartyConfig>;
  /** Token symbol-to-address mappings */
  tokenMappings: TokenMapping[];
  /** Default chain ID for on-chain settlement */
  defaultChainId: number;
  /** Default quote validity in seconds (default 30) */
  defaultQuoteValiditySec?: number;
  /** Default fee rate in bps (default 5) */
  defaultFeeRateBps?: number;
  /** Audit trail sink (optional -- defaults to in-memory) */
  auditSink?: AuditSink;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Events emitted by the institutional adapter.
 */
export interface InstitutionalAdapterEvents {
  /** FIX session connected */
  fixSessionConnected: (counterpartyId: string) => void;
  /** FIX session disconnected */
  fixSessionDisconnected: (counterpartyId: string, reason: string) => void;
  /** RFQ received (from any channel) */
  rfqReceived: (request: OTCRFQRequest) => void;
  /** Quote generated */
  quoteGenerated: (quote: OTCQuoteResponse) => void;
  /** Quote accepted */
  quoteAccepted: (quoteId: string, counterpartyId: string) => void;
  /** Quote rejected */
  quoteRejected: (quoteId: string, counterpartyId: string, reason?: string) => void;
  /** Trade executed */
  tradeExecuted: (trade: OTCTradeRecord) => void;
  /** Error */
  error: (error: Error) => void;
}

// ============================================================================
// Helper type for Deluthium quote data
// ============================================================================

/**
 * Combined indicative + firm quote data from Deluthium.
 */
export interface DeluthiumQuoteData {
  indicative?: IndicativeQuoteResponse;
  firm?: FirmQuoteResponse;
  requestedAt: number;
  receivedAt: number;
}
