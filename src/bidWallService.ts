import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import BN from "bn.js";
import {
  BidWallClient,
  getBidWallAddr,
} from "@metadaoproject/futarchy/v0.7";
import {
  BidWallConfig,
  BidWallAccount,
  ArbitrageOpportunity,
  BID_WALL_FEE_PERCENT,
  USDC_MINT,
} from "./types.ts";

export class BidWallService {
  private connection: Connection;
  private bidWallClient: BidWallClient;

  constructor(connection: Connection, bidWallClient: BidWallClient) {
    this.connection = connection;
    this.bidWallClient = bidWallClient;
  }

  /**
   * Fetch bid wall account data
   */
  async fetchBidWall(bidWallAddress: PublicKey): Promise<BidWallAccount> {
    const account = await this.bidWallClient.fetchBidWall(bidWallAddress);
    return account as BidWallAccount;
  }

  /**
   * Check if a bid wall is active (not expired and not depleted)
   */
  async isBidWallActive(bidWallAddress: PublicKey): Promise<{
    active: boolean;
    reason?: string;
  }> {
    try {
      const bidWall = await this.fetchBidWall(bidWallAddress);
      const now = Math.floor(Date.now() / 1000);

      if (bidWall.expiresAt.toNumber() <= now) {
        return { active: false, reason: "Bid wall has expired" };
      }

      // Check if depleted (quoteAmountUsed >= initialQuoteAmount)
      if (bidWall.quoteAmountUsed.gte(bidWall.initialQuoteAmount)) {
        return { active: false, reason: "Bid wall is depleted" };
      }

      return { active: true };
    } catch (error) {
      return { active: false, reason: `Error fetching bid wall: ${error}` };
    }
  }

  /**
   * Calculate the remaining capacity of a bid wall in USDC
   */
  async getRemainingCapacity(bidWallAddress: PublicKey): Promise<number> {
    const bidWall = await this.fetchBidWall(bidWallAddress);
    const remaining = bidWall.initialQuoteAmount.sub(bidWall.quoteAmountUsed);
    return remaining.toNumber() / 1_000_000; // Convert to USDC
  }

  /**
   * Calculate the NAV per token (bid wall price) based on:
   * - DAO treasury USDC balance
   * - Initial AMM quote reserves (tracked by bid wall)
   * - Bid wall remaining balance
   * - Active token supply
   */
  async calculateBidWallPrice(
    bidWallAddress: PublicKey,
    tokenMint: PublicKey
  ): Promise<{
    navPerToken: number;
    priceAfterFee: number;
    totalNav: number;
    activeSupply: number;
  }> {
    const bidWall = await this.fetchBidWall(bidWallAddress);

    // Get DAO treasury USDC balance
    const daoTreasuryUsdcAccount = getAssociatedTokenAddressSync(
      new PublicKey(USDC_MINT),
      bidWall.daoTreasury,
      true
    );

    const daoTreasuryBalance = await this.connection.getTokenAccountBalance(
      daoTreasuryUsdcAccount
    );
    const daoTreasuryUsdc = parseFloat(daoTreasuryBalance.value.amount);

    // Get bid wall remaining balance
    const bidWallRemainingUsdc = bidWall.initialQuoteAmount
      .sub(bidWall.quoteAmountUsed)
      .toNumber();

    // AMM quote reserves (from bid wall initialization)
    const ammQuoteReserves = bidWall.initialAmmQuoteReserves.toNumber();

    // Total NAV = DAO treasury + AMM reserves + bid wall balance
    const totalNav = daoTreasuryUsdc + ammQuoteReserves + bidWallRemainingUsdc;

    // Get active token supply (total supply minus any locked/burned tokens)
    // For simplicity, we'll use the token's total supply
    // In practice, you might need to subtract locked tokens
    const tokenSupplyInfo = await this.connection.getTokenSupply(tokenMint);
    const activeSupply = parseFloat(tokenSupplyInfo.value.amount);

    // NAV per token
    const navPerToken = totalNav / activeSupply;

    // Price after 1% bid wall fee
    const priceAfterFee = navPerToken * (1 - BID_WALL_FEE_PERCENT / 100);

    return {
      navPerToken: navPerToken / 1_000_000, // Convert to human readable USDC
      priceAfterFee: priceAfterFee / 1_000_000,
      totalNav: totalNav / 1_000_000,
      activeSupply: activeSupply / 1_000_000, // Assuming 6 decimal token
    };
  }

