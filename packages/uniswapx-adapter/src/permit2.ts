/**
 * @deluthium/uniswapx-adapter - Permit2 Utilities
 *
 * Handles Permit2 signature construction and approval management
 * for UniswapX order execution. Permit2 is the universal token
 * approval contract used by all UniswapX Reactor contracts.
 *
 * Key concepts:
 * - Permit2 allows gasless token approvals via EIP-712 signatures
 * - UniswapX orders carry Permit2 signatures from the swapper
 * - Fillers need to approve Permit2 to spend their output tokens
 */

import { Contract, JsonRpcProvider } from 'ethers';
import type { ISigner, Address, HexString } from '@deluthium/sdk';
import { ValidationError } from '@deluthium/sdk';
import type { PermitSingle, PermitBatch } from './types.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Canonical Permit2 contract address (same on all EVM chains) */
export const PERMIT2_ADDRESS: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

/** Maximum uint160 value for unlimited Permit2 approvals */
export const MAX_UINT160 = (1n << 160n) - 1n;

/** Maximum uint48 for maximum expiration */
export const MAX_UINT48 = (1n << 48n) - 1n;

/** Permit2 EIP-712 domain name */
const PERMIT2_DOMAIN_NAME = 'Permit2';

// ─── ABIs ───────────────────────────────────────────────────────────────────

/** Minimal Permit2 ABI for the operations we need */
const PERMIT2_ABI = [
  // Read allowance
  'function allowance(address owner, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  // Permit (single token)
  'function permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature) external',
  // Permit (batch)
  'function permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce)[] details, address spender, uint256 sigDeadline) permitBatch, bytes signature) external',
  // Transfer
  'function transferFrom(address from, address to, uint160 amount, address token) external',
];

/** Minimal ERC-20 ABI for approval checks */
const ERC20_ABI = [
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address owner) external view returns (uint256)',
];

// ─── EIP-712 Types for Permit2 ──────────────────────────────────────────────

/** EIP-712 types for PermitSingle */
export const PERMIT_SINGLE_TYPES = {
  PermitSingle: [
    { name: 'details', type: 'PermitDetails' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' },
  ],
  PermitDetails: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' },
    { name: 'nonce', type: 'uint48' },
  ],
};

/** EIP-712 types for PermitBatch */
export const PERMIT_BATCH_TYPES = {
  PermitBatch: [
    { name: 'details', type: 'PermitDetails[]' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' },
  ],
  PermitDetails: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' },
    { name: 'nonce', type: 'uint48' },
  ],
};

// ─── Permit2 Client ─────────────────────────────────────────────────────────

/**
 * Client for interacting with the Permit2 contract.
 *
 * Provides methods to:
 * - Check and manage ERC-20 approvals to Permit2
 * - Sign Permit2 permits for Reactor contracts
 * - Query current allowance state
 */
export class Permit2Client {
  private readonly provider: JsonRpcProvider;
  private readonly permit2: Contract;
  private readonly chainId: number;

