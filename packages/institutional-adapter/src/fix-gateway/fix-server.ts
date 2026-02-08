/**
 * FIX Protocol TCP Acceptor Server
 *
 * Provides a TCP server that accepts FIX connections from institutional
 * counterparties. Handles:
 * - TCP connection management
 * - Optional TLS encryption
 * - Message framing (SOH-delimited)
 * - Routing to FIXSessionManager
 *
 * The server operates as a FIX acceptor (counterparties initiate connections).
 */

import * as net from 'node:net';
import * as tls from 'node:tls';
import * as fs from 'node:fs';
import { EventEmitter } from 'node:events';
import type { FIXServerConfig } from '../types.js';
import { FIXSessionManager } from './session-manager.js';
import { parseFIXMessage, validateChecksum } from './fix-messages.js';

// ============================================================================
// FIX Server
// ============================================================================

export class FIXServer extends EventEmitter {
  private readonly config: FIXServerConfig;
  private readonly sessionManager: FIXSessionManager;
  private server: net.Server | tls.Server | null = null;
  private readonly connections = new Map<string, FIXConnection>();
  private running = false;

  constructor(config: FIXServerConfig, sessionManager: FIXSessionManager) {
    super();
    this.config = config;
    this.sessionManager = sessionManager;
    this.setupSessionRouting();
  }

