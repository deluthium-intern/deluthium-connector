/**
 * FIX Protocol Message Parser and Builder
 *
 * Implements FIX 4.4 / FIXT 1.1 message serialization/deserialization.
 *
 * FIX messages use SOH (0x01) as field delimiter:
 *   8=FIX.4.4|9=123|35=R|49=SENDER|56=TARGET|34=1|52=20260207-12:00:00|...|10=123|
 *
 * Standard FIX tag numbers used:
 *   8  = BeginString       9  = BodyLength      10 = CheckSum
 *   34 = MsgSeqNum         35 = MsgType         49 = SenderCompID
 *   52 = SendingTime       56 = TargetCompID
 */

import type {
  FIXMessage,
  FIXVersion,
  FIXQuoteRequestFields,
  FIXQuoteFields,
  FIXExecutionReportFields,
  FIXSide,
} from '../types.js';
import { FIXMsgType } from '../types.js';

/** SOH (Start of Header) delimiter used in FIX messages */
const SOH = '\x01';

/** Standard FIX date format: YYYYMMDD-HH:MM:SS.sss */
const FIX_TIMESTAMP_FORMAT = /^\d{8}-\d{2}:\d{2}:\d{2}(\.\d{3})?$/;

// ============================================================================
// FIX Message Parsing
// ============================================================================

/**
 * Parse a raw FIX message string into a structured FIXMessage.
 *
 * @param raw - Raw FIX message bytes/string (SOH-delimited)
 * @returns Parsed FIXMessage
 * @throws Error if message is malformed
 */
export function parseFIXMessage(raw: string | Buffer): FIXMessage {
  const str = typeof raw === 'string' ? raw : raw.toString('ascii');
  const fields = new Map<number, string>();

  // Split by SOH and parse tag=value pairs
  const pairs = str.split(SOH).filter((p) => p.length > 0);

  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) continue;

    const tag = parseInt(pair.substring(0, eqIdx), 10);
    const value = pair.substring(eqIdx + 1);

    if (!isNaN(tag)) {
      fields.set(tag, value);
    }
  }

  // Extract required header fields
  const beginString = (fields.get(8) ?? 'FIX.4.4') as FIXVersion;
  const bodyLength = parseInt(fields.get(9) ?? '0', 10);
  const msgType = fields.get(35) ?? '';
  const msgSeqNum = parseInt(fields.get(34) ?? '0', 10);
  const senderCompID = fields.get(49) ?? '';
  const targetCompID = fields.get(56) ?? '';
  const sendingTime = fields.get(52) ?? '';
  const checkSum = fields.get(10) ?? '';

  if (!msgType) {
    throw new FIXParseError('Missing MsgType (tag 35)');
  }

  if (!senderCompID) {
    throw new FIXParseError('Missing SenderCompID (tag 49)');
  }

  return {
    fields,
    beginString,
    bodyLength,
    msgType,
    msgSeqNum,
    senderCompID,
    targetCompID,
    sendingTime,
    checkSum,
  };
}

/**
 * Validate FIX message checksum.
 *
 * The checksum is the sum of all bytes (before tag 10) modulo 256,
 * formatted as a 3-digit string.
 */
export function validateChecksum(raw: string | Buffer): boolean {
  const str = typeof raw === 'string' ? raw : raw.toString('ascii');

  // Find the last 10= tag
  const checksumTagStart = str.lastIndexOf('10=');
  if (checksumTagStart === -1) return false;

  // Sum all bytes before the checksum field
  const bodyPortion = str.substring(0, checksumTagStart);
  let sum = 0;
  for (let i = 0; i < bodyPortion.length; i++) {
    sum += bodyPortion.charCodeAt(i);
  }

  const expectedChecksum = (sum % 256).toString().padStart(3, '0');
  const actualChecksum = str.substring(checksumTagStart + 3).replace(SOH, '');

  return expectedChecksum === actualChecksum;
}

// ============================================================================
// FIX Message Building
// ============================================================================

/**
 * Builder for constructing FIX messages.
 *
 * Usage:
 *   const msg = new FIXMessageBuilder('FIX.4.4', 'R', 'DELUTHIUM', 'WINTERMUTE', 1)
 *     .setField(131, 'REQ-001')
 *     .setField(55, 'BTC/USDT')
 *     .build();
 */
export class FIXMessageBuilder {
  private readonly fields = new Map<number, string>();

  constructor(
    fixVersion: FIXVersion,
    msgType: string,
    senderCompID: string,
    targetCompID: string,
    msgSeqNum: number,
  ) {
    this.fields.set(8, fixVersion);
    this.fields.set(35, msgType);
    this.fields.set(49, senderCompID);
    this.fields.set(56, targetCompID);
    this.fields.set(34, msgSeqNum.toString());
    this.fields.set(52, formatFIXTimestamp(new Date()));
  }

  /**
   * Set a FIX tag-value field.
   */
  setField(tag: number, value: string | number): this {
    this.fields.set(tag, String(value));
    return this;
  }

