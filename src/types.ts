import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/**
 * Configuration for a bid wall to monitor
 */
export interface BidWallConfig {
  /** Token mint address (the token you're buying/selling) */
  tokenMint: PublicKey;
  /** Bid wall account address */
  bidWallAddress: PublicKey;
  /** Optional: Custom name for logging */
  name?: string;
}

/**
 * Main bot configuration
 */
export interface BotConfig {
  /** Solana RPC URL */
  rpcUrl: string;
  /** Wallet private key (base58 encoded) */
  walletPrivateKey: string;
  /** Jupiter API key */
  jupiterApiKey: string;
  /** Polling interval in milliseconds */
  pollingIntervalMs: number;
  /** Trade size in USDC (raw amount, 6 decimals) */
  tradeSizeUsdc: number;
  /** Slippage tolerance in basis points (100 = 1%) */
  slippageBps: number;
  /** Price buffer on top of 1% bid wall fee (percentage) */
  priceBufferPercent: number;
  /** Dry run mode - simulate without executing */
  dryRun: boolean;
  /** List of bid walls to monitor */
  bidWalls: BidWallConfig[];
}

/**
 * Jupiter Price API v3 response
 */
export interface JupiterPriceResponse {
  [tokenMint: string]: {
    usdPrice: number;
    blockId: number;
    decimals: number;
    priceChange24h: number;
  };
}

/**
 * Jupiter Ultra Order response
 * Docs: https://dev.jup.ag/api-reference/ultra/order
 */
export interface JupiterOrderResponse {
  mode: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
    bps?: number;
    usdValue?: number;
  }>;
  feeBps: number;
  platformFee?: {
    feeBps: number;
    amount: string;
  };
  signatureFeeLamports: number;
  signatureFeePayer: string | null;
  prioritizationFeeLamports: number;
  prioritizationFeePayer: string | null;
  rentFeeLamports: number;
  rentFeePayer: string | null;
  swapType: string;
  router: "iris" | "jupiterz" | "dflow" | "okx";
  transaction: string | null;
  gasless: boolean;
  requestId: string;
  totalTime: number;
  taker: string | null;
  inUsdValue?: number;
  outUsdValue?: number;
  priceImpact?: number;
  swapUsdValue?: number;
  referralAccount?: string;
  feeMint?: string;
  quoteId?: string;
  maker?: string;
  expireAt?: string;
  // Error fields - present when transaction is null
  errorCode?: 1 | 2 | 3;
  errorMessage?: string;
}

/**
 * Jupiter Ultra Execute response
 */
export interface JupiterExecuteResponse {
  status: "Success" | "Failed";
  code: number;
  signature?: string;
  slot?: string;
  error?: string;
  totalInputAmount?: string;
  totalOutputAmount?: string;
  inputAmountResult?: string;
  outputAmountResult?: string;
  swapEvents?: Array<{
    inputMint: string;
    inputAmount: string;
    outputMint: string;
    outputAmount: string;
  }>;
}

/**
 * Bid wall account data structure
 */
export interface BidWallAccount {
  authority: PublicKey;
  creator: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  daoTreasury: PublicKey;
  feeRecipient: PublicKey;
  nonce: BN;
  quoteAmount: BN;
  initialAmmQuoteReserves: BN;
  feesCollected: BN;
  /** Amount of base tokens bought/burned by the bid wall */
  baseBoughtAmount: BN;
  createdAt: BN;
  expiresAt: BN;
}

/**
 * Initial token supply (10 million tokens with 6 decimals)
 */
export const INITIAL_TOKEN_SUPPLY = 10_000_000 * 1_000_000; // 10M tokens in lamports

/**
 * Arbitrage opportunity details
 */
export interface ArbitrageOpportunity {
  bidWallConfig: BidWallConfig;
  spotPriceUsdc: number;
  bidWallPriceUsdc: number;
  bidWallPriceAfterFee: number;
  bidWallBalanceUsdc: number;
  expectedOutputUsdc: number;
  profitPercent: number;
  estimatedProfitUsdc: number;
  isProfitable: boolean;
  /** If not profitable, the reason why */
  notProfitableReason?: 'price' | 'insufficient_balance';
}

/**
 * Trade execution result
 */
export interface TradeResult {
  success: boolean;
  signature?: string;
  inputAmount: string;
  outputAmount: string;
  bidWallSellAmount?: string;
  usdcReceived?: string;
  error?: string;
}

/**
 * USDC token configuration
 */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;

/**
 * Bid wall fee percentage (1%)
 */
export const BID_WALL_FEE_PERCENT = 1;

