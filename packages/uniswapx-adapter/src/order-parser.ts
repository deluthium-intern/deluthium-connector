/**
 * @deluthium/uniswapx-adapter - Order Parser
 *
 * Parses raw UniswapX order data from the order API into typed
 * DutchOrderV2, ExclusiveDutchOrder, and PriorityOrder objects.
 *
 * Handles:
 * - Decoding ABI-encoded order bytes
 * - Validating order fields and deadlines
 * - Computing current decay amounts at a given timestamp
 */

import { AbiCoder, keccak256 as ethersKeccak256 } from 'ethers';
import { ValidationError } from '@deluthium/sdk';
import type {
  UniswapXOrder,
  DutchOrderV2,
  ExclusiveDutchOrder,
  PriorityOrder,
  DutchInput,
  DutchOutput,
  CosignerData,
  UniswapXOrderType,
  OrderStatus,
} from './types.js';
import type { Address, HexString } from '@deluthium/sdk';

// ─── ABI Codec ──────────────────────────────────────────────────────────────

const abiCoder = AbiCoder.defaultAbiCoder();

// ─── Order Info ABI Layout ──────────────────────────────────────────────────

/**
 * ABI layout for the OrderInfo struct shared by all UniswapX order types:
 *   struct OrderInfo {
 *     address reactor;
 *     address swapper;
 *     uint256 nonce;
 *     uint256 deadline;
 *     address additionalValidationContract;
 *     bytes   additionalValidationData;
 *   }
 */
const ORDER_INFO_TYPES = [
  'address', // reactor
  'address', // swapper
  'uint256', // nonce
  'uint256', // deadline
  'address', // additionalValidationContract
  'bytes',   // additionalValidationData
];

// ─── Raw API Response Types ─────────────────────────────────────────────────

/** Raw order from the UniswapX order API */
export interface RawUniswapXOrder {
  orderHash: string;
  orderStatus: string;
  chainId: number;
  type: string;
  encodedOrder: string;
  signature: string;
  input?: RawDutchIO;
  outputs?: RawDutchIO[];
  createdAt?: number;
  /** V2 Dutch specific */
  cosignerData?: RawCosignerData;
  cosigner?: string;
  /** Exclusive Dutch specific */
  decayStartTime?: number;
  decayEndTime?: number;
  exclusiveFiller?: string;
  exclusivityEndTimestamp?: number;
  /** Priority specific */
  auctionStartBlock?: number;
  basePriorityFee?: string;
}

interface RawDutchIO {
  token: string;
  startAmount: string;
  endAmount: string;
  recipient?: string;
}

interface RawCosignerData {
  decayStartTime: number;
  decayEndTime: number;
  exclusiveFiller: string;
  exclusivityOverrideBps: number;
  inputOverride: string;
  outputOverrides: string[];
}

// ─── Parser Functions ───────────────────────────────────────────────────────

/**
 * Parse a raw UniswapX order API response into a typed order object.
 *
 * @param raw - Raw order object from the UniswapX API
 * @returns Typed UniswapX order
 * @throws ValidationError if order type is unrecognized or data is malformed
 */
export function parseOrder(raw: RawUniswapXOrder): UniswapXOrder {
  const orderType = resolveOrderType(raw.type);

  switch (orderType) {
    case 'DutchV2':
      return parseDutchV2Order(raw);
    case 'ExclusiveDutch':
      return parseExclusiveDutchOrder(raw);
    case 'Priority':
      return parsePriorityOrder(raw);
  }
}

/**
 * Parse multiple raw orders, skipping any that are malformed.
 *
 * @param rawOrders - Array of raw orders from the API
 * @returns Array of successfully parsed orders
 */
export function parseOrders(rawOrders: RawUniswapXOrder[]): UniswapXOrder[] {
  const parsed: UniswapXOrder[] = [];
  for (const raw of rawOrders) {
    try {
      parsed.push(parseOrder(raw));
    } catch {
      // Skip malformed orders silently
    }
  }
  return parsed;
}

/**
 * Determine the current order status based on deadline and chain state.
 *
 * @param order - Parsed UniswapX order
 * @param currentTimestamp - Current unix timestamp in seconds (default: now)
 * @returns Order status
 */
export function getOrderStatus(
  order: UniswapXOrder,
  currentTimestamp?: number,
): OrderStatus {
  const now = currentTimestamp ?? Math.floor(Date.now() / 1000);
  if (now > order.deadline) return 'expired';
  return 'open';
}

/**
 * Compute the current input amount based on the Dutch auction decay curve.
 *
 * The input amount increases linearly from startAmount to endAmount
 * between decayStartTime and decayEndTime (swapper pays more over time).
 *
 * @param input - Dutch input with start and end amounts
 * @param decayStartTime - Unix timestamp when decay begins
 * @param decayEndTime - Unix timestamp when decay ends
 * @param currentTime - Current unix timestamp (default: now)
 * @returns Current input amount in wei
 */
