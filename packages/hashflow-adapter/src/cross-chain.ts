import type { Address } from '@deluthium/sdk';
import { ValidationError } from '@deluthium/sdk';
import type { HashflowChain, CrossChainQuoteData, CrossChainProtocol, HashflowRFQRequest, HashflowQuoteData } from './types.js';
import { HASHFLOW_CHAIN_IDS, CHAIN_ID_TO_HASHFLOW } from './types.js';

export interface CrossChainRoute {
  readonly srcChain: HashflowChain;
  readonly dstChain: HashflowChain;
  readonly protocol: CrossChainProtocol;
  readonly active: boolean;
  readonly estimatedFeeWei?: bigint;
  readonly estimatedFinalitySeconds?: number;
}

const crossChainRoutes = new Map<string, CrossChainRoute>();

const DEFAULT_ROUTES: CrossChainRoute[] = [
  { srcChain: 'ethereum', dstChain: 'arbitrum', protocol: 'wormhole', active: true, estimatedFinalitySeconds: 900 },
  { srcChain: 'ethereum', dstChain: 'avalanche', protocol: 'wormhole', active: true, estimatedFinalitySeconds: 900 },
  { srcChain: 'ethereum', dstChain: 'bsc', protocol: 'wormhole', active: true, estimatedFinalitySeconds: 900 },
  { srcChain: 'ethereum', dstChain: 'polygon', protocol: 'wormhole', active: true, estimatedFinalitySeconds: 900 },
  { srcChain: 'ethereum', dstChain: 'optimism', protocol: 'wormhole', active: true, estimatedFinalitySeconds: 900 },
  { srcChain: 'ethereum', dstChain: 'base', protocol: 'wormhole', active: true, estimatedFinalitySeconds: 900 },
  { srcChain: 'arbitrum', dstChain: 'ethereum', protocol: 'wormhole', active: true, estimatedFinalitySeconds: 1200 },
  { srcChain: 'arbitrum', dstChain: 'polygon', protocol: 'wormhole', active: true, estimatedFinalitySeconds: 600 },
  { srcChain: 'arbitrum', dstChain: 'optimism', protocol: 'wormhole', active: true, estimatedFinalitySeconds: 600 },
  { srcChain: 'avalanche', dstChain: 'ethereum', protocol: 'wormhole', active: true, estimatedFinalitySeconds: 1200 },
  { srcChain: 'bsc', dstChain: 'ethereum', protocol: 'wormhole', active: true, estimatedFinalitySeconds: 1200 },
  { srcChain: 'polygon', dstChain: 'ethereum', protocol: 'wormhole', active: true, estimatedFinalitySeconds: 1200 },
  { srcChain: 'optimism', dstChain: 'arbitrum', protocol: 'layerzero', active: true, estimatedFinalitySeconds: 300 },
  { srcChain: 'base', dstChain: 'arbitrum', protocol: 'layerzero', active: true, estimatedFinalitySeconds: 300 },
  { srcChain: 'base', dstChain: 'optimism', protocol: 'layerzero', active: true, estimatedFinalitySeconds: 300 },
];

for (const route of DEFAULT_ROUTES) {
  crossChainRoutes.set(`${route.srcChain}:${route.dstChain}`, route);
}

export function registerRoute(route: CrossChainRoute): void {
  crossChainRoutes.set(`${route.srcChain}:${route.dstChain}`, route);
}

export function getRoute(srcChain: HashflowChain, dstChain: HashflowChain): CrossChainRoute | undefined {
  return crossChainRoutes.get(`${srcChain}:${dstChain}`);
}

export function isRouteSupported(srcChain: HashflowChain, dstChain: HashflowChain): boolean {
  const route = getRoute(srcChain, dstChain);
  return route !== undefined && route.active;
}

export function getAllRoutes(): CrossChainRoute[] {
  return Array.from(crossChainRoutes.values());
}

export function getRoutesFrom(srcChain: HashflowChain): CrossChainRoute[] {
  return getAllRoutes().filter((r) => r.srcChain === srcChain && r.active);
}

export function getRoutesTo(dstChain: HashflowChain): CrossChainRoute[] {
  return getAllRoutes().filter((r) => r.dstChain === dstChain && r.active);
}

export function validateCrossChainRFQ(request: HashflowRFQRequest): { valid: boolean; route?: CrossChainRoute; reason?: string } {
  if (!request.isCrossChain) return { valid: false, reason: 'Not a cross-chain request' };
  if (!request.dstChain) return { valid: false, reason: 'Missing destination chain' };
  const route = getRoute(request.chain, request.dstChain);
  if (!route) return { valid: false, reason: `Route ${request.chain} -> ${request.dstChain} not supported` };
  if (!route.active) return { valid: false, reason: `Route ${request.chain} -> ${request.dstChain} inactive` };
  return { valid: true, route };
}

export function buildCrossChainQuoteData(
  baseQuote: HashflowQuoteData, srcChain: HashflowChain, dstChain: HashflowChain,
  dstPool: Address, dstExternalAccount: Address,
): CrossChainQuoteData {
  const dstChainId = HASHFLOW_CHAIN_IDS[dstChain];
  if (!dstChainId) throw new ValidationError(`Unknown Hashflow chain: ${dstChain}`, 'dstChain');
  const route = getRoute(srcChain, dstChain);
  if (!route) throw new ValidationError(`No route from ${srcChain} to ${dstChain}`, 'crossChainRoute');
  return { ...baseQuote, srcChain, dstChain, dstChainId, dstPool, dstExternalAccount, xChainProtocol: route.protocol };
}

export function chainIdToHashflow(chainId: number): HashflowChain | undefined {
  return CHAIN_ID_TO_HASHFLOW[chainId];
}

export function hashflowToChainId(chain: HashflowChain): number | undefined {
  return HASHFLOW_CHAIN_IDS[chain];
}

export function isEVMChain(chain: HashflowChain): boolean {
  return chain !== 'solana';
}