  /**
   * Set multiple fields at once.
   */
  setFields(fields: Record<number, string | number>): this {
    for (const [tag, value] of Object.entries(fields)) {
      this.fields.set(parseInt(tag, 10), String(value));
    }
    return this;
  }

  /**
   * Build the complete FIX message string (SOH-delimited).
   * Automatically calculates BodyLength (tag 9) and Checksum (tag 10).
   */
  build(): string {
    // Build body (everything except 8=, 9=, 10=)
    const bodyTags: number[] = [];
    for (const tag of this.fields.keys()) {
      if (tag !== 8 && tag !== 9 && tag !== 10) {
        bodyTags.push(tag);
      }
    }

    // Sort tags to ensure deterministic ordering (35 first, then numeric)
    bodyTags.sort((a, b) => {
      if (a === 35) return -1;
      if (b === 35) return 1;
      return a - b;
    });

    const bodyParts: string[] = [];
    for (const tag of bodyTags) {
      bodyParts.push(`${tag}=${this.fields.get(tag)}`);
    }
    const body = bodyParts.join(SOH) + SOH;

    // Calculate body length
    const bodyLength = Buffer.byteLength(body, 'ascii');

    // Build full message (without checksum)
    const beginString = this.fields.get(8) ?? 'FIX.4.4';
    const prefix = `8=${beginString}${SOH}9=${bodyLength}${SOH}`;
    const withoutChecksum = prefix + body;

    // Calculate checksum
    let sum = 0;
    for (let i = 0; i < withoutChecksum.length; i++) {
      sum += withoutChecksum.charCodeAt(i);
    }
    const checksum = (sum % 256).toString().padStart(3, '0');

    return withoutChecksum + `10=${checksum}${SOH}`;
  }
}

// ============================================================================
// Specialized Message Builders
// ============================================================================

/**
 * Build a FIX Logon message (MsgType A).
 */
export function buildLogonMessage(
  fixVersion: FIXVersion,
  senderCompID: string,
  targetCompID: string,
  msgSeqNum: number,
  heartbeatIntervalSec: number,
  password?: string,
  resetSeqNum?: boolean,
): string {
  const builder = new FIXMessageBuilder(fixVersion, FIXMsgType.Logon, senderCompID, targetCompID, msgSeqNum)
    .setField(98, '0') // EncryptMethod = None
    .setField(108, heartbeatIntervalSec); // HeartBtInt

  if (password) {
    builder.setField(554, password);
  }

  if (resetSeqNum) {
    builder.setField(141, 'Y'); // ResetSeqNumFlag
  }

  return builder.build();
}

/**
 * Build a FIX Heartbeat message (MsgType 0).
 */
export function buildHeartbeatMessage(
  fixVersion: FIXVersion,
  senderCompID: string,
  targetCompID: string,
  msgSeqNum: number,
  testReqID?: string,
): string {
  const builder = new FIXMessageBuilder(fixVersion, FIXMsgType.Heartbeat, senderCompID, targetCompID, msgSeqNum);

  if (testReqID) {
    builder.setField(112, testReqID); // TestReqID
  }

  return builder.build();
}

/**
 * Build a FIX Logout message (MsgType 5).
 */
export function buildLogoutMessage(
  fixVersion: FIXVersion,
  senderCompID: string,
  targetCompID: string,
  msgSeqNum: number,
  text?: string,
): string {
  const builder = new FIXMessageBuilder(fixVersion, FIXMsgType.Logout, senderCompID, targetCompID, msgSeqNum);

  if (text) {
    builder.setField(58, text); // Text
  }

  return builder.build();
}

/**
 * Build a FIX Quote message (MsgType S) in response to a QuoteRequest.
 */
export function buildQuoteMessage(
  fixVersion: FIXVersion,
  senderCompID: string,
  targetCompID: string,
  msgSeqNum: number,
  fields: FIXQuoteFields,
): string {
  const builder = new FIXMessageBuilder(fixVersion, FIXMsgType.Quote, senderCompID, targetCompID, msgSeqNum)
    .setField(131, fields.quoteReqID)
    .setField(117, fields.quoteID)
    .setField(55, fields.symbol)
    .setField(60, fields.transactTime)
    .setField(62, fields.validUntilTime)
    .setField(537, fields.quoteType);

  if (fields.bidPx) builder.setField(132, fields.bidPx);
  if (fields.offerPx) builder.setField(133, fields.offerPx);
  if (fields.bidSize) builder.setField(134, fields.bidSize);
  if (fields.offerSize) builder.setField(135, fields.offerSize);

  return builder.build();
}

/**
 * Build a FIX Execution Report (MsgType 8).
 */