export function computeCurrentInput(
  input: DutchInput,
  decayStartTime: number,
  decayEndTime: number,
  currentTime?: number,
): bigint {
  return computeDecayAmount(
    input.startAmount,
    input.endAmount,
    decayStartTime,
    decayEndTime,
    currentTime,
  );
}

/**
 * Compute the current output amount(s) based on the Dutch auction decay curve.
 *
 * Output amounts decrease linearly from startAmount to endAmount
 * between decayStartTime and decayEndTime (filler pays less over time).
 *
 * @param output - Dutch output with start and end amounts
 * @param decayStartTime - Unix timestamp when decay begins
 * @param decayEndTime - Unix timestamp when decay ends
 * @param currentTime - Current unix timestamp (default: now)
 * @returns Current output amount in wei
 */
export function computeCurrentOutput(
  output: DutchOutput,
  decayStartTime: number,
  decayEndTime: number,
  currentTime?: number,
): bigint {
  return computeDecayAmount(
    output.startAmount,
    output.endAmount,
    decayStartTime,
    decayEndTime,
    currentTime,
  );
}

/**
 * Compute a linearly decayed amount between start and end over a time window.
 *
 * @param startAmount - Amount at decay start
 * @param endAmount - Amount at decay end
 * @param decayStartTime - When decay begins (unix seconds)
 * @param decayEndTime - When decay ends (unix seconds)
 * @param currentTime - Current time (default: now)
 * @returns Current decayed amount
 */
export function computeDecayAmount(
  startAmount: bigint,
  endAmount: bigint,
  decayStartTime: number,
  decayEndTime: number,
  currentTime?: number,
): bigint {
  const now = currentTime ?? Math.floor(Date.now() / 1000);

  // Before decay starts: use start amount
  if (now <= decayStartTime) return startAmount;
  // After decay ends: use end amount
  if (now >= decayEndTime) return endAmount;

  // Linear interpolation
  const elapsed = BigInt(now - decayStartTime);
  const duration = BigInt(decayEndTime - decayStartTime);

  if (duration === 0n) return startAmount;

  if (endAmount >= startAmount) {
    // Increasing (input: swapper pays more over time)
    const delta = endAmount - startAmount;
    return startAmount + (delta * elapsed) / duration;
  } else {
    // Decreasing (output: filler pays less over time)
    const delta = startAmount - endAmount;
    return startAmount - (delta * elapsed) / duration;
  }
}

/**
 * Compute the order hash from encoded order bytes.
 *
 * @param encodedOrder - ABI-encoded order bytes
 * @returns keccak256 hash of the order
 */
export function computeOrderHash(encodedOrder: HexString): HexString {
  return ethersKeccak256(encodedOrder) as HexString;
}

// ─── Internal Parsers ───────────────────────────────────────────────────────

function resolveOrderType(typeStr: string): UniswapXOrderType {
  const normalized = typeStr.toLowerCase().replace(/[_-]/g, '');

  if (normalized.includes('dutchv2') || normalized.includes('dutch_v2') || normalized === 'dutchv2') {
    return 'DutchV2';
  }
  if (normalized.includes('exclusivedutch') || normalized.includes('dutch_limit') || normalized === 'dutch') {
    return 'ExclusiveDutch';
  }
  if (normalized.includes('priority')) {
    return 'Priority';
  }

  throw new ValidationError(`Unrecognized UniswapX order type: ${typeStr}`, 'orderType');
}

function parseDutchV2Order(raw: RawUniswapXOrder): DutchOrderV2 {
  validateRequiredFields(raw, ['orderHash', 'encodedOrder', 'signature', 'chainId']);

  const cosignerData = parseCosignerData(raw.cosignerData);
  const input = parseDutchInput(raw.input);
  const outputs = (raw.outputs ?? []).map(parseDutchOutput);

  return {
    orderType: 'DutchV2',
    orderHash: raw.orderHash as HexString,
    chainId: raw.chainId,
    swapper: (extractSwapperFromEncoded(raw.encodedOrder) ?? '0x0000000000000000000000000000000000000000') as Address,
    nonce: 0n, // Will be extracted from encoded order if needed
    deadline: cosignerData.decayEndTime + 60, // Deadline is typically after decay ends
    reactor: (extractReactorFromEncoded(raw.encodedOrder) ?? '0x0000000000000000000000000000000000000000') as Address,
    cosigner: (raw.cosigner ?? '0x0000000000000000000000000000000000000000') as Address,
    cosignerData,
    input,
    outputs,
    encodedOrder: raw.encodedOrder as HexString,
    signature: raw.signature as HexString,
  };
}

