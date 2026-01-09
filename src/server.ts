import { Connection, PublicKey, VersionedTransaction, TransactionMessage, Keypair } from "@solana/web3.js";
import { BidWallClient } from "@metadaoproject/futarchy/v0.7";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { BidWallService } from "./bidWallService.ts";
import { JupiterClient } from "./jupiterClient.ts";
import { USDC_MINT, BidWallConfig } from "./types.ts";
import BN from "bn.js";

// Load config from environment (server version - wallet key optional)
function loadServerConfig() {
  const getEnv = (name: string, defaultValue?: string): string => {
    const value = process.env[name];
    if (!value && defaultValue === undefined) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value || defaultValue!;
  };

  const parseBidWalls = (json: string): BidWallConfig[] => {
    if (!json || json === "[]") return [];
    
    // Debug: show what we're trying to parse
    console.log("[Server] Raw BID_WALLS value:", JSON.stringify(json));
    
    // Fix for shell stripping quotes: convert JS object notation to valid JSON
    // This handles cases like {tokenMint:value} -> {"tokenMint":"value"}
    let fixedJson = json;
    if (json.includes("{") && !json.includes('"')) {
      console.log("[Server] Detected unquoted JSON, attempting to fix...");
      // Add quotes around keys: {tokenMint: or ,bidWallAddress: -> {"tokenMint": or ,"bidWallAddress":
      fixedJson = json.replace(/([{,])\s*(\w+)\s*:/g, '$1"$2":');
      // Add quotes around string values (everything between : and , or })
      // This handles values with spaces like "Token 1"
      fixedJson = fixedJson.replace(/:([^,\}\]"]+)([,\}\]])/g, (match, value, delimiter) => {
        const trimmed = value.trim();
        // Don't quote numbers, booleans, or null
        if (/^-?\d+\.?\d*$/.test(trimmed) || trimmed === 'true' || trimmed === 'false' || trimmed === 'null') {
          return `:${trimmed}${delimiter}`;
        }
        return `:"${trimmed}"${delimiter}`;
      });
      console.log("[Server] Fixed JSON:", fixedJson);
    }
    
    try {
      const parsed = JSON.parse(fixedJson);
      if (!Array.isArray(parsed)) throw new Error("BID_WALLS must be a JSON array");
      return parsed.map((item, index) => {
        if (!item.tokenMint || !item.bidWallAddress) {
          throw new Error(`BID_WALLS[${index}] must have tokenMint and bidWallAddress`);
        }
        return {
          tokenMint: new PublicKey(item.tokenMint),
          bidWallAddress: new PublicKey(item.bidWallAddress),
          name: item.name,
        };
      });
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in BID_WALLS: ${error.message}\nValue was: ${json.slice(0, 200)}\nTip: Try escaping quotes in .env: BID_WALLS=[{\\"tokenMint\\":\\"...\\",...}]`);
      }
      throw error;
    }
  };

  return {
    rpcUrl: getEnv("RPC_URL", "https://api.mainnet-beta.solana.com"),
    jupiterApiKey: getEnv("JUPITER_API_KEY"),
    bidWalls: parseBidWalls(getEnv("BID_WALLS", "[]")),
  };
}

const config = loadServerConfig();
const connection = new Connection(config.rpcUrl, "confirmed");

// Create a dummy wallet for read-only operations (users will sign with their own wallets)
const dummyKeypair = Keypair.generate();
const dummyWallet = new Wallet(dummyKeypair);
const provider = new AnchorProvider(connection, dummyWallet, { commitment: "confirmed" });
const bidWallClient = BidWallClient.createClient({ provider });
const bidWallService = new BidWallService(connection, bidWallClient);
const jupiterClient = new JupiterClient(config.jupiterApiKey);

// Simple CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Store pending orders for execution
const pendingOrders = new Map<string, { requestId: string; bidWallAddress: string; tokenAmount: string }>();

const server = Bun.serve({
  port: 3001,
  async fetch(req) {
    const url = new URL(req.url);
    
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // GET /api/bid-walls - Get all configured bid walls with their info
      if (url.pathname === "/api/bid-walls" && req.method === "GET") {
        const bidWallsInfo = await Promise.all(
          config.bidWalls.map(async (bw) => {
            try {
              const [priceInfo, activeStatus] = await Promise.all([
                bidWallService.calculateBidWallPrice(bw.bidWallAddress, bw.tokenMint),
                bidWallService.isBidWallActive(bw.bidWallAddress),
              ]);

              const bidWall = await bidWallService.fetchBidWall(bw.bidWallAddress);

              // Fetch Jupiter spot price (don't fail if this errors)
              let spotPrice: number | null = null;
              try {
                spotPrice = await jupiterClient.getTokenPrice(bw.tokenMint.toBase58());
              } catch (e) {
                console.warn(`Failed to fetch Jupiter price for ${bw.name}:`, e);
              }

              return {
                tokenMint: bw.tokenMint.toBase58(),
                bidWallAddress: bw.bidWallAddress.toBase58(),
                name: bw.name,
                navPerToken: priceInfo.navPerToken,
                priceAfterFee: priceInfo.priceAfterFee,
                totalNav: priceInfo.totalNav,
                activeSupply: priceInfo.activeSupply,
                quoteAmount: bidWall?.quoteAmount.toNumber() || 0,
                tokensBurned: bidWall?.baseBoughtAmount.toNumber() || 0,
                spotPrice,
                isActive: activeStatus.active,
              };
            } catch (error) {
              console.error(`Error fetching bid wall ${bw.name}:`, error);
              return {
                tokenMint: bw.tokenMint.toBase58(),
                bidWallAddress: bw.bidWallAddress.toBase58(),
                name: bw.name,
                navPerToken: 0,
                priceAfterFee: 0,
                totalNav: 0,
                activeSupply: 0,
                quoteAmount: 0,
                tokensBurned: 0,
                spotPrice: null,
                isActive: false,
                error: String(error),
              };
            }
          })
        );

        return Response.json(
          { bidWalls: bidWallsInfo, rpcUrl: config.rpcUrl },
          { headers: corsHeaders }
        );
      }

      // POST /api/quote - Get a swap quote
      if (url.pathname === "/api/quote" && req.method === "POST") {
        const body = await req.json();
        const { bidWallAddress, usdcAmount, taker } = body;

        const bidWallConfig = config.bidWalls.find(
          (bw) => bw.bidWallAddress.toBase58() === bidWallAddress
        );

        if (!bidWallConfig) {
          return Response.json(
            { error: "Bid wall not found" },
            { status: 404, headers: corsHeaders }
          );
        }

        // Get Jupiter quote for USDC -> Token
        const quote = await jupiterClient.getSwapQuote({
          inputMint: USDC_MINT,
          outputMint: bidWallConfig.tokenMint.toBase58(),
          amount: String(Math.floor(usdcAmount)),
        });

        // Calculate what we'd get from the bid wall
        const priceInfo = await bidWallService.calculateBidWallPrice(
          bidWallConfig.bidWallAddress,
          bidWallConfig.tokenMint
        );

        // Tokens we'd receive from Jupiter
        const tokensReceived = parseFloat(quote.outAmount);
        // USDC we'd get from bid wall (after fee)
        const usdcFromBidWall = (tokensReceived / 1_000_000) * priceInfo.priceAfterFee * 1_000_000;

        return Response.json(
          {
            inputAmount: quote.inAmount,
            outputAmount: quote.outAmount,
            estimatedUsdcReceived: String(Math.floor(usdcFromBidWall)),
            priceImpact: quote.priceImpactPct,
            route: "Jupiter → Bid Wall",
          },
          { headers: corsHeaders }
        );
      }

      // POST /api/swap - Create a swap transaction
      if (url.pathname === "/api/swap" && req.method === "POST") {
        const body = await req.json();
        const { bidWallAddress, usdcAmount, taker } = body;

        const bidWallConfig = config.bidWalls.find(
          (bw) => bw.bidWallAddress.toBase58() === bidWallAddress
        );

        if (!bidWallConfig) {
          return Response.json(
            { error: "Bid wall not found" },
            { status: 404, headers: corsHeaders }
          );
        }

        // Create Jupiter order (USDC -> Token)
        const order = await jupiterClient.createOrder({
          inputMint: USDC_MINT,
          outputMint: bidWallConfig.tokenMint.toBase58(),
          amount: String(Math.floor(usdcAmount)),
          taker,
        });

        // Store the pending order info for execution
        pendingOrders.set(order.requestId, {
          requestId: order.requestId,
          bidWallAddress,
          tokenAmount: order.outAmount,
        });

        return Response.json(
          {
            transaction: order.transaction,
            requestId: order.requestId,
            inAmount: order.inAmount,
            outAmount: order.outAmount,
          },
          { headers: corsHeaders }
        );
      }

      // POST /api/execute - Execute the signed swap transaction
      if (url.pathname === "/api/execute" && req.method === "POST") {
        const body = await req.json();
        const { signedTransaction, requestId } = body;

        // Execute the Jupiter swap
        const signature = await jupiterClient.executeOrder(signedTransaction, requestId);

        // Get the pending order info
        const orderInfo = pendingOrders.get(requestId);
        if (orderInfo) {
          pendingOrders.delete(requestId);
          // Note: In a production app, you'd want to also execute the bid wall sell
          // after confirming the Jupiter swap succeeded. For this frontend demo,
          // we're just doing the Jupiter swap part.
        }

        return Response.json(
          { signature, success: true },
          { headers: corsHeaders }
        );
      }

      // POST /api/sell - Create a sell transaction to sell tokens to the bid wall
      if (url.pathname === "/api/sell" && req.method === "POST") {
        const body = await req.json();
        const { bidWallAddress, tokenAmount, seller } = body;

        const bidWallConfig = config.bidWalls.find(
          (bw) => bw.bidWallAddress.toBase58() === bidWallAddress
        );

        if (!bidWallConfig) {
          return Response.json(
            { error: "Bid wall not found" },
            { status: 404, headers: corsHeaders }
          );
        }

        const bidWall = await bidWallService.fetchBidWall(bidWallConfig.bidWallAddress);
        if (!bidWall) {
          return Response.json(
            { error: "Could not fetch bid wall data" },
            { status: 500, headers: corsHeaders }
          );
        }

        // Token amount comes as a float, convert to lamports (6 decimals for most tokens)
        const tokenAmountLamports = Math.floor(tokenAmount * 1_000_000);

        // Create the sell tokens instruction
        const sellIx = await bidWallService.createSellTokensInstruction({
          amount: new BN(tokenAmountLamports),
          bidWall: bidWallConfig.bidWallAddress,
          baseMint: bidWallConfig.tokenMint,
          quoteMint: new PublicKey(USDC_MINT),
          daoTreasury: bidWall.daoTreasury,
          user: new PublicKey(seller),
        });

        // Build the transaction
        const { blockhash } = await connection.getLatestBlockhash();
        const message = new TransactionMessage({
          payerKey: new PublicKey(seller),
          recentBlockhash: blockhash,
          instructions: [sellIx],
        }).compileToV0Message();

        const tx = new VersionedTransaction(message);
        const txBase64 = Buffer.from(tx.serialize()).toString("base64");

        return Response.json(
          { transaction: txBase64 },
          { headers: corsHeaders }
        );
      }

      // POST /api/execute-sell - Send a signed sell transaction
      if (url.pathname === "/api/execute-sell" && req.method === "POST") {
        const body = await req.json();
        const { signedTransaction } = body;

        const txBuffer = Buffer.from(signedTransaction, "base64");
        const signature = await connection.sendRawTransaction(txBuffer, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });

        // Wait for confirmation
        const confirmation = await connection.confirmTransaction(signature, "confirmed");
        
        if (confirmation.value.err) {
          return Response.json(
            { error: `Transaction failed: ${JSON.stringify(confirmation.value.err)}` },
            { status: 500, headers: corsHeaders }
          );
        }

        return Response.json(
          { signature, success: true },
          { headers: corsHeaders }
        );
      }

      // Health check
      if (url.pathname === "/api/health") {
        return Response.json({ status: "ok" }, { headers: corsHeaders });
      }

      return Response.json(
        { error: "Not found" },
        { status: 404, headers: corsHeaders }
      );
    } catch (error) {
      console.error("API Error:", error);
      return Response.json(
        { error: String(error) },
        { status: 500, headers: corsHeaders }
      );
    }
  },
});

console.log(`🚀 API Server running at http://localhost:${server.port}`);
console.log(`📋 Configured bid walls: ${config.bidWalls.length}`);
config.bidWalls.forEach((bw, i) => {
  console.log(`   ${i + 1}. ${bw.name || "Unnamed"}: ${bw.tokenMint.toBase58().slice(0, 8)}...`);
});
