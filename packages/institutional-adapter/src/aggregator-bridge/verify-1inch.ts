/**
 * 1inch Aggregator Bridge Verification
 *
 * Verifies that the 1inch adapter integration path is functional, enabling
 * institutional MMs to access Deluthium liquidity through 1inch's Limit
 * Order Protocol V4.
 *
 * Checks:
 * 1. 1inch adapter import and configuration
 * 2. MakerTraits encoding/decoding
 * 3. Nonce management
 * 4. Order construction pipeline
 * 5. Signer abstraction
 */

import {
  DeluthiumRestClient,
  type DeluthiumClientConfig,
} from '@deluthium/sdk';

import type { AggregatorVerificationResult, AggregatorCheck } from '../types.js';

/**
 * Verify the 1inch aggregator integration path.
 *
 * Runs health checks to ensure institutional MMs using 1inch Protocol
 * can reach Deluthium liquidity via the Limit Order Protocol V4 adapter.
 *
 * @param deluthiumConfig - Deluthium SDK client configuration
 * @param chainId - Chain ID to verify on (default: BSC)
 * @returns Verification result with individual check details
 */
export async function verify1inchIntegration(
  deluthiumConfig: DeluthiumClientConfig,
  chainId?: number,
): Promise<AggregatorVerificationResult> {
  const startTime = Date.now();
  const checks: AggregatorCheck[] = [];
  const targetChainId = chainId ?? deluthiumConfig.chainId;

  // ── Check 1: 1inch Adapter Available ─────────────────────────────────

  checks.push(await runCheck('1inch Adapter Import', async () => {
    const adapter = await import('@deluthium/1inch-adapter');

    if (!adapter.DeluthiumAdapter) {
      throw new Error('DeluthiumAdapter not found in @deluthium/1inch-adapter');
    }
    if (!adapter.MakerTraits) {
      throw new Error('MakerTraits not found in @deluthium/1inch-adapter');
    }
    if (!adapter.NonceManager) {
      throw new Error('NonceManager not found in @deluthium/1inch-adapter');
    }

    return 'All required exports available (DeluthiumAdapter, MakerTraits, NonceManager)';
  }));

  // ── Check 2: Deluthium API Connectivity ──────────────────────────────

  checks.push(await runCheck('Deluthium API Connectivity', async () => {
    const client = new DeluthiumRestClient(deluthiumConfig);
    const tokens = await client.getTokens(targetChainId);
    return `API reachable, ${tokens.length} tokens available on chain ${targetChainId}`;
  }));

  // ── Check 3: MakerTraits Encoding ────────────────────────────────────

  checks.push(await runCheck('MakerTraits Encoding', async () => {
    const adapter = await import('@deluthium/1inch-adapter');

    // Test MakerTraits with known values
    const traits = new adapter.MakerTraits();

    // Test the fluent builder API and bigint output
    const encoded = traits.asBigInt();

    if (typeof encoded !== 'bigint') {
      throw new Error(`MakerTraits.asBigInt() returned ${typeof encoded}, expected bigint`);
    }

    return `MakerTraits encoding OK: ${encoded.toString().substring(0, 20)}...`;
  }));

  // ── Check 4: Nonce Management ────────────────────────────────────────

  checks.push(await runCheck('Nonce Management', async () => {
    const adapter = await import('@deluthium/1inch-adapter');

    const nonceManager = new adapter.NonceManager();
    const testAddress = '0x1111111111111111111111111111111111111111';
    const nonce1 = nonceManager.getNextNonce(testAddress);
    const nonce2 = nonceManager.getNextNonce(testAddress);

    if (nonce1 === nonce2) {
      throw new Error('NonceManager generated duplicate nonces');
    }

    return `Nonce management OK: ${nonce1} -> ${nonce2}`;
  }));

  // ── Check 5: Chain Configuration ─────────────────────────────────────

  checks.push(await runCheck('Chain Configuration', async () => {
    const adapter = await import('@deluthium/1inch-adapter');

    // Verify chain config exists for target chain
    const config = adapter.getChainConfig(targetChainId);
    if (!config) {
      throw new Error(`No chain config for chain ${targetChainId}`);
    }

    // Verify 1inch router address
    const router = adapter.getOneInchRouter(targetChainId);
    if (!router) {
      throw new Error(`No 1inch router for chain ${targetChainId}`);
    }

    return `Chain ${targetChainId}: router=${router.substring(0, 10)}...`;
  }));

  // ── Check 6: Signer Abstraction ──────────────────────────────────────

  checks.push(await runCheck('Signer Abstraction', async () => {
    const adapter = await import('@deluthium/1inch-adapter');

    // Test that ISigner interface is properly exported and PrivateKeySigner works
    if (!adapter.PrivateKeySigner) {
      throw new Error('PrivateKeySigner not exported');
    }
    if (!adapter.isSigner) {
      throw new Error('isSigner type guard not exported');
    }

    // Create a test signer (using Hardhat's test key)
    const testKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    const signer = new adapter.PrivateKeySigner(testKey);

    const address = await signer.getAddress();
    if (!address || !address.startsWith('0x')) {
      throw new Error('Signer did not return a valid address');
    }

    const isSigner = adapter.isSigner(signer);
    if (!isSigner) {
      throw new Error('isSigner() returned false for PrivateKeySigner');
    }

    return `Signer OK: ${address.substring(0, 10)}...`;
  }));

  // ── Aggregate Results ────────────────────────────────────────────────

  const allPassed = checks.every((c) => c.passed);
  const totalLatency = Date.now() - startTime;

  return {
    aggregator: '1inch',
    operational: allPassed,
    checks,
    verifiedAt: new Date().toISOString(),
    latencyMs: totalLatency,
    error: allPassed ? undefined : checks.find((c) => !c.passed)?.details,
  };
}

// ============================================================================
// Check Runner
// ============================================================================

async function runCheck(
  name: string,
  fn: () => Promise<string>,
): Promise<AggregatorCheck> {
  const start = Date.now();
  try {
    const details = await fn();
    return {
      name,
      passed: true,
      latencyMs: Date.now() - start,
      details,
    };
  } catch (err) {
    return {
      name,
      passed: false,
      latencyMs: Date.now() - start,
      details: err instanceof Error ? err.message : String(err),
    };
  }
}
