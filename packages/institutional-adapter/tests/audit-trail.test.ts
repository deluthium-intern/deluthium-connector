/**
 * Tests for @deluthium/institutional-adapter -- Audit Trail
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AuditTrail,
  InMemoryAuditSink,
  AuditEventType,
} from '../src/index.js';

describe('InMemoryAuditSink', () => {
  let sink: InMemoryAuditSink;

  beforeEach(() => {
    sink = new InMemoryAuditSink({ maxEntries: 100 });
  });

  it('should store and retrieve entries', async () => {
    await sink.write({
      eventId: 'evt-1',
      eventType: AuditEventType.RFQReceived,
      timestamp: new Date().toISOString(),
      actor: 'wintermute',
      description: 'Test RFQ',
      relatedIds: { requestId: 'req-1', counterpartyId: 'wintermute' },
      severity: 'info',
    });

    const results = await sink.query({});
    assert.equal(results.length, 1);
    assert.equal(results[0]!.eventId, 'evt-1');
  });

  it('should enforce max entries', async () => {
    for (let i = 0; i < 150; i++) {
      await sink.write({
        eventId: `evt-${i}`,
        eventType: AuditEventType.RFQReceived,
        timestamp: new Date().toISOString(),
        actor: 'test',
        description: `Entry ${i}`,
        relatedIds: {},
        severity: 'info',
      });
    }

    assert.equal(sink.getCount(), 100);
  });

  it('should filter by event type', async () => {
    await sink.write({
      eventId: 'evt-1',
      eventType: AuditEventType.RFQReceived,
      timestamp: new Date().toISOString(),
      actor: 'test',
      description: 'RFQ',
      relatedIds: {},
      severity: 'info',
    });

    await sink.write({
      eventId: 'evt-2',
      eventType: AuditEventType.TradeExecuted,
      timestamp: new Date().toISOString(),
      actor: 'test',
      description: 'Trade',
      relatedIds: {},
      severity: 'info',
    });

    const rfqOnly = await sink.query({ eventTypes: [AuditEventType.RFQReceived] });
    assert.equal(rfqOnly.length, 1);
    assert.equal(rfqOnly[0]!.eventType, AuditEventType.RFQReceived);
  });

  it('should filter by counterparty', async () => {
    await sink.write({
      eventId: 'evt-1',
      eventType: AuditEventType.RFQReceived,
      timestamp: new Date().toISOString(),
      actor: 'wintermute',
      description: 'WM RFQ',
      relatedIds: { counterpartyId: 'wintermute' },
      severity: 'info',
    });

    await sink.write({
      eventId: 'evt-2',
      eventType: AuditEventType.RFQReceived,
      timestamp: new Date().toISOString(),
      actor: 'gsr',
      description: 'GSR RFQ',
      relatedIds: { counterpartyId: 'gsr' },
      severity: 'info',
    });

    const wmOnly = await sink.query({ counterpartyId: 'wintermute' });
    assert.equal(wmOnly.length, 1);
    assert.equal(wmOnly[0]!.relatedIds.counterpartyId, 'wintermute');
  });

  it('should support pagination', async () => {
    for (let i = 0; i < 10; i++) {
      await sink.write({
        eventId: `evt-${i}`,
        eventType: AuditEventType.RFQReceived,
        timestamp: new Date().toISOString(),
        actor: 'test',
        description: `Entry ${i}`,
        relatedIds: {},
        severity: 'info',
      });
    }

    const page1 = await sink.query({ limit: 3, offset: 0 });
    assert.equal(page1.length, 3);
    assert.equal(page1[0]!.eventId, 'evt-0');

    const page2 = await sink.query({ limit: 3, offset: 3 });
    assert.equal(page2.length, 3);
    assert.equal(page2[0]!.eventId, 'evt-3');
  });

  it('should clear entries', async () => {
    await sink.write({
      eventId: 'evt-1',
      eventType: AuditEventType.RFQReceived,
      timestamp: new Date().toISOString(),
      actor: 'test',
      description: 'Test',
      relatedIds: {},
      severity: 'info',
    });

    assert.equal(sink.getCount(), 1);
    sink.clear();
    assert.equal(sink.getCount(), 0);
  });
});

describe('AuditTrail', () => {
  let trail: AuditTrail;

  beforeEach(() => {
    trail = new AuditTrail();
  });

  it('should log RFQ received', async () => {
    const entry = await trail.logRFQReceived({
      requestId: 'req-001',
      counterpartyId: 'wintermute',
      description: 'RFQ for 100 BTC/USDT',
      sourceIp: '1.2.3.4',
    });

    assert.equal(entry.eventType, AuditEventType.RFQReceived);
    assert.equal(entry.actor, 'wintermute');
    assert.equal(entry.relatedIds.requestId, 'req-001');
    assert.equal(entry.sourceIp, '1.2.3.4');
    assert.ok(entry.eventId.startsWith('aud-'));
    assert.ok(entry.timestamp);
  });

  it('should log quote generated', async () => {
    const entry = await trail.logQuoteGenerated({
      requestId: 'req-001',
      quoteId: 'qte-001',
      counterpartyId: 'gsr',
      description: 'Quote for BTC/USDT @ 45000',
      data: { price: '45000', notional: '4500000' },
    });

    assert.equal(entry.eventType, AuditEventType.QuoteGenerated);
    assert.equal(entry.relatedIds.quoteId, 'qte-001');
    assert.equal(entry.data?.price, '45000');
  });

  it('should log trade executed', async () => {
    const entry = await trail.logTradeExecuted({
      requestId: 'req-001',
      quoteId: 'qte-001',
      tradeId: 'trd-001',
      counterpartyId: 'jump',
      description: 'Trade executed',
    });

    assert.equal(entry.eventType, AuditEventType.TradeExecuted);
    assert.equal(entry.relatedIds.tradeId, 'trd-001');
  });

  it('should log FIX session events', async () => {
    const logon = await trail.logFIXLogon({
      sessionId: 'DELUTHIUM->WINTERMUTE',
      counterpartyId: 'wintermute',
      sourceIp: '10.0.0.1',
    });

    assert.equal(logon.eventType, AuditEventType.FIXLogon);
    assert.equal(logon.sourceIp, '10.0.0.1');

    const logout = await trail.logFIXLogout({
      sessionId: 'DELUTHIUM->WINTERMUTE',
      counterpartyId: 'wintermute',
      reason: 'Session ended',
    });

    assert.equal(logout.eventType, AuditEventType.FIXLogout);
  });

  it('should log errors with stack traces', async () => {
    const err = new Error('Connection refused');
    const entry = await trail.logError({
      description: 'FIX connection failed',
      error: err,
      relatedIds: { sessionId: 'sess-001' },
    });

    assert.equal(entry.eventType, AuditEventType.Error);
    assert.equal(entry.severity, 'error');
    assert.ok(entry.data?.error);
    assert.ok(entry.data?.stack);
  });

  it('should query entries by request ID', async () => {
    await trail.logRFQReceived({
      requestId: 'req-100',
      counterpartyId: 'gsr',
      description: 'RFQ',
    });
    await trail.logQuoteGenerated({
      requestId: 'req-100',
      quoteId: 'qte-100',
      counterpartyId: 'gsr',
      description: 'Quote',
    });
    await trail.logRFQReceived({
      requestId: 'req-200',
      counterpartyId: 'gsr',
      description: 'Another RFQ',
    });

    const history = await trail.getRFQHistory('req-100');
    assert.equal(history.length, 2);
    assert.ok(history.every((e) => e.relatedIds.requestId === 'req-100'));
  });

  it('should generate unique event IDs', async () => {
    const entry1 = await trail.logRFQReceived({
      requestId: 'req-1',
      counterpartyId: 'a',
      description: 'Test 1',
    });
    const entry2 = await trail.logRFQReceived({
      requestId: 'req-2',
      counterpartyId: 'b',
      description: 'Test 2',
    });

    assert.notEqual(entry1.eventId, entry2.eventId);
  });
});
