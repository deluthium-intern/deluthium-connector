/**
 * FIX Session Manager
 *
 * Manages the state machine for FIX sessions:
 * - Logon / Logout handshake
 * - Heartbeat monitoring and generation
 * - Sequence number tracking
 * - Message resend handling
 *
 * Each counterparty has one session, identified by (SenderCompID, TargetCompID).
 */

import type { FIXMessage, FIXSessionConfig, FIXSessionState } from '../types.js';
import { FIXMsgType } from '../types.js';
import {
  parseFIXMessage,
  buildLogonMessage,
  buildLogoutMessage,
  buildHeartbeatMessage,
  buildRejectMessage,
} from './fix-messages.js';

// ============================================================================
// Session Events
// ============================================================================

type SessionEventHandler<T extends unknown[]> = (...args: T) => void;

interface SessionEventMap {
  logon: SessionEventHandler<[sessionId: string]>;
  logout: SessionEventHandler<[sessionId: string, reason: string]>;
  message: SessionEventHandler<[sessionId: string, msg: FIXMessage]>;
  heartbeatTimeout: SessionEventHandler<[sessionId: string]>;
  error: SessionEventHandler<[sessionId: string, error: Error]>;
  send: SessionEventHandler<[sessionId: string, rawMessage: string]>;
}

// ============================================================================
// Session Manager
// ============================================================================

