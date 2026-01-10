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
  INITIAL_TOKEN_SUPPLY,
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
  async fetchBidWall(bidWallAddress: PublicKey): Promise<BidWallAccount | null> {
    const account = await this.bidWallClient.fetchBidWall(bidWallAddress);
    if (!account) return null;
    
    return {
      authority: account.authority,
      creator: account.creator,
      baseMint: account.baseMint,
      quoteMint: new PublicKey(USDC_MINT),
      daoTreasury: account.daoTreasury,
      feeRecipient: account.feeRecipient,
      nonce: account.nonce,
      quoteAmount: account.quoteAmount,
      initialAmmQuoteReserves: account.initialAmmQuoteReserves,
      feesCollected: account.feesCollected,
      baseBoughtAmount: account.baseBoughtAmount,
      createdAt: account.createdTimestamp,
      expiresAt: account.createdTimestamp.add(new BN(account.durationSeconds)),
    };
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
      if (!bidWall) return { active: false, reason: "Bid wall not found" };

      const now = Math.floor(Date.now() / 1000);

      if (bidWall.expiresAt.toNumber() <= now) {
        return { active: false, reason: "Bid wall has expired" };
      }

      // Check if depleted (quoteAmount >= 0)
      if (bidWall.quoteAmount.eq(new BN(0))) {
        return { active: false, reason: "Bid wall is depleted" };
      }

      return { active: true };
    } catch (error) {
      return { active: false, reason: `Error fetching bid wall: ${error}` };
    }
  }

  /**
   * Calculate the NAV per token (bid wall price) based on:
   * NAV = DAO treasury USDC + Initial AMM quote reserves + Bid wall quote amount
   * Active Supply = 10M tokens - tokens burned (baseBoughtAmount)
   * NAV per token = NAV / Active Supply
   */
  async calculateBidWallPrice(
    bidWallAddress: PublicKey,
    _tokenMint?: PublicKey // Kept for API compatibility, but no longer needed
  ): Promise<{
    navPerToken: number;
    priceAfterFee: number;
    totalNav: number;
    activeSupply: number;
  }> {
    const bidWall = await this.fetchBidWall(bidWallAddress);

    if (!bidWall) return { navPerToken: 0, priceAfterFee: 0, totalNav: 0, activeSupply: 0 };
    
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

    // Get bid wall remaining balance (quote amount assigned to bid wall)
    const bidWallQuoteAmount = bidWall.quoteAmount.toNumber();

    // AMM quote reserves (initial liquidity from bid wall initialization)
    const ammQuoteReserves = bidWall.initialAmmQuoteReserves.toNumber();

    // Total NAV = DAO treasury + Initial AMM reserves + Bid wall quote amount
    const totalNav = daoTreasuryUsdc + ammQuoteReserves + bidWallQuoteAmount;

    // Tokens burned = amount bought by bid wall
    const tokensBurned = bidWall.baseBoughtAmount.toNumber();

    // Active supply = 10M tokens - tokens burned
    const activeSupply = INITIAL_TOKEN_SUPPLY - tokensBurned;

    // NAV per token (in raw amounts - both are in 6 decimal format)
    const navPerToken = activeSupply > 0 ? totalNav / activeSupply : 0;

    // Price after 1% bid wall fee
    const priceAfterFee = navPerToken * (1 - BID_WALL_FEE_PERCENT / 100);

    return {
      navPerToken: navPerToken, // Already in USDC per token (both have 6 decimals, they cancel out)
      priceAfterFee: priceAfterFee,
      totalNav: totalNav / 1_000_000, // Convert to human readable USDC
      activeSupply: activeSupply / 1_000_000, // Convert to human readable token amount
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

    // Get bid wall balance
    const bidWall = await this.fetchBidWall(bidWallConfig.bidWallAddress);
    const bidWallBalanceUsdc = bidWall ? bidWall.quoteAmount.toNumber() / 1_000_000 : 0;

    // Calculate the threshold price (bid wall price minus buffer)
    const totalBufferPercent = BID_WALL_FEE_PERCENT + priceBufferPercent;
    const thresholdPrice = navPerToken * (1 - totalBufferPercent / 100);

    // Calculate profit if we trade
    const tokensWeCanBuy = tradeSizeUsdc / spotPriceUsdc;
    const expectedOutputUsdc = tokensWeCanBuy * priceAfterFee;
    const profitUsdc = expectedOutputUsdc - tradeSizeUsdc;
    const profitPercent = (profitUsdc / tradeSizeUsdc) * 100;

    // Check profitability conditions
    const priceIsProfitable = spotPriceUsdc < thresholdPrice;
    const hasEnoughBalance = expectedOutputUsdc <= bidWallBalanceUsdc;
    const isProfitable = priceIsProfitable && hasEnoughBalance;

    // Determine reason if not profitable
    let notProfitableReason: 'price' | 'insufficient_balance' | undefined;
    if (!isProfitable) {
      if (!priceIsProfitable) {
        notProfitableReason = 'price';
      } else if (!hasEnoughBalance) {
        notProfitableReason = 'insufficient_balance';
      }
    }

    return {
      bidWallConfig,
      spotPriceUsdc,
      bidWallPriceUsdc: navPerToken,
      bidWallPriceAfterFee: priceAfterFee,
      bidWallBalanceUsdc,
      expectedOutputUsdc,
      profitPercent,
      estimatedProfitUsdc: profitUsdc,
      isProfitable,
      notProfitableReason,
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
  
  // Determine status with more detail
  let status: string;
  if (opp.isProfitable) {
    status = "✅ PROFITABLE";
  } else if (opp.notProfitableReason === 'insufficient_balance') {
    status = "⚠️  INSUFFICIENT WALL BALANCE";
  } else {
    status = "❌ Not profitable (price)";
  }

  // Show wall balance with warning if insufficient
  const balanceDisplay = opp.notProfitableReason === 'insufficient_balance'
    ? `$${opp.bidWallBalanceUsdc.toFixed(2)} USDC ⚠️  (need $${opp.expectedOutputUsdc.toFixed(2)})`
    : `$${opp.bidWallBalanceUsdc.toFixed(2)} USDC`;

  return `
┌─ ${name} ${status}
│  Spot Price:      $${opp.spotPriceUsdc.toFixed(6)} USDC
│  Bid Wall NAV:    $${opp.bidWallPriceUsdc.toFixed(6)} USDC
│  After 1% Fee:    $${opp.bidWallPriceAfterFee.toFixed(6)} USDC
│  Wall Balance:    ${balanceDisplay}
│  Est. Profit:     ${opp.profitPercent >= 0 ? "+" : ""}${opp.profitPercent.toFixed(2)}% ($${opp.estimatedProfitUsdc.toFixed(2)})
└──────────────────────────────`;
}

