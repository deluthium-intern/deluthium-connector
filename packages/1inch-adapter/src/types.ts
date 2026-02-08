import type { TypedDataDomain, TypedDataField } from 'ethers';

export interface DeluthiumQuote {
  quoteId: string;
  srcChainId: number;
  dstChainId: number;
  inputToken: string;
  outputToken: string;
  amountIn: string;
  amountOut: string;
  to: string;
  deadline: number;
  nonce: string;
  signature?: string;
  makerId?: string;
  gasEstimate?: string;
}

export interface OneInchOrderV4 {
  salt: bigint;
  maker: string;
  receiver: string;
  makerAsset: string;
  takerAsset: string;
  makingAmount: bigint;
  takingAmount: bigint;
  makerTraits: bigint;
}

export interface OneInchRfqOrder {
  makerAsset: string;
  takerAsset: string;
  makingAmount: bigint;
  takingAmount: bigint;
  maker: string;
  allowedSender: string;
  expiration: bigint;
  nonce: bigint;
}

export interface AdapterConfig {
  chainId: number;
  mmVaultAddress: string;
  signer: ISigner;
  allowedTaker?: string;
  expirationBuffer?: number;
  enableNativeUnwrap?: boolean;
}

export interface ISigner {
  getAddress(): Promise<string>;
  signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string>;
}

export interface SignedOneInchOrder {
  order: OneInchOrderV4;
  signature: string;
  orderHash: string;
}

export interface OneInchChainConfig {
  chainId: number;
  name: string;
  oneInchRouter: string;
  deluthiumRfqManager: string;
  wrappedNativeToken: string;
  nativeSymbol: string;
}

export interface ValidationErrorInfo {
  field: string;
  message: string;
  value?: string;
}

export interface NonceInfo {
  nonce: bigint;
  epoch: bigint;
  timestamp: number;
}

export const ORDER_TYPES = {
  Order: [
    { name: 'salt', type: 'uint256' },
    { name: 'maker', type: 'address' },
    { name: 'receiver', type: 'address' },
    { name: 'makerAsset', type: 'address' },
    { name: 'takerAsset', type: 'address' },
    { name: 'makingAmount', type: 'uint256' },
    { name: 'takingAmount', type: 'uint256' },
    { name: 'makerTraits', type: 'uint256' },
  ],
} as const;