export class FIXSessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly listeners = new Map<string, Set<SessionEventHandler<never[]>>>();

  /**
   * Register a session configuration for a counterparty.
   * The session key is "{senderCompID}->{targetCompID}".
   */
  registerSession(config: FIXSessionConfig): string {
    const sessionId = makeSessionId(config.senderCompID, config.targetCompID);

    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is already registered`);
    }

    this.sessions.set(sessionId, new ManagedSession(config, sessionId, this));

    return sessionId;
  }

  /**
   * Remove a session registration.
   */
  unregisterSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.stopHeartbeat();
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Get a session by ID.
   */
  getSession(sessionId: string): ManagedSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Find a session by incoming message (using sender/target CompIDs).
   * Note: incoming message's SenderCompID maps to our TargetCompID and vice versa.
   */
  findSessionForIncoming(msg: FIXMessage): ManagedSession | undefined {
    // The counterparty's SenderCompID is our TargetCompID
    const sessionId = makeSessionId(msg.targetCompID, msg.senderCompID);
    return this.sessions.get(sessionId);
  }

  /**
   * Process an incoming FIX message.
   *
   * Handles session-level messages (Logon, Logout, Heartbeat, TestRequest)
   * and delegates application-level messages via the 'message' event.
   */
  processIncomingMessage(raw: string | Buffer): void {
    let msg: FIXMessage;
    try {
      msg = parseFIXMessage(raw);
    } catch (err) {
      this.emit('error', 'unknown', err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const session = this.findSessionForIncoming(msg);
    if (!session) {
      // No registered session for this CompID pair
      this.emit('error', 'unknown', new Error(
        `No session registered for ${msg.senderCompID} -> ${msg.targetCompID}`,
      ));
      return;
    }

    session.handleIncomingMessage(msg);
  }

  /**
   * Get all active (logged-on) sessions.
   */
  getActiveSessions(): ManagedSession[] {
    return Array.from(this.sessions.values()).filter((s) => s.state.loggedOn);
  }

  /**
   * Get all registered session IDs.
   */
  getAllSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Shut down all sessions gracefully.
   */
  async shutdownAll(reason = 'System shutdown'): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      if (session.state.loggedOn) {
        promises.push(session.initiateLogout(reason));
      }
    }
    await Promise.allSettled(promises);

    // Stop all heartbeats
    for (const session of this.sessions.values()) {
      session.stopHeartbeat();
    }
  }

  // ─── Event System ─────────────────────────────────────────────────────

  on<K extends keyof SessionEventMap>(event: K, handler: SessionEventMap[K]): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as SessionEventHandler<never[]>);
  }

  off<K extends keyof SessionEventMap>(event: K, handler: SessionEventMap[K]): void {
    this.listeners.get(event)?.delete(handler as SessionEventHandler<never[]>);
  }

  /** @internal Emit an event to registered listeners */
  emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          (handler as (...a: unknown[]) => void)(...args);
        } catch {
          /* skip handler errors */
        }
      }
    }
  }
}

// ============================================================================
// Managed Session
// ============================================================================

/**
 * Represents a single FIX session with a counterparty.
 */
export class ManagedSession {
  readonly config: FIXSessionConfig;
  readonly sessionId: string;
  readonly state: FIXSessionState;

  private readonly manager: FIXSessionManager;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatMonitorTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: FIXSessionConfig, sessionId: string, manager: FIXSessionManager) {
    this.config = config;
    this.sessionId = sessionId;
    this.manager = manager;

    this.state = {
      loggedOn: false,
      outMsgSeqNum: 1,
      inMsgSeqNum: 1,
      lastHeartbeatSent: 0,
      lastHeartbeatReceived: 0,
      messagesSent: 0,
      messagesReceived: 0,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
  }

  /**
   * Handle an incoming FIX message for this session.
   */
  handleIncomingMessage(msg: FIXMessage): void {
    this.state.messagesReceived++;
    this.state.lastActivityAt = Date.now();

    // Validate sequence number
    if (msg.msgSeqNum > 0 && msg.msgSeqNum < this.state.inMsgSeqNum) {
      // Duplicate or old message -- send reject
      this.sendReject(msg, 'Sequence number too low');
      return;
    }

    // Update expected inbound sequence
    if (msg.msgSeqNum > 0) {
      this.state.inMsgSeqNum = msg.msgSeqNum + 1;
    }

    // Handle session-level messages
    switch (msg.msgType) {
      case FIXMsgType.Logon:
        this.handleLogon(msg);
        break;
      case FIXMsgType.Logout:
        this.handleLogout(msg);
        break;
      case FIXMsgType.Heartbeat:
        this.handleHeartbeat();
        break;
      case FIXMsgType.TestRequest:
        this.handleTestRequest(msg);
        break;
      case FIXMsgType.Reject:
        this.handleReject(msg);
        break;
      default:
        // Application-level message -- pass through
        if (!this.state.loggedOn) {
          this.sendReject(msg, 'Not logged in');
          return;
        }
        this.manager.emit('message', this.sessionId, msg);
        break;
    }
  }

  /**
   * Initiate logon to counterparty.
   */
  sendLogon(): void {
    const msg = buildLogonMessage(
      this.config.fixVersion,
      this.config.senderCompID,
      this.config.targetCompID,
      this.nextOutSeqNum(),
      this.config.heartbeatIntervalSec ?? 30,
      this.config.password,
      this.config.resetOnLogon,
    );

    this.sendRaw(msg);
  }

  /**
   * Initiate graceful logout.
   */
  async initiateLogout(reason?: string): Promise<void> {
    if (!this.state.loggedOn) return;

    const msg = buildLogoutMessage(
      this.config.fixVersion,
      this.config.senderCompID,
      this.config.targetCompID,
      this.nextOutSeqNum(),
      reason,
    );

    this.sendRaw(msg);
    this.state.loggedOn = false;
    this.stopHeartbeat();
    this.manager.emit('logout', this.sessionId, reason ?? 'Initiated');
  }

  /**
   * Send a heartbeat message.
   */
  sendHeartbeat(testReqID?: string): void {
    const msg = buildHeartbeatMessage(
      this.config.fixVersion,
      this.config.senderCompID,
      this.config.targetCompID,
      this.nextOutSeqNum(),
      testReqID,
    );

    this.sendRaw(msg);
    this.state.lastHeartbeatSent = Date.now();
  }

  /**
   * Send a raw FIX message string through this session's transport.
   * Emits a 'send' event that the FIX server must listen to for TCP delivery.
   */
  sendRaw(raw: string): void {
    this.state.messagesSent++;
    this.manager.emit('send', this.sessionId, raw);
  }

  /**
   * Send a reject message.
   */
  sendReject(msg: FIXMessage, reason: string): void {
    const raw = buildRejectMessage(
      this.config.fixVersion,
      this.config.senderCompID,
      this.config.targetCompID,
      this.nextOutSeqNum(),
      msg.msgSeqNum,
      msg.msgType,
      reason,
    );

    this.sendRaw(raw);
  }

  /**
   * Get the next outbound sequence number and increment.
   */
  nextOutSeqNum(): number {
    return this.state.outMsgSeqNum++;
  }

  /**
   * Start heartbeat timer.
   */
  startHeartbeat(): void {
    this.stopHeartbeat();
    const intervalMs = (this.config.heartbeatIntervalSec ?? 30) * 1000;

    this.heartbeatTimer = setInterval(() => {
      if (this.state.loggedOn) {
        this.sendHeartbeat();
      }
    }, intervalMs);

    // Monitor incoming heartbeats (1.5x interval = missed threshold)
    this.heartbeatMonitorTimer = setInterval(() => {
      if (this.state.loggedOn) {
        const now = Date.now();
        const threshold = intervalMs * 1.5;
        if (this.state.lastHeartbeatReceived > 0 && now - this.state.lastHeartbeatReceived > threshold) {
          this.manager.emit('heartbeatTimeout', this.sessionId);
        }
      }
    }, intervalMs);
  }

  /**
   * Stop heartbeat timer.
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatMonitorTimer) {
      clearInterval(this.heartbeatMonitorTimer);
      this.heartbeatMonitorTimer = null;
    }
  }

  // ─── Internal Handlers ─────────────────────────────────────────────────

  private handleLogon(msg: FIXMessage): void {
    // Validate password if configured
    if (this.config.password) {
      const incomingPassword = msg.fields.get(554);
      if (incomingPassword !== this.config.password) {
        this.sendReject(msg, 'Invalid password');
        return;
      }
    }

    // Send logon acknowledgement if we're the acceptor
    if (!this.state.loggedOn) {
      const ack = buildLogonMessage(
        this.config.fixVersion,
        this.config.senderCompID,
        this.config.targetCompID,
        this.nextOutSeqNum(),
        this.config.heartbeatIntervalSec ?? 30,
      );
      this.sendRaw(ack);
    }

    this.state.loggedOn = true;
    this.state.lastHeartbeatReceived = Date.now();

    // Handle ResetSeqNumFlag
    if (msg.fields.get(141) === 'Y' || this.config.resetOnLogon) {
      this.state.outMsgSeqNum = 1;
      this.state.inMsgSeqNum = 1;
    }

    this.startHeartbeat();
    this.manager.emit('logon', this.sessionId);
  }

  private handleLogout(msg: FIXMessage): void {
    const reason = msg.fields.get(58) ?? 'Counterparty initiated';

    // Send logout acknowledgement if still logged on
    if (this.state.loggedOn) {
      const ack = buildLogoutMessage(
        this.config.fixVersion,
        this.config.senderCompID,
        this.config.targetCompID,
        this.nextOutSeqNum(),
        'Acknowledged',
      );
      this.sendRaw(ack);
    }

    this.state.loggedOn = false;
    this.stopHeartbeat();
    this.manager.emit('logout', this.sessionId, reason);
  }

  private handleHeartbeat(): void {
    this.state.lastHeartbeatReceived = Date.now();
  }

  private handleTestRequest(msg: FIXMessage): void {
    const testReqID = msg.fields.get(112);
    this.sendHeartbeat(testReqID);
  }

  private handleReject(msg: FIXMessage): void {
    const reason = msg.fields.get(58) ?? 'Unknown reject';
    this.manager.emit('error', this.sessionId, new Error(`FIX Reject: ${reason}`));
  }
}

// ============================================================================
// Helpers
// ============================================================================

function makeSessionId(senderCompID: string, targetCompID: string): string {
  return `${senderCompID}->${targetCompID}`;
}