  constructor(rpcUrl: string, chainId: number) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.permit2 = new Contract(PERMIT2_ADDRESS, PERMIT2_ABI, this.provider);
    this.chainId = chainId;
  }

  /**
   * Get the current Permit2 allowance for a token/owner/spender combination.
   *
   * @param owner - Token owner address
   * @param token - ERC-20 token address
   * @param spender - Address allowed to spend (usually a Reactor contract)
   * @returns Current allowance amount, expiration, and nonce
   */
  async getAllowance(
    owner: Address,
    token: Address,
    spender: Address,
  ): Promise<{ amount: bigint; expiration: number; nonce: number }> {
    const [amount, expiration, nonce] = await this.permit2.allowance(owner, token, spender) as [bigint, bigint, bigint];
    return {
      amount,
      expiration: Number(expiration),
      nonce: Number(nonce),
    };
  }

  /**
   * Check if the owner has approved the Permit2 contract to spend a token.
   * This is the ERC-20 approval, not the Permit2 sub-approval.
   *
   * @param owner - Token owner address
   * @param token - ERC-20 token address
   * @returns Whether Permit2 has sufficient ERC-20 approval
   */
  async hasERC20Approval(owner: Address, token: Address): Promise<boolean> {
    const erc20 = new Contract(token, ERC20_ABI, this.provider);
    const allowance = await erc20.allowance(owner, PERMIT2_ADDRESS) as bigint;
    // Consider "approved" if allowance > 1e18 (1 token as minimum threshold)
    return allowance > 10n ** 18n;
  }

  /**
   * Get the ERC-20 balance of a token for an address.
   *
   * @param owner - Token owner address
   * @param token - ERC-20 token address
   * @returns Token balance in wei
   */
  async getTokenBalance(owner: Address, token: Address): Promise<bigint> {
    const erc20 = new Contract(token, ERC20_ABI, this.provider);
    return await erc20.balanceOf(owner) as bigint;
  }

  /**
   * Build the EIP-712 domain for Permit2 signing.
   */
  getPermit2Domain() {
    return {
      name: PERMIT2_DOMAIN_NAME,
      chainId: this.chainId,
      verifyingContract: PERMIT2_ADDRESS,
    };
  }

  /**
   * Sign a PermitSingle using the provided ISigner.
   *
   * This allows a spender (Reactor) to transfer tokens via Permit2
   * without needing a separate ERC-20 approve transaction.
   *
   * @param signer - ISigner implementation
   * @param permit - PermitSingle data to sign
   * @returns Hex-encoded signature
   */
  async signPermitSingle(signer: ISigner, permit: PermitSingle): Promise<HexString> {
    const domain = this.getPermit2Domain();
    const value = {
      details: {
        token: permit.details.token,
        amount: permit.details.amount.toString(),
        expiration: permit.details.expiration,
        nonce: permit.details.nonce,
      },
      spender: permit.spender,
      sigDeadline: permit.sigDeadline,
    };

    const signature = await signer.signTypedData(domain, PERMIT_SINGLE_TYPES, value);
    return signature as HexString;
  }

  /**
   * Sign a PermitBatch for multiple token approvals in a single signature.
   *
   * @param signer - ISigner implementation
   * @param permit - PermitBatch data to sign
   * @returns Hex-encoded signature
   */
  async signPermitBatch(signer: ISigner, permit: PermitBatch): Promise<HexString> {
    const domain = this.getPermit2Domain();
    const value = {
      details: permit.details.map((d) => ({
        token: d.token,
        amount: d.amount.toString(),
        expiration: d.expiration,
        nonce: d.nonce,
      })),
      spender: permit.spender,
      sigDeadline: permit.sigDeadline,
    };

    const signature = await signer.signTypedData(domain, PERMIT_BATCH_TYPES, value);
    return signature as HexString;
  }

  /**
   * Build a PermitSingle structure for a given token and spender.
   *
   * @param token - ERC-20 token to permit
   * @param spender - Reactor contract to allow spending
   * @param amount - Amount to approve (default: MAX_UINT160 for unlimited)
   * @param expirationSeconds - Seconds until expiration (default: 30 days)
   * @param sigDeadlineSeconds - Seconds until signature deadline (default: 30 minutes)
   * @returns PermitSingle structure ready for signing
   */
  async buildPermitSingle(
    owner: Address,
    token: Address,
    spender: Address,
    amount?: bigint,
    expirationSeconds = 30 * 24 * 60 * 60,
    sigDeadlineSeconds = 30 * 60,
  ): Promise<PermitSingle> {
    const { nonce } = await this.getAllowance(owner, token, spender);
    const now = Math.floor(Date.now() / 1000);

    return {
      details: {
        token,
        amount: amount ?? MAX_UINT160,
        expiration: now + expirationSeconds,
        nonce,
      },
      spender,
      sigDeadline: now + sigDeadlineSeconds,
    };
  }
}

// ─── Utility Functions ──────────────────────────────────────────────────────

/**
 * Validate that a Permit2 signature deadline has not expired.
 *
 * @param sigDeadline - Unix timestamp of signature deadline
 * @throws ValidationError if the signature has expired
 */
export function validatePermitDeadline(sigDeadline: number): void {
  const now = Math.floor(Date.now() / 1000);
  if (now > sigDeadline) {
    throw new ValidationError(
      `Permit2 signature deadline expired (deadline: ${sigDeadline}, now: ${now})`,
      'sigDeadline',
    );
  }
}

/**
 * Check if a Permit2 allowance is sufficient for a given amount.
 *
 * @param currentAmount - Current Permit2 allowance amount
 * @param currentExpiration - Current allowance expiration timestamp
 * @param requiredAmount - Amount needed for the operation
 * @returns Whether the allowance is sufficient and not expired
 */
export function isAllowanceSufficient(
  currentAmount: bigint,
  currentExpiration: number,
  requiredAmount: bigint,
): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (now > currentExpiration) return false;
  return currentAmount >= requiredAmount;
}