  /**
   * Start the FIX TCP acceptor server.
   */
  async start(): Promise<void> {
    if (this.running) return;

    return new Promise<void>((resolve, reject) => {
      try {
        if (this.config.tlsKeyPath && this.config.tlsCertPath) {
          // TLS server
          const tlsOptions: tls.TlsOptions = {
            key: fs.readFileSync(this.config.tlsKeyPath),
            cert: fs.readFileSync(this.config.tlsCertPath),
          };
          this.server = tls.createServer(tlsOptions, (socket) => this.handleConnection(socket));
        } else {
          // Plain TCP server -- warn about security implications (CRIT-02)
          this.emit('warning', 'FIX server starting WITHOUT TLS. Credentials will be transmitted in plaintext. Configure tlsKeyPath and tlsCertPath for production use.');
          this.server = net.createServer((socket) => this.handleConnection(socket));
        }

        this.server.on('error', (err) => {
          this.emit('error', err);
          if (!this.running) reject(err);
        });

        const host = this.config.host ?? '0.0.0.0';
        const port = this.config.port;

        this.server.listen(port, host, () => {
          this.running = true;
          this.emit('listening', { host, port });
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Stop the FIX server gracefully.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    // Logout all sessions
    await this.sessionManager.shutdownAll('Server shutting down');

    // Close all connections
    for (const conn of this.connections.values()) {
      conn.destroy();
    }
    this.connections.clear();

    // Close the server
    return new Promise<void>((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.running = false;
          this.server = null;
          resolve();
        });
      } else {
        this.running = false;
        resolve();
      }
    });
  }

  /**
   * Whether the server is currently running.
   */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the underlying session manager.
   */
  getSessionManager(): FIXSessionManager {
    return this.sessionManager;
  }

  /**
   * Get active connection count.
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  // ─── Connection Handling ───────────────────────────────────────────────

  private handleConnection(socket: net.Socket | tls.TLSSocket): void {
    // Enforce max sessions
    if (this.config.maxSessions && this.connections.size >= this.config.maxSessions) {
      socket.end();
      return;
    }

    // IP allowlisting enforcement (CRIT-02)
    const remoteAddr = socket.remoteAddress;
    if (this.config.allowedIPs && this.config.allowedIPs.length > 0 && remoteAddr) {
      const normalizedRemote = remoteAddr.replace(/^::ffff:/, ''); // Strip IPv4-mapped prefix
      if (!this.config.allowedIPs.includes(normalizedRemote)) {
        this.emit('warning', `FIX connection rejected from unauthorized IP: ${normalizedRemote}`);
        socket.end();
        return;
      }
    }

    const connId = `${remoteAddr}:${socket.remotePort}`;
    const connection = new FIXConnection(connId, socket);

    this.connections.set(connId, connection);
    this.emit('connection', connId, remoteAddr);

    // Forward received messages to session manager
    connection.on('message', (raw: string) => {
      try {
        // Validate FIX checksum integrity before processing (MED-07)
        if (!validateChecksum(raw)) {
          this.emit('warning', `FIX message from ${connId} failed checksum validation -- discarding`);
          return;
        }

        this.sessionManager.processIncomingMessage(raw);

        // Associate connection with session on logon
        const msg = parseFIXMessage(raw);
        const session = this.sessionManager.findSessionForIncoming(msg);
        if (session) {
          connection.sessionId = session.sessionId;
        }
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    });

    connection.on('close', () => {
      this.connections.delete(connId);
      this.emit('disconnection', connId);
    });

    connection.on('error', (err: Error) => {
      this.emit('error', err);
    });
  }

  /**
   * Route outbound messages from session manager to the correct TCP connection.
   */
  private setupSessionRouting(): void {
    this.sessionManager.on('send', ((sessionId: string, rawMessage: string) => {
      // Find the connection associated with this session
      for (const conn of this.connections.values()) {
        if (conn.sessionId === sessionId) {
          conn.send(rawMessage);
          return;
        }
      }
    }) as never);
  }
}

// ============================================================================
// FIX Connection (TCP Socket Wrapper)
// ============================================================================

/**
 * Wraps a TCP socket for FIX message framing.
 *
 * FIX messages are terminated by "10=XXX\x01" (checksum followed by SOH).
 * This class buffers incoming data and emits complete messages.
 */
class FIXConnection extends EventEmitter {
  readonly connId: string;
  sessionId: string | null = null;

  private readonly socket: net.Socket | tls.TLSSocket;
  private buffer = '';

  constructor(connId: string, socket: net.Socket | tls.TLSSocket) {
    super();
    this.connId = connId;
    this.socket = socket;

    socket.setEncoding('ascii');
    socket.setKeepAlive(true, 30_000);
    socket.setTimeout(120_000); // 2 minute timeout

    socket.on('data', (data: string) => {
      this.onData(data);
    });

    socket.on('close', () => {
      this.emit('close');
    });

    socket.on('error', (err: Error) => {
      this.emit('error', err);
    });

    socket.on('timeout', () => {
      this.emit('error', new Error(`Connection ${connId} timed out`));
      socket.end();
    });
  }

  /**
   * Send a raw FIX message over the socket.
   */
  send(raw: string): void {
    if (!this.socket.destroyed) {
      this.socket.write(raw, 'ascii');
    }
  }

  /**
   * Destroy the underlying socket.
   */
  destroy(): void {
    if (!this.socket.destroyed) {
      this.socket.destroy();
    }
  }

  /**
   * Process incoming data, extract complete FIX messages.
   *
   * A FIX message ends with the checksum tag: 10=XXX\x01
   * We detect complete messages by looking for "10=" followed by 3 digits and SOH.
   */
  private onData(data: string): void {
    this.buffer += data;

    // Extract complete messages from buffer
    // Pattern: messages end with "10=NNN\x01"
    const checksumPattern = /10=\d{3}\x01/g;
    let match: RegExpExecArray | null;
    let lastEnd = 0;

    while ((match = checksumPattern.exec(this.buffer)) !== null) {
      const messageEnd = match.index + match[0].length;
      const message = this.buffer.substring(lastEnd, messageEnd);
      lastEnd = messageEnd;

      if (message.includes('8=FIX')) {
        this.emit('message', message);
      }
    }

    // Keep remaining partial data in buffer
    if (lastEnd > 0) {
      this.buffer = this.buffer.substring(lastEnd);
    }

    // Prevent buffer from growing unbounded
    if (this.buffer.length > 1_000_000) {
      this.emit('error', new Error('FIX message buffer overflow'));
      this.buffer = '';
    }
  }
}
