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
 * Jupiter Price API response
 */
export interface JupiterPriceResponse {
  data: {
    [tokenMint: string]: {
      id: string;
      type: string;
      price: string;
      extraInfo?: {
        lastSwappedPrice?: {
          lastJupiterSellAt: number;
          lastJupiterSellPrice: string;
          lastJupiterBuyAt: number;
          lastJupiterBuyPrice: string;
        };
        quotedPrice?: {
          buyPrice: string;
          buyAt: number;
          sellPrice: string;
          sellAt: number;
        };
        confidenceLevel?: string;
        depth?: {
          buyPriceImpactRatio: {
            depth: { [amount: string]: number };
            timestamp: number;
          };
          sellPriceImpactRatio: {
            depth: { [amount: string]: number };
            timestamp: number;
          };
        };
      };
    };
  };
  timeTaken: number;
}

/**
 * Jupiter Ultra Order request
 */
export interface JupiterOrderRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker: string;
}

/**
 * Jupiter Ultra Order response
 */
export interface JupiterOrderResponse {
  requestId: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapType: string;
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
  }>;
  contextSlot: number;
  transaction: string;
  prioritizationFeeLamports: number;
  dynamicSlippageReport?: {
    slippageBps: number;
    otherAmount: string;
    simulatedIncurredSlippageBps: number;
    amplificationRatio: string;
    categoryName: string;
    heuristicMaxSlippageBps: number;
  };
  simulationError?: string;
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
  initialQuoteAmount: BN;
  initialAmmQuoteReserves: BN;
  quoteAmountUsed: BN;
  feesCollected: BN;
  createdAt: BN;
  expiresAt: BN;
}

/**
 * Arbitrage opportunity details
 */
export interface ArbitrageOpportunity {
  bidWallConfig: BidWallConfig;
  spotPriceUsdc: number;
  bidWallPriceUsdc: number;
  bidWallPriceAfterFee: number;
  profitPercent: number;
  estimatedProfitUsdc: number;
  isProfitable: boolean;
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

