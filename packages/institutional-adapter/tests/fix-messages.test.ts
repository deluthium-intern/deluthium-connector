/**
 * Tests for @deluthium/institutional-adapter -- FIX Message Parser/Builder
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFIXMessage,
  validateChecksum,
  FIXMessageBuilder,
  buildLogonMessage,
  buildHeartbeatMessage,
  buildLogoutMessage,
  buildQuoteMessage,
  buildExecutionReport,
  buildRejectMessage,
  extractQuoteRequestFields,
  formatFIXTimestamp,
  parseFIXTimestamp,
  generateFIXId,
  FIXParseError,
} from '../src/fix-gateway/fix-messages.js';
import { FIXMsgType, FIXOrdStatus, FIXSide } from '../src/types.js';

const SOH = '\x01';

describe('FIX Message Parser', () => {
  it('should parse a basic FIX message', () => {
    const raw = [
      '8=FIX.4.4',
      '9=100',
      '35=R',
      '49=WINTERMUTE',
      '56=DELUTHIUM',
      '34=1',
      '52=20260207-12:00:00.000',
      '131=REQ-001',
      '55=BTC/USDT',
      '54=1',
      '38=1000000000000000000',
      '10=123',
    ].join(SOH) + SOH;

    const msg = parseFIXMessage(raw);

    assert.equal(msg.beginString, 'FIX.4.4');
    assert.equal(msg.msgType, 'R'); // QuoteRequest
    assert.equal(msg.senderCompID, 'WINTERMUTE');
    assert.equal(msg.targetCompID, 'DELUTHIUM');
    assert.equal(msg.msgSeqNum, 1);
    assert.equal(msg.fields.get(131), 'REQ-001');
    assert.equal(msg.fields.get(55), 'BTC/USDT');
  });

  it('should throw on missing MsgType', () => {
    const raw = `8=FIX.4.4${SOH}9=10${SOH}49=SENDER${SOH}10=000${SOH}`;
    assert.throws(() => parseFIXMessage(raw), /Missing MsgType/);
  });

  it('should throw on missing SenderCompID', () => {
    const raw = `8=FIX.4.4${SOH}9=10${SOH}35=A${SOH}10=000${SOH}`;
    assert.throws(() => parseFIXMessage(raw), /Missing SenderCompID/);
  });

  it('should handle Buffer input', () => {
    const raw = Buffer.from(
      `8=FIX.4.4${SOH}9=10${SOH}35=0${SOH}49=A${SOH}56=B${SOH}34=1${SOH}10=000${SOH}`,
      'ascii',
    );
    const msg = parseFIXMessage(raw);
    assert.equal(msg.msgType, '0'); // Heartbeat
  });
});

describe('FIX Checksum Validation', () => {
  it('should validate a correct checksum', () => {
    // Build a message and verify its own checksum
    const msg = buildHeartbeatMessage('FIX.4.4', 'SENDER', 'TARGET', 1);
    assert.ok(validateChecksum(msg));
  });

  it('should reject an incorrect checksum', () => {
    const msg = `8=FIX.4.4${SOH}9=10${SOH}35=0${SOH}49=A${SOH}56=B${SOH}34=1${SOH}52=20260207-12:00:00.000${SOH}10=999${SOH}`;
    assert.equal(validateChecksum(msg), false);
  });
});

describe('FIX Message Builder', () => {
  it('should build a valid FIX message with correct checksum', () => {
    const builder = new FIXMessageBuilder('FIX.4.4', 'R', 'DELUTHIUM', 'WINTERMUTE', 1);
    builder.setField(131, 'REQ-001');
    builder.setField(55, 'BTC/USDT');
    builder.setField(54, '1');
    builder.setField(38, '1000000000000000000');

    const raw = builder.build();

    // Verify it starts with BeginString
    assert.ok(raw.startsWith('8=FIX.4.4'));

    // Verify checksum
    assert.ok(validateChecksum(raw));

    // Verify parseable
    const parsed = parseFIXMessage(raw);
    assert.equal(parsed.msgType, 'R');
    assert.equal(parsed.senderCompID, 'DELUTHIUM');
    assert.equal(parsed.targetCompID, 'WINTERMUTE');
    assert.equal(parsed.fields.get(131), 'REQ-001');
    assert.equal(parsed.fields.get(55), 'BTC/USDT');
  });

  it('should support setFields for bulk operations', () => {
    const builder = new FIXMessageBuilder('FIX.4.4', 'S', 'A', 'B', 1);
    builder.setFields({ 131: 'REQ-001', 117: 'QTE-001', 55: 'ETH/USDT' });

    const raw = builder.build();
    const parsed = parseFIXMessage(raw);

    assert.equal(parsed.fields.get(131), 'REQ-001');
    assert.equal(parsed.fields.get(117), 'QTE-001');
    assert.equal(parsed.fields.get(55), 'ETH/USDT');
  });
});

describe('Specialized Message Builders', () => {
  it('should build a Logon message', () => {
    const raw = buildLogonMessage('FIX.4.4', 'DELUTHIUM', 'WINTERMUTE', 1, 30, 'secret', true);
    const msg = parseFIXMessage(raw);

    assert.equal(msg.msgType, FIXMsgType.Logon);
    assert.equal(msg.fields.get(98), '0'); // EncryptMethod = None
    assert.equal(msg.fields.get(108), '30'); // HeartBtInt
    assert.equal(msg.fields.get(554), 'secret'); // Password
    assert.equal(msg.fields.get(141), 'Y'); // ResetSeqNumFlag
    assert.ok(validateChecksum(raw));
  });

  it('should build a Heartbeat message', () => {
    const raw = buildHeartbeatMessage('FIX.4.4', 'A', 'B', 5, 'TEST-123');
    const msg = parseFIXMessage(raw);

    assert.equal(msg.msgType, FIXMsgType.Heartbeat);
    assert.equal(msg.fields.get(112), 'TEST-123'); // TestReqID
  });

  it('should build a Logout message', () => {
    const raw = buildLogoutMessage('FIX.4.4', 'A', 'B', 10, 'Session ended');
    const msg = parseFIXMessage(raw);

    assert.equal(msg.msgType, FIXMsgType.Logout);
    assert.equal(msg.fields.get(58), 'Session ended');
  });

  it('should build a Quote message', () => {
    const raw = buildQuoteMessage('FIX.4.4', 'DELUTHIUM', 'GSR', 3, {
      quoteReqID: 'REQ-001',
      quoteID: 'QTE-001',
      symbol: 'BTC/USDT',
      bidPx: '45000.50',
      bidSize: '1000000000000000000',
      transactTime: '20260207-12:00:00.000',
      validUntilTime: '20260207-12:00:30.000',
      quoteType: '1',
    });
    const msg = parseFIXMessage(raw);

    assert.equal(msg.msgType, FIXMsgType.Quote);
    assert.equal(msg.fields.get(131), 'REQ-001');
    assert.equal(msg.fields.get(117), 'QTE-001');
    assert.equal(msg.fields.get(132), '45000.50');
    assert.equal(msg.fields.get(537), '1'); // Tradeable
  });

  it('should build an Execution Report', () => {
    const raw = buildExecutionReport('FIX.4.4', 'DELUTHIUM', 'JUMP', 5, {
      orderID: 'ORD-001',
      execID: 'EXC-001',
      execType: '2',
      ordStatus: FIXOrdStatus.Filled,
      symbol: 'ETH/USDT',
      side: FIXSide.Buy,
      leavesQty: '0',
      cumQty: '1000000000000000000',
      avgPx: '3200.75',
      lastQty: '1000000000000000000',
      lastPx: '3200.75',
      transactTime: '20260207-12:00:00.000',
    });
    const msg = parseFIXMessage(raw);

    assert.equal(msg.msgType, FIXMsgType.ExecutionReport);
    assert.equal(msg.fields.get(37), 'ORD-001');
    assert.equal(msg.fields.get(39), FIXOrdStatus.Filled);
    assert.equal(msg.fields.get(6), '3200.75');
  });

  it('should build a Reject message', () => {
    const raw = buildRejectMessage('FIX.4.4', 'A', 'B', 2, 1, 'R', 'Invalid symbol', 1);
    const msg = parseFIXMessage(raw);

    assert.equal(msg.msgType, FIXMsgType.Reject);
    assert.equal(msg.fields.get(45), '1'); // RefSeqNum
    assert.equal(msg.fields.get(372), 'R'); // RefMsgType
    assert.equal(msg.fields.get(58), 'Invalid symbol');
    assert.equal(msg.fields.get(373), '1'); // SessionRejectReason
  });
});

describe('Field Extractors', () => {
  it('should extract QuoteRequest fields', () => {
    const raw = new FIXMessageBuilder('FIX.4.4', 'R', 'WINTERMUTE', 'DELUTHIUM', 1)
      .setField(131, 'REQ-100')
      .setField(55, 'BNB/USDT')
      .setField(54, '1') // Buy
      .setField(38, '5000000000000000000') // 5 BNB
      .setField(15, 'USDT')
      .setField(1, 'ACC-001')
      .build();

    const msg = parseFIXMessage(raw);
    const fields = extractQuoteRequestFields(msg);

    assert.equal(fields.quoteReqID, 'REQ-100');
    assert.equal(fields.symbol, 'BNB/USDT');
    assert.equal(fields.side, FIXSide.Buy);
    assert.equal(fields.orderQty, '5000000000000000000');
    assert.equal(fields.currency, 'USDT');
    assert.equal(fields.account, 'ACC-001');
  });
});

describe('Timestamp Utilities', () => {
  it('should format a Date to FIX timestamp', () => {
    const date = new Date(Date.UTC(2026, 1, 7, 14, 30, 45, 123));
    const formatted = formatFIXTimestamp(date);
    assert.equal(formatted, '20260207-14:30:45.123');
  });

  it('should parse a FIX timestamp back to Date', () => {
    const timestamp = '20260207-14:30:45.123';
    const date = parseFIXTimestamp(timestamp);
    assert.equal(date.getUTCFullYear(), 2026);
    assert.equal(date.getUTCMonth(), 1); // February = 1
    assert.equal(date.getUTCDate(), 7);
    assert.equal(date.getUTCHours(), 14);
    assert.equal(date.getUTCMinutes(), 30);
    assert.equal(date.getUTCSeconds(), 45);
    assert.equal(date.getUTCMilliseconds(), 123);
  });

  it('should roundtrip format-parse', () => {
    const original = new Date(Date.UTC(2026, 5, 15, 9, 0, 0, 500));
    const formatted = formatFIXTimestamp(original);
    const parsed = parseFIXTimestamp(formatted);
    assert.equal(parsed.getTime(), original.getTime());
  });

  it('should reject invalid timestamp format', () => {
    assert.throws(() => parseFIXTimestamp('2026-02-07T12:00:00Z'), /Invalid FIX timestamp/);
  });
});

describe('ID Generation', () => {
  it('should generate unique IDs', () => {
    const id1 = generateFIXId('QTE');
    const id2 = generateFIXId('QTE');
    assert.notEqual(id1, id2);
  });

  it('should include the prefix', () => {
    const id = generateFIXId('EXC');
    assert.ok(id.startsWith('EXC-'));
  });

  it('should use default prefix', () => {
    const id = generateFIXId();
    assert.ok(id.startsWith('DLT-'));
  });
});
