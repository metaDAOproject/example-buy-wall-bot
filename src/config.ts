import { PublicKey } from "@solana/web3.js";
import { BotConfig, BidWallConfig } from "./types.ts";

function getEnvVar(name: string, defaultValue?: string): string {
  const value = process.env[name];
  if (!value && defaultValue === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value || defaultValue!;
}

function parseNumber(value: string, name: string): number {
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    throw new Error(`Invalid number for ${name}: ${value}`);
  }
  return parsed;
}

function parseBidWalls(json: string): BidWallConfig[] {
  if (!json || json === "[]") {
    return [];
  }

  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) {
      throw new Error("BID_WALLS must be a JSON array");
    }

    return parsed.map((item, index) => {
      if (!item.tokenMint || !item.bidWallAddress) {
        throw new Error(
          `BID_WALLS[${index}] must have tokenMint and bidWallAddress`
        );
      }
      return {
        tokenMint: new PublicKey(item.tokenMint),
        bidWallAddress: new PublicKey(item.bidWallAddress),
        name: item.name,
      };
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in BID_WALLS: ${error.message}`);
    }
    throw error;
  }
}

export function loadConfig(): BotConfig {
  const tradeSizeUsdc = parseNumber(
    getEnvVar("TRADE_SIZE_USDC", "100"),
    "TRADE_SIZE_USDC"
  );

  return {
    rpcUrl: getEnvVar("RPC_URL", "https://api.mainnet-beta.solana.com"),
    walletPrivateKey: getEnvVar("WALLET_PRIVATE_KEY"),
    jupiterApiKey: getEnvVar("JUPITER_API_KEY"),
    pollingIntervalMs: parseNumber(
      getEnvVar("POLLING_INTERVAL_MS", "30000"),
      "POLLING_INTERVAL_MS"
    ),
    tradeSizeUsdc: tradeSizeUsdc * 1_000_000, // Convert to raw USDC amount (6 decimals)
    slippageBps: parseNumber(getEnvVar("SLIPPAGE_BPS", "50"), "SLIPPAGE_BPS"),
    priceBufferPercent: parseNumber(
      getEnvVar("PRICE_BUFFER_PERCENT", "1"),
      "PRICE_BUFFER_PERCENT"
    ),
    dryRun: getEnvVar("DRY_RUN", "false").toLowerCase() === "true",
    bidWalls: parseBidWalls(getEnvVar("BID_WALLS", "[]")),
  };
}

/**
 * Pretty print the current configuration (hiding sensitive data)
 */
export function printConfig(config: BotConfig): void {
  console.log("\n🔧 Bot Configuration:");
  console.log("━".repeat(50));
  console.log(`  RPC URL: ${config.rpcUrl}`);
  console.log(`  Jupiter API Key: ${config.jupiterApiKey.slice(0, 8)}...`);
  console.log(`  Polling Interval: ${config.pollingIntervalMs / 1000}s`);
  console.log(
    `  Trade Size: ${(config.tradeSizeUsdc / 1_000_000).toFixed(2)} USDC`
  );
  console.log(`  Slippage: ${config.slippageBps / 100}%`);
  console.log(
    `  Price Buffer: ${config.priceBufferPercent}% (total threshold: ${1 + config.priceBufferPercent}%)`
  );
  console.log(`  Dry Run: ${config.dryRun ? "✅ YES" : "❌ NO"}`);
  console.log(`  Bid Walls: ${config.bidWalls.length} configured`);

  if (config.bidWalls.length > 0) {
    console.log("\n📋 Monitored Bid Walls:");
    config.bidWalls.forEach((bw, i) => {
      console.log(
        `  ${i + 1}. ${bw.name || "Unnamed"}: ${bw.tokenMint.toBase58().slice(0, 8)}...`
      );
      console.log(`     Bid Wall: ${bw.bidWallAddress.toBase58().slice(0, 8)}...`);
    });
  }
  console.log("━".repeat(50) + "\n");
}

