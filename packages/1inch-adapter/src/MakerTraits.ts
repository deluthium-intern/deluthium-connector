import { UINT_40_MAX, UINT_80_MAX } from './constants.js';

// ── Bit Range Descriptor ─────────────────────────────────────────────────────

export interface BitRange {
  start: bigint;
  end: bigint;
}

// ── MakerTraits ──────────────────────────────────────────────────────────────
//
// A 256-bit packed field used in the 1inch Limit Order Protocol V4.
// Layout (bit indices, big-endian within uint256):
//
//  [  0 .. 79 ] – allowedSender (low 80 bits of address)
//  [ 80 ..119 ] – expiration    (unix seconds, 40 bits)
//  [120 ..159 ] – nonce         (40 bits)
//  [160 ..199 ] – series / epoch (40 bits)
//  [247]        – UNWRAP_WETH
//  [248]        – USE_PERMIT2
//  [249]        – HAS_EXTENSION
//  [250]        – NEED_CHECK_EPOCH_MANAGER
//  [251]        – POST_INTERACTION
//  [252]        – PRE_INTERACTION
//  [254]        – ALLOW_MULTIPLE_FILLS
//  [255]        – NO_PARTIAL_FILLS
// ─────────────────────────────────────────────────────────────────────────────

export class MakerTraits {
  // ── Static Ranges ────────────────────────────────────────────────────────
  static readonly ALLOWED_SENDER: BitRange = { start: 0n, end: 80n };
  static readonly EXPIRATION: BitRange = { start: 80n, end: 120n };
  static readonly NONCE: BitRange = { start: 120n, end: 160n };
  static readonly SERIES: BitRange = { start: 160n, end: 200n };

  // ── Static Flag Bit Positions ────────────────────────────────────────────
  static readonly UNWRAP_WETH = 247n;
  static readonly USE_PERMIT2 = 248n;
  static readonly HAS_EXTENSION = 249n;
  static readonly NEED_CHECK_EPOCH_MANAGER = 250n;
  static readonly POST_INTERACTION = 251n;
  static readonly PRE_INTERACTION = 252n;
  static readonly ALLOW_MULTIPLE_FILLS = 254n;
  static readonly NO_PARTIAL_FILLS = 255n;

  // ── Internal state ───────────────────────────────────────────────────────
  private value: bigint;

  constructor() {
    this.value = 0n;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private setRange(range: BitRange, val: bigint): this {
    const width = range.end - range.start;
    const mask = (1n << width) - 1n;
    if (val < 0n || val > mask) {
      throw new RangeError(
        `Value ${val} does not fit in ${width}-bit range [${range.start}..${range.end})`,
      );
    }
    // Clear the range, then set
    this.value = (this.value & ~(mask << range.start)) | (val << range.start);
    return this;
  }

  private getRange(range: BitRange): bigint {
    const width = range.end - range.start;
    const mask = (1n << width) - 1n;
    return (this.value >> range.start) & mask;
  }

  private setFlag(bit: bigint, enabled: boolean): this {
    if (enabled) {
      this.value |= 1n << bit;
    } else {
      this.value &= ~(1n << bit);
    }
    return this;
  }

  private getFlag(bit: bigint): boolean {
    return ((this.value >> bit) & 1n) === 1n;
  }

  // ── Fluent Setters (ranges) ──────────────────────────────────────────────

  withAllowedSender(address: string): this {
    // Take the lowest 80 bits of the address
    const addrBigInt = BigInt(address) & UINT_80_MAX;
    return this.setRange(MakerTraits.ALLOWED_SENDER, addrBigInt);
  }

  withExpiration(expiration: bigint): this {
    if (expiration < 0n || expiration > UINT_40_MAX) {
      throw new RangeError(`Expiration ${expiration} exceeds 40-bit max`);
    }
    return this.setRange(MakerTraits.EXPIRATION, expiration);
  }

  withNonce(nonce: bigint): this {
    if (nonce < 0n || nonce > UINT_40_MAX) {
      throw new RangeError(`Nonce ${nonce} exceeds 40-bit max`);
    }
    return this.setRange(MakerTraits.NONCE, nonce);
  }

  withSeries(series: bigint): this {
    if (series < 0n || series > UINT_40_MAX) {
      throw new RangeError(`Series ${series} exceeds 40-bit max`);
    }
    return this.setRange(MakerTraits.SERIES, series);
  }

  // ── Fluent Setters (flags) ───────────────────────────────────────────────

  enableNativeUnwrap(): this {
    return this.setFlag(MakerTraits.UNWRAP_WETH, true);
  }

  disableNativeUnwrap(): this {
    return this.setFlag(MakerTraits.UNWRAP_WETH, false);
  }

  enablePermit2(): this {
    return this.setFlag(MakerTraits.USE_PERMIT2, true);
  }

  enableExtension(): this {
    return this.setFlag(MakerTraits.HAS_EXTENSION, true);
  }

  enableEpochManagerCheck(): this {
    return this.setFlag(MakerTraits.NEED_CHECK_EPOCH_MANAGER, true);
  }

  enablePostInteraction(): this {
    return this.setFlag(MakerTraits.POST_INTERACTION, true);
  }

  enablePreInteraction(): this {
    return this.setFlag(MakerTraits.PRE_INTERACTION, true);
  }

  allowMultipleFills(): this {
    return this.setFlag(MakerTraits.ALLOW_MULTIPLE_FILLS, true);
  }

  disablePartialFills(): this {
    return this.setFlag(MakerTraits.NO_PARTIAL_FILLS, true);
  }

  // ── Getters ──────────────────────────────────────────────────────────────

  getAllowedSender(): bigint {
    return this.getRange(MakerTraits.ALLOWED_SENDER);
  }

  getExpiration(): bigint {
    return this.getRange(MakerTraits.EXPIRATION);
  }

  getNonce(): bigint {
    return this.getRange(MakerTraits.NONCE);
  }

  getSeries(): bigint {
    return this.getRange(MakerTraits.SERIES);
  }

  isNativeUnwrapEnabled(): boolean {
    return this.getFlag(MakerTraits.UNWRAP_WETH);
  }

  isPermit2Enabled(): boolean {
    return this.getFlag(MakerTraits.USE_PERMIT2);
  }

  hasExtension(): boolean {
    return this.getFlag(MakerTraits.HAS_EXTENSION);
  }

  isPartialFillsDisabled(): boolean {
    return this.getFlag(MakerTraits.NO_PARTIAL_FILLS);
  }

  isMultipleFillsAllowed(): boolean {
    return this.getFlag(MakerTraits.ALLOW_MULTIPLE_FILLS);
  }

  // ── Output ───────────────────────────────────────────────────────────────

  asBigInt(): bigint {
    return this.value;
  }

  asHex(): string {
    return '0x' + this.value.toString(16).padStart(64, '0');
  }

  toString(): string {
    return this.asHex();
  }

  // ── Static Constructors ──────────────────────────────────────────────────

  static fromBigInt(value: bigint): MakerTraits {
    const traits = new MakerTraits();
    traits.value = value;
    return traits;
  }

  static fromHex(hex: string): MakerTraits {
    const traits = new MakerTraits();
    traits.value = BigInt(hex);
    return traits;
  }

  /**
   * Creates MakerTraits pre-configured for a typical RFQ order:
   * - expiration set
   * - nonce set
   * - partial fills disabled (RFQ orders are fill-or-kill)
   */
  static forRfq(expiration: bigint, nonce: bigint): MakerTraits {
    return new MakerTraits()
      .withExpiration(expiration)
      .withNonce(nonce)
      .disablePartialFills();
  }
}
