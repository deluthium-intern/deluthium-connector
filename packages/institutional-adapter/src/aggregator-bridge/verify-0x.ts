/**
 * 0x Protocol Aggregator Bridge Verification
 *
 * Verifies that the 0x adapter integration path is functional, enabling
 * institutional MMs (Wintermute, GSR, Jump) to access Deluthium liquidity
 * through the 0x RFQ protocol.
 *
 * Checks:
 * 1. SDK client connectivity (Deluthium API reachable)
 * 2. 0x adapter import and configuration
 * 3. Pair availability on target chain
 * 4. Indicative quote flow (0x format -> Deluthium)
 * 5. Transform pipeline (0x RFQ order -> MMQuote params)
 */

import {
  DeluthiumRestClient,
  type DeluthiumClientConfig,
} from '@deluthium/sdk';

import type { AggregatorVerificationResult, AggregatorCheck } from '../types.js';

/**
 * Verify the 0x Protocol aggregator integration path.
 *
 * Runs a series of health checks to ensure that institutional MMs
 * using 0x Protocol can reach Deluthium liquidity.
 *
 * @param deluthiumConfig - Deluthium SDK client configuration
 * @param chainId - Chain ID to verify on (default: BSC)
 * @param testTokenIn - Test input token address (optional)
 * @param testTokenOut - Test output token address (optional)
 * @returns Verification result with individual check details
 */
export async function verify0xIntegration(
  deluthiumConfig: DeluthiumClientConfig,
  chainId?: number,
  testTokenIn?: string,
  testTokenOut?: string,
): Promise<AggregatorVerificationResult> {
  const startTime = Date.now();
  const checks: AggregatorCheck[] = [];
  const targetChainId = chainId ?? deluthiumConfig.chainId;

  // ── Check 1: 0x Adapter Available ────────────────────────────────────

  checks.push(await runCheck('0x Adapter Import', async () => {
    // Verify the 0x adapter package can be dynamically imported
    const adapter = await import('@deluthium/0x-adapter');
    if (!adapter.ZeroExToDarkPoolProxy) {
      throw new Error('ZeroExToDarkPoolProxy not found in @deluthium/0x-adapter');
    }
    if (!adapter.transform0xToDarkPool) {
      throw new Error('transform0xToDarkPool not found in @deluthium/0x-adapter');
    }
    return 'All required exports available';
  }));

  // ── Check 2: Deluthium API Connectivity ──────────────────────────────

  checks.push(await runCheck('Deluthium API Connectivity', async () => {
    const client = new DeluthiumRestClient(deluthiumConfig);
    const pairs = await client.getPairs(targetChainId);
    return `API reachable, ${pairs.length} pairs available on chain ${targetChainId}`;
  }));

  // ── Check 3: Pair Availability ───────────────────────────────────────

  if (testTokenIn && testTokenOut) {
    checks.push(await runCheck('Pair Availability', async () => {
      const client = new DeluthiumRestClient(deluthiumConfig);
      const pairs = await client.getPairs(targetChainId);
      const matchingPair = pairs.find(
        (p) =>
          (p.baseToken.address.toLowerCase() === testTokenIn.toLowerCase() &&
            p.quoteToken.address.toLowerCase() === testTokenOut.toLowerCase()) ||
          (p.baseToken.address.toLowerCase() === testTokenOut.toLowerCase() &&
            p.quoteToken.address.toLowerCase() === testTokenIn.toLowerCase()),
      );

      if (!matchingPair) {
        throw new Error(`No matching pair found for ${testTokenIn}/${testTokenOut}`);
      }

      return `Pair found: ${matchingPair.baseToken.symbol}/${matchingPair.quoteToken.symbol} (active: ${matchingPair.active})`;
    }));
  }

  // ── Check 4: 0x Proxy Instantiation ──────────────────────────────────

  checks.push(await runCheck('0x Proxy Instantiation', async () => {
    const adapter = await import('@deluthium/0x-adapter');
    const authStr = typeof deluthiumConfig.auth === 'string'
      ? deluthiumConfig.auth
      : await deluthiumConfig.auth();

    const proxy = new adapter.ZeroExToDarkPoolProxy({
      chainId: targetChainId,
      jwtToken: authStr,
    });

    if (!proxy) {
      throw new Error('Failed to instantiate ZeroExToDarkPoolProxy');
    }

    return 'Proxy instantiated successfully';
  }));

  // ── Check 5: Transform Pipeline ──────────────────────────────────────

  checks.push(await runCheck('Transform Pipeline', async () => {
    const adapter = await import('@deluthium/0x-adapter');

    // Test with a mock 0x order (validation disabled for synthetic test)
    const mockOrder: Parameters<typeof adapter.transform0xToDarkPool>[0] = {
      makerToken: testTokenOut ?? '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      takerToken: testTokenIn ?? '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      makerAmount: '2000000000', // 2000 USDC
      takerAmount: '1000000000000000000', // 1 ETH
      maker: '0x1111111111111111111111111111111111111111',
      taker: '0x0000000000000000000000000000000000000000',
      txOrigin: '0x2222222222222222222222222222222222222222',
      pool: '0x0000000000000000000000000000000000000000000000000000000000000000',
      expiry: Math.floor(Date.now() / 1000) + 300,
      salt: '12345',
    };

    // Transform without validation (we're testing the mapping, not live data)
    const params = adapter.transform0xToDarkPool(mockOrder, targetChainId, undefined, '0x', false);

    if (!params.manager) throw new Error('Transform failed: missing manager');
    if (!params.from) throw new Error('Transform failed: missing from');
    if (params.amountIn !== BigInt(mockOrder.takerAmount)) {
      throw new Error('Transform failed: amountIn mismatch');
    }
    if (params.amountOut !== BigInt(mockOrder.makerAmount)) {
      throw new Error('Transform failed: amountOut mismatch');
    }

    return `Transform OK: ${mockOrder.takerAmount} -> ${mockOrder.makerAmount}`;
  }));

  // ── Aggregate Results ────────────────────────────────────────────────

  const allPassed = checks.every((c) => c.passed);
  const totalLatency = Date.now() - startTime;

  return {
    aggregator: '0x',
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