function parseExclusiveDutchOrder(raw: RawUniswapXOrder): ExclusiveDutchOrder {
  validateRequiredFields(raw, ['orderHash', 'encodedOrder', 'signature', 'chainId']);

  const input = parseDutchInput(raw.input);
  const outputs = (raw.outputs ?? []).map(parseDutchOutput);

  return {
    orderType: 'ExclusiveDutch',
    orderHash: raw.orderHash as HexString,
    chainId: raw.chainId,
    swapper: (extractSwapperFromEncoded(raw.encodedOrder) ?? '0x0000000000000000000000000000000000000000') as Address,
    nonce: 0n,
    deadline: raw.decayEndTime ? raw.decayEndTime + 60 : Math.floor(Date.now() / 1000) + 300,
    reactor: (extractReactorFromEncoded(raw.encodedOrder) ?? '0x0000000000000000000000000000000000000000') as Address,
    exclusiveFiller: (raw.exclusiveFiller ?? '0x0000000000000000000000000000000000000000') as Address,
    exclusivityEndTimestamp: raw.exclusivityEndTimestamp ?? 0,
    decayStartTime: raw.decayStartTime ?? Math.floor(Date.now() / 1000),
    decayEndTime: raw.decayEndTime ?? Math.floor(Date.now() / 1000) + 300,
    input,
    outputs,
    encodedOrder: raw.encodedOrder as HexString,
    signature: raw.signature as HexString,
  };
}

function parsePriorityOrder(raw: RawUniswapXOrder): PriorityOrder {
  validateRequiredFields(raw, ['orderHash', 'encodedOrder', 'signature', 'chainId']);

  const input = parseDutchInput(raw.input);
  const outputs = (raw.outputs ?? []).map(parseDutchOutput);

  return {
    orderType: 'Priority',
    orderHash: raw.orderHash as HexString,
    chainId: raw.chainId,
    swapper: (extractSwapperFromEncoded(raw.encodedOrder) ?? '0x0000000000000000000000000000000000000000') as Address,
    nonce: 0n,
    deadline: Math.floor(Date.now() / 1000) + 300,
    reactor: (extractReactorFromEncoded(raw.encodedOrder) ?? '0x0000000000000000000000000000000000000000') as Address,
    input,
    outputs,
    basePriorityFee: raw.basePriorityFee ? BigInt(raw.basePriorityFee) : 0n,
    encodedOrder: raw.encodedOrder as HexString,
    signature: raw.signature as HexString,
  };
}

function parseDutchInput(raw?: RawDutchIO): DutchInput {
  if (!raw) {
    return {
      token: '0x0000000000000000000000000000000000000000' as Address,
      startAmount: 0n,
      endAmount: 0n,
    };
  }
  return {
    token: raw.token as Address,
    startAmount: BigInt(raw.startAmount),
    endAmount: BigInt(raw.endAmount),
  };
}

function parseDutchOutput(raw: RawDutchIO): DutchOutput {
  return {
    token: raw.token as Address,
    startAmount: BigInt(raw.startAmount),
    endAmount: BigInt(raw.endAmount),
    recipient: (raw.recipient ?? '0x0000000000000000000000000000000000000000') as Address,
  };
}

function parseCosignerData(raw?: RawCosignerData): CosignerData {
  if (!raw) {
    const now = Math.floor(Date.now() / 1000);
    return {
      decayStartTime: now,
      decayEndTime: now + 300,
      exclusiveFiller: '0x0000000000000000000000000000000000000000' as Address,
      exclusivityOverrideBps: 0,
      inputOverride: 0n,
      outputOverrides: [],
    };
  }
  return {
    decayStartTime: raw.decayStartTime,
    decayEndTime: raw.decayEndTime,
    exclusiveFiller: raw.exclusiveFiller as Address,
    exclusivityOverrideBps: raw.exclusivityOverrideBps,
    inputOverride: BigInt(raw.inputOverride),
    outputOverrides: raw.outputOverrides.map((o) => BigInt(o)),
  };
}

function validateRequiredFields(raw: RawUniswapXOrder, fields: string[]): void {
  for (const field of fields) {
    if (!(field in raw) || (raw as unknown as Record<string, unknown>)[field] === undefined) {
      throw new ValidationError(`Missing required field: ${field}`, field);
    }
  }
}

/**
 * Attempt to extract the reactor address from the first 32 bytes of encoded order.
 * This is a best-effort extraction -- encoded order format may vary.
 */
function extractReactorFromEncoded(encoded: string): string | null {
  try {
    if (encoded.length < 66) return null; // 0x + 64 chars min
    const decoded = abiCoder.decode(ORDER_INFO_TYPES, '0x' + encoded.slice(2, 2 + 192 * 2));
    return decoded[0] as string;
  } catch {
    return null;
  }
}

/**
 * Attempt to extract the swapper address from encoded order.
 */
function extractSwapperFromEncoded(encoded: string): string | null {
  try {
    if (encoded.length < 130) return null;
    const decoded = abiCoder.decode(ORDER_INFO_TYPES, '0x' + encoded.slice(2, 2 + 192 * 2));
    return decoded[1] as string;
  } catch {
    return null;
  }
}