export function buildExecutionReport(
  fixVersion: FIXVersion,
  senderCompID: string,
  targetCompID: string,
  msgSeqNum: number,
  fields: FIXExecutionReportFields,
): string {
  const builder = new FIXMessageBuilder(fixVersion, FIXMsgType.ExecutionReport, senderCompID, targetCompID, msgSeqNum)
    .setField(37, fields.orderID)
    .setField(17, fields.execID)
    .setField(150, fields.execType)
    .setField(39, fields.ordStatus)
    .setField(55, fields.symbol)
    .setField(54, fields.side)
    .setField(151, fields.leavesQty)
    .setField(14, fields.cumQty)
    .setField(6, fields.avgPx)
    .setField(60, fields.transactTime);

  if (fields.lastQty) builder.setField(32, fields.lastQty);
  if (fields.lastPx) builder.setField(31, fields.lastPx);
  if (fields.text) builder.setField(58, fields.text);

  return builder.build();
}

/**
 * Build a FIX Reject message (MsgType 3).
 */
export function buildRejectMessage(
  fixVersion: FIXVersion,
  senderCompID: string,
  targetCompID: string,
  msgSeqNum: number,
  refSeqNum: number,
  refMsgType: string,
  reason: string,
  sessionRejectReason?: number,
): string {
  const builder = new FIXMessageBuilder(fixVersion, FIXMsgType.Reject, senderCompID, targetCompID, msgSeqNum)
    .setField(45, refSeqNum) // RefSeqNum
    .setField(372, refMsgType) // RefMsgType
    .setField(58, reason); // Text

  if (sessionRejectReason !== undefined) {
    builder.setField(373, sessionRejectReason); // SessionRejectReason
  }

  return builder.build();
}

/**
 * Build a FIX Business Reject message (MsgType j).
 */
export function buildBusinessRejectMessage(
  fixVersion: FIXVersion,
  senderCompID: string,
  targetCompID: string,
  msgSeqNum: number,
  refSeqNum: number,
  refMsgType: string,
  businessRejectReason: number,
  text: string,
): string {
  return new FIXMessageBuilder(fixVersion, FIXMsgType.BusinessReject, senderCompID, targetCompID, msgSeqNum)
    .setField(45, refSeqNum) // RefSeqNum
    .setField(372, refMsgType) // RefMsgType
    .setField(380, businessRejectReason) // BusinessRejectReason
    .setField(58, text) // Text
    .build();
}

// ============================================================================
// Field Extractors
// ============================================================================

/**
 * Extract QuoteRequest fields from a parsed FIX message.
 */
export function extractQuoteRequestFields(msg: FIXMessage): FIXQuoteRequestFields {
  const fields = msg.fields;

  return {
    quoteReqID: fields.get(131) ?? '',
    symbol: fields.get(55) ?? '',
    side: (fields.get(54) ?? '1') as FIXSide,
    orderQty: fields.get(38) ?? '0',
    currency: fields.get(15),
    settlDate: fields.get(64),
    account: fields.get(1),
    transactTime: fields.get(60),
    validUntilTime: fields.get(126),
  };
}

/**
 * Extract NewOrderSingle fields from a parsed FIX message.
 */
export function extractNewOrderSingleFields(msg: FIXMessage): {
  clOrdID: string;
  symbol: string;
  side: FIXSide;
  orderQty: string;
  ordType: string;
  price?: string;
  quoteID?: string;
  account?: string;
  timeInForce?: string;
  transactTime: string;
} {
  const fields = msg.fields;

  return {
    clOrdID: fields.get(11) ?? '',
    symbol: fields.get(55) ?? '',
    side: (fields.get(54) ?? '1') as FIXSide,
    orderQty: fields.get(38) ?? '0',
    ordType: fields.get(40) ?? '2',
    price: fields.get(44),
    quoteID: fields.get(117),
    account: fields.get(1),
    timeInForce: fields.get(59),
    transactTime: fields.get(60) ?? formatFIXTimestamp(new Date()),
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format a Date object into FIX timestamp format (YYYYMMDD-HH:MM:SS.sss).
 */
export function formatFIXTimestamp(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${y}${m}${d}-${h}:${min}:${s}.${ms}`;
}

/**
 * Parse a FIX timestamp into a Date object.
 */
export function parseFIXTimestamp(timestamp: string): Date {
  if (!FIX_TIMESTAMP_FORMAT.test(timestamp)) {
    throw new FIXParseError(`Invalid FIX timestamp format: ${timestamp}`);
  }

  const year = parseInt(timestamp.substring(0, 4), 10);
  const month = parseInt(timestamp.substring(4, 6), 10) - 1;
  const day = parseInt(timestamp.substring(6, 8), 10);
  const hour = parseInt(timestamp.substring(9, 11), 10);
  const minute = parseInt(timestamp.substring(12, 14), 10);
  const second = parseInt(timestamp.substring(15, 17), 10);
  const ms = timestamp.length > 17 ? parseInt(timestamp.substring(18, 21), 10) : 0;

  return new Date(Date.UTC(year, month, day, hour, minute, second, ms));
}

/**
 * Generate a unique FIX ID (for QuoteID, ExecID, etc.).
 */
export function generateFIXId(prefix: string = 'DLT'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown when FIX message parsing fails.
 */
export class FIXParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FIXParseError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
