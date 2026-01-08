#!/usr/bin/env node

import { loadConfig, printConfig } from "./config.ts";
import { BidWallArbitrageBot } from "./bot.ts";

const BANNER = `
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🏛️  MetaDAO Bid Wall Arbitrage Bot                         ║
║                                                              ║
║   Buy tokens on Jupiter, sell into bid walls for profit      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`;

async function main() {
  console.log(BANNER);

  try {
    // Load and validate configuration
    const config = loadConfig();
    printConfig(config);

    // Create and start the bot
    const bot = new BidWallArbitrageBot(config);

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      console.log("\n\n👋 Received SIGINT, shutting down gracefully...");
      bot.stop();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      console.log("\n\n👋 Received SIGTERM, shutting down gracefully...");
      bot.stop();
      process.exit(0);
    });

    // Start the bot
    await bot.start();
  } catch (error) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  }
}

main();