  /**
   * Evaluate if there's an arbitrage opportunity
   */
  async evaluateArbitrageOpportunity(
    bidWallConfig: BidWallConfig,
    spotPriceUsdc: number,
    priceBufferPercent: number,
    tradeSizeUsdc: number
  ): Promise<ArbitrageOpportunity> {
    const { navPerToken, priceAfterFee, totalNav, activeSupply } =
      await this.calculateBidWallPrice(
        bidWallConfig.bidWallAddress,
        bidWallConfig.tokenMint
      );

    // Calculate the threshold price (bid wall price minus buffer)
    const totalBufferPercent = BID_WALL_FEE_PERCENT + priceBufferPercent;
    const thresholdPrice = navPerToken * (1 - totalBufferPercent / 100);

    // Calculate profit if we trade
    const tokensWeCanBuy = tradeSizeUsdc / spotPriceUsdc;
    const usdcFromBidWall = tokensWeCanBuy * priceAfterFee;
    const profitUsdc = usdcFromBidWall - tradeSizeUsdc;
    const profitPercent = (profitUsdc / tradeSizeUsdc) * 100;

    // It's profitable if spot price is below threshold
    const isProfitable = spotPriceUsdc < thresholdPrice;

    return {
      bidWallConfig,
      spotPriceUsdc,
      bidWallPriceUsdc: navPerToken,
      bidWallPriceAfterFee: priceAfterFee,
      profitPercent,
      estimatedProfitUsdc: profitUsdc,
      isProfitable,
    };
  }

  /**
   * Create a sell tokens instruction for the bid wall
   */
  async createSellTokensInstruction(params: {
    amount: BN;
    bidWall: PublicKey;
    baseMint: PublicKey;
    quoteMint: PublicKey;
    daoTreasury: PublicKey;
    user: PublicKey;
  }): Promise<TransactionInstruction> {
    const ix = await this.bidWallClient
      .sellTokensIx({
        amount: params.amount.toNumber(),
        bidWall: params.bidWall,
        baseMint: params.baseMint,
        daoTreasury: params.daoTreasury,
        quoteMint: params.quoteMint,
        user: params.user,
      })
      .instruction();

    return ix;
  }

  /**
   * Get bid wall address from creator, nonce, and base mint
   */
  static getBidWallAddress(params: {
    creator: PublicKey;
    nonce: BN;
    baseMint: PublicKey;
  }): PublicKey {
    const [bidWallAddr] = getBidWallAddr(params);
    return bidWallAddr;
  }
}

/**
 * Format an arbitrage opportunity for logging
 */
export function formatOpportunity(opp: ArbitrageOpportunity): string {
  const name = opp.bidWallConfig.name || opp.bidWallConfig.tokenMint.toBase58().slice(0, 8) + "...";
  const status = opp.isProfitable ? "✅ PROFITABLE" : "❌ Not profitable";

  return `
┌─ ${name} ${status}
│  Spot Price:      $${opp.spotPriceUsdc.toFixed(6)} USDC
│  Bid Wall NAV:    $${opp.bidWallPriceUsdc.toFixed(6)} USDC
│  After 1% Fee:    $${opp.bidWallPriceAfterFee.toFixed(6)} USDC
│  Est. Profit:     ${opp.profitPercent >= 0 ? "+" : ""}${opp.profitPercent.toFixed(2)}% ($${opp.estimatedProfitUsdc.toFixed(2)})
└──────────────────────────────`;
}

