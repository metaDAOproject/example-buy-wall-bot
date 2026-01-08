import {
  Connection,
  Keypair,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  ComputeBudgetProgram,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import BN from "bn.js";
import { BidWallClient } from "@metadaoproject/futarchy/v0.7";
import {
  BotConfig,
  BidWallConfig,
  ArbitrageOpportunity,
  TradeResult,
  USDC_MINT,
  USDC_DECIMALS,
} from "./types.ts";
import { JupiterClient } from "./jupiterClient.ts";
import { BidWallService, formatOpportunity } from "./bidWallService.ts";
import { PublicKey } from "@solana/web3.js";

export class BidWallArbitrageBot {
  private config: BotConfig;
  private connection: Connection;
  private wallet: Keypair;
  private jupiterClient: JupiterClient;
  private bidWallService: BidWallService;
  private isRunning: boolean = false;

  constructor(config: BotConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, "confirmed");

    // Decode wallet from base58 private key
    const secretKey = bs58.decode(config.walletPrivateKey);
    this.wallet = Keypair.fromSecretKey(secretKey);

    this.jupiterClient = new JupiterClient(config.jupiterApiKey);

    // Initialize BidWallClient with Anchor provider
    const provider = new AnchorProvider(
      this.connection,
      {
        publicKey: this.wallet.publicKey,
        signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
          if (tx instanceof VersionedTransaction) {
            tx.sign([this.wallet]);
          } else {
            tx.partialSign(this.wallet);
          }
          return tx;
        },
        signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
          txs.forEach((tx) => {
            if (tx instanceof VersionedTransaction) {
              tx.sign([this.wallet]);
            } else {
              tx.partialSign(this.wallet);
            }
          });
          return txs;
        },
      },
      { commitment: "confirmed" }
    );

    const bidWallClient = BidWallClient.createClient({ provider });

    this.bidWallService = new BidWallService(this.connection, bidWallClient);
  }

  /**
   * Start the bot with polling
   */
  async start(): Promise<void> {
    this.isRunning = true;

    console.log("\n🚀 Starting Bid Wall Arbitrage Bot");
    console.log(`   Wallet: ${this.wallet.publicKey.toBase58()}`);
    console.log(`   Mode: ${this.config.dryRun ? "DRY RUN" : "LIVE"}`);
    console.log("\n");

    // Check initial wallet balance
    await this.checkWalletBalance();

    // Main polling loop
    while (this.isRunning) {
      try {
        await this.runCycle();
      } catch (error) {
        console.error("❌ Error in bot cycle:", error);
      }

      if (this.isRunning) {
        console.log(
          `\n⏳ Waiting ${this.config.pollingIntervalMs / 1000}s until next check...\n`
        );
        await this.sleep(this.config.pollingIntervalMs);
      }
    }
  }

  /**
   * Stop the bot
   */
  stop(): void {
    console.log("\n🛑 Stopping bot...");
    this.isRunning = false;
  }

  /**
   * Run a single cycle of checking and executing opportunities
   */
  private async runCycle(): Promise<void> {
    console.log(`\n📊 Checking opportunities at ${new Date().toISOString()}`);
    console.log("━".repeat(60));

    if (this.config.bidWalls.length === 0) {
      console.log("⚠️  No bid walls configured. Add bid walls to BID_WALLS env var.");
      return;
    }

    // Get spot prices for all tokens
    const tokenMints = this.config.bidWalls.map((bw) =>
      bw.tokenMint.toBase58()
    );
    const spotPrices = await this.jupiterClient.getTokenPrices(tokenMints);

    // Evaluate each bid wall
    const opportunities: ArbitrageOpportunity[] = [];

    for (const bidWallConfig of this.config.bidWalls) {
      try {
        // Check if bid wall is active
        const { active, reason } = await this.bidWallService.isBidWallActive(
          bidWallConfig.bidWallAddress
        );

        if (!active) {
          console.log(
            `⏭️  Skipping ${bidWallConfig.name || bidWallConfig.tokenMint.toBase58().slice(0, 8)}: ${reason}`
          );
          continue;
        }

        const spotPrice = spotPrices.get(bidWallConfig.tokenMint.toBase58());
        if (!spotPrice) {
          console.log(
            `⚠️  No spot price for ${bidWallConfig.tokenMint.toBase58()}`
          );
          continue;
        }

        const opportunity = await this.bidWallService.evaluateArbitrageOpportunity(
          bidWallConfig,
          spotPrice,
          this.config.priceBufferPercent,
          this.config.tradeSizeUsdc / 1_000_000 // Convert to human readable
        );

        opportunities.push(opportunity);
        console.log(formatOpportunity(opportunity));
      } catch (error) {
        console.error(
          `❌ Error evaluating ${bidWallConfig.name || bidWallConfig.bidWallAddress.toBase58()}:`,
          error
        );
      }
    }

    // Execute profitable opportunities
    const profitableOpps = opportunities.filter((o) => o.isProfitable);

    if (profitableOpps.length > 0) {
      console.log(`\n🎯 Found ${profitableOpps.length} profitable opportunities!`);

      for (const opp of profitableOpps) {
        try {
          await this.executeArbitrage(opp);
        } catch (error) {
          console.error("❌ Failed to execute arbitrage:", error);
        }
      }
    } else {
      console.log("\n💤 No profitable opportunities found.");
    }
  }

  /**
   * Execute an arbitrage trade
   */
  private async executeArbitrage(
    opportunity: ArbitrageOpportunity
  ): Promise<TradeResult> {
    const tokenName =
      opportunity.bidWallConfig.name ||
      opportunity.bidWallConfig.tokenMint.toBase58().slice(0, 8);

    console.log(`\n🔄 Executing arbitrage for ${tokenName}...`);

    if (this.config.dryRun) {
      console.log("   🏃 DRY RUN - Simulating trade...");
      return this.simulateTrade(opportunity);
    }

    try {
      // Step 1: Get Jupiter swap quote/order (USDC -> Token)
      console.log("   📝 Creating Jupiter swap order...");
      const jupiterOrder = await this.jupiterClient.createOrder({
        inputMint: USDC_MINT,
        outputMint: opportunity.bidWallConfig.tokenMint.toBase58(),
        amount: this.config.tradeSizeUsdc.toString(),
        taker: this.wallet.publicKey.toBase58(),
      });

      const tokensReceived = BigInt(jupiterOrder.outAmount);
      console.log(
        `   💱 Jupiter: ${this.config.tradeSizeUsdc / 1_000_000} USDC -> ${Number(tokensReceived) / 1_000_000} tokens`
      );

      // Step 2: Build atomic transaction with Jupiter swap + Bid Wall sell
      console.log("   🔧 Building atomic transaction...");

      // Decode Jupiter transaction
      const jupiterTx = VersionedTransaction.deserialize(
        Buffer.from(jupiterOrder.transaction, "base64")
      );

      // Get bid wall account for daoTreasury
      const bidWallAccount = await this.bidWallService.fetchBidWall(
        opportunity.bidWallConfig.bidWallAddress
      );

      if (!bidWallAccount) {
        return {
          success: false,
          inputAmount: this.config.tradeSizeUsdc.toString(),
          outputAmount: "0",
          error: "Bid wall account not found",
        };
      }

      // Create bid wall sell instruction
      const sellIx = await this.bidWallService.createSellTokensInstruction({
        amount: new BN(tokensReceived.toString()),
        bidWall: opportunity.bidWallConfig.bidWallAddress,
        baseMint: opportunity.bidWallConfig.tokenMint,
        quoteMint: new PublicKey(USDC_MINT),
        daoTreasury: bidWallAccount.daoTreasury,
        user: this.wallet.publicKey,
      });

      // Decompile Jupiter transaction to extract raw instructions
      console.log("   🔧 Decompiling Jupiter transaction...");
      const { instructions: jupiterInstructions, addressLookupTableAccounts } =
        await this.decompileTransaction(jupiterTx);

      // Filter out Jupiter's compute budget instructions (we'll set our own)
      const jupiterSwapInstructions = jupiterInstructions.filter(
        (ix) => !ix.programId.equals(ComputeBudgetProgram.programId)
      );

      // Build combined atomic transaction
      const latestBlockhash = await this.connection.getLatestBlockhash();

      const combinedMessage = new TransactionMessage({
        payerKey: this.wallet.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [
          // Compute budget for combined transaction
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
          // Jupiter swap instructions
          ...jupiterSwapInstructions,
          // Bid wall sell instruction
          sellIx,
        ],
      }).compileToV0Message(addressLookupTableAccounts);

      // Sign and send atomic transaction
      console.log("   📤 Sending atomic transaction (swap + sell)...");
      const atomicTx = new VersionedTransaction(combinedMessage);
      atomicTx.sign([this.wallet]);

      const signature = await this.connection.sendTransaction(atomicTx, {
        skipPreflight: false,
      });

      await this.connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        "confirmed"
      );

      console.log(`   ✅ Atomic transaction confirmed: ${signature}`);

      // Check final USDC balance
      const usdcAccount = getAssociatedTokenAddressSync(
        new PublicKey(USDC_MINT),
        this.wallet.publicKey
      );
      const usdcBalance = await this.connection.getTokenAccountBalance(usdcAccount);
      console.log(`   💵 USDC balance: ${usdcBalance.value.uiAmount}`);

      return {
        success: true,
        signature,
        inputAmount: jupiterOrder.inAmount,
        outputAmount: jupiterOrder.outAmount,
        bidWallSellAmount: tokensReceived.toString(),
        usdcReceived: usdcBalance.value.amount,
      };
    } catch (error) {
      console.error("   ❌ Trade execution failed:", error);
      return {
        success: false,
        inputAmount: this.config.tradeSizeUsdc.toString(),
        outputAmount: "0",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Simulate a trade without executing
   */
  private async simulateTrade(
    opportunity: ArbitrageOpportunity
  ): Promise<TradeResult> {
    try {
      // Get Jupiter quote
      const quote = await this.jupiterClient.getSwapQuote({
        inputMint: USDC_MINT,
        outputMint: opportunity.bidWallConfig.tokenMint.toBase58(),
        amount: this.config.tradeSizeUsdc.toString(),
      });

      const tokensReceived = parseFloat(quote.outAmount) / 1_000_000;
      const estimatedUsdcFromBidWall =
        tokensReceived * opportunity.bidWallPriceAfterFee;
      const profit =
        estimatedUsdcFromBidWall - this.config.tradeSizeUsdc / 1_000_000;

      console.log(`   📊 Simulation Results:`);
      console.log(
        `      Input:  ${this.config.tradeSizeUsdc / 1_000_000} USDC`
      );
      console.log(`      Tokens: ${tokensReceived.toFixed(6)}`);
      console.log(
        `      Output: ${estimatedUsdcFromBidWall.toFixed(6)} USDC (from bid wall)`
      );
      console.log(
        `      Profit: ${profit >= 0 ? "+" : ""}${profit.toFixed(6)} USDC (${((profit / (this.config.tradeSizeUsdc / 1_000_000)) * 100).toFixed(2)}%)`
      );
      console.log(`      Price Impact: ${quote.priceImpactPct}%`);

      return {
        success: true,
        inputAmount: quote.inAmount,
        outputAmount: quote.outAmount,
      };
    } catch (error) {
      console.error("   ❌ Simulation failed:", error);
      return {
        success: false,
        inputAmount: this.config.tradeSizeUsdc.toString(),
        outputAmount: "0",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Decompile a VersionedTransaction to extract raw instructions
   * This is needed to combine Jupiter's transaction with our bid wall instruction
   */
  private async decompileTransaction(
    tx: VersionedTransaction
  ): Promise<{
    instructions: TransactionInstruction[];
    addressLookupTableAccounts: AddressLookupTableAccount[];
  }> {
    const addressLookupTableAccounts: AddressLookupTableAccount[] = [];

    // Fetch Address Lookup Tables if the transaction uses them
    if (tx.message.addressTableLookups.length > 0) {
      const lookupTableAddresses = tx.message.addressTableLookups.map(
        (lookup) => lookup.accountKey
      );

      const lookupTableAccounts = await Promise.all(
        lookupTableAddresses.map(async (address) => {
          const account = await this.connection.getAddressLookupTable(address);
          if (!account.value) {
            throw new Error(`Lookup table not found: ${address.toBase58()}`);
          }
          return account.value;
        })
      );

      addressLookupTableAccounts.push(...lookupTableAccounts);
    }

    // Decompile the message to get raw instructions
    const decompiled = TransactionMessage.decompile(tx.message, {
      addressLookupTableAccounts,
    });

    return {
      instructions: decompiled.instructions,
      addressLookupTableAccounts,
    };
  }

  /**
   * Check wallet USDC balance
   */
  private async checkWalletBalance(): Promise<void> {
    try {
      const usdcAccount = getAssociatedTokenAddressSync(
        new PublicKey(USDC_MINT),
        this.wallet.publicKey
      );

      const balance = await this.connection.getTokenAccountBalance(usdcAccount);
      console.log(`💰 USDC Balance: ${balance.value.uiAmount} USDC`);

      const solBalance = await this.connection.getBalance(this.wallet.publicKey);
      console.log(`⚡ SOL Balance: ${solBalance / 1e9} SOL`);

      if (balance.value.uiAmount && balance.value.uiAmount < this.config.tradeSizeUsdc / 1_000_000) {
        console.warn(
          `⚠️  Warning: USDC balance (${balance.value.uiAmount}) is less than trade size (${this.config.tradeSizeUsdc / 1_000_000})`
        );
      }
    } catch (error) {
      console.warn("⚠️  Could not fetch wallet balance:", error);
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

