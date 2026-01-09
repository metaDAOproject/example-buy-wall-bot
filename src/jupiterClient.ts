import {
  JupiterPriceResponse,
  JupiterOrderResponse,
  JupiterExecuteResponse,
} from "./types.ts";

// Jupiter API endpoints
// Docs: https://dev.jup.ag/api-reference/price/v3/price
const JUPITER_PRICE_API = "https://api.jup.ag/price/v3";
// Docs: https://dev.jup.ag/api-reference/ultra/order
const JUPITER_ULTRA_API = "https://api.jup.ag/ultra/v1";

// Debug flag - set to true to see API requests/responses in console
const DEBUG = true;

function log(...args: unknown[]) {
  if (DEBUG) console.log("[Jupiter]", ...args);
}

export class JupiterClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Get the current price of a token in USD
   * Docs: https://dev.jup.ag/api-reference/price/v3/price
   * @param tokenMint Token mint address
   * @returns Price in USD (human readable)
   */
  async getTokenPrice(tokenMint: string): Promise<number> {
    const url = new URL(JUPITER_PRICE_API);
    url.searchParams.set("ids", tokenMint);

    log("GET Price:", url.toString());

    const response = await fetch(url.toString(), {
      headers: {
        "x-api-key": this.apiKey,
      },
    });

    log("Price Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      log("Price Error response:", errorText);
      throw new Error(`Jupiter Price API error: ${response.status} - ${errorText}`);
    }

    const data: JupiterPriceResponse = await response.json() as JupiterPriceResponse;
    log("Price data keys:", Object.keys(data));
    
    const tokenData = data[tokenMint];

    if (!tokenData) {
      log("Available tokens in response:", Object.keys(data));
      throw new Error(`No price data found for token: ${tokenMint}`);
    }

    log("Token price:", tokenData.usdPrice);
    return tokenData.usdPrice;
  }

  /**
   * Get prices for multiple tokens in USD
   * @param tokenMints Array of token mint addresses
   * @returns Map of token mint to price in USD
   */
  async getTokenPrices(tokenMints: string[]): Promise<Map<string, number>> {
    const url = new URL(JUPITER_PRICE_API);
    url.searchParams.set("ids", tokenMints.join(","));

    log("GET Prices:", url.toString());

    const response = await fetch(url.toString(), {
      headers: {
        "x-api-key": this.apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      log("Prices Error:", errorText);
      throw new Error(`Jupiter Price API error: ${response.status} - ${errorText}`);
    }

    const data: JupiterPriceResponse = await response.json() as JupiterPriceResponse;
    const prices = new Map<string, number>();

    for (const [mint, tokenData] of Object.entries(data)) {
      if (tokenData && tokenData.usdPrice !== undefined) {
        prices.set(mint, tokenData.usdPrice);
      }
    }

    return prices;
  }

  /**
   * Create a swap order using Jupiter Ultra API
   * Docs: https://dev.jup.ag/api-reference/ultra/order
   * NOTE: This is a GET request with query params, not POST!
   * @param params Order parameters
   * @returns Order response with transaction
   */
  async createOrder(params: {
    inputMint: string;
    outputMint: string;
    amount: string;
    taker: string;
  }): Promise<JupiterOrderResponse> {
    const url = new URL(`${JUPITER_ULTRA_API}/order`);
    url.searchParams.set("inputMint", params.inputMint);
    url.searchParams.set("outputMint", params.outputMint);
    url.searchParams.set("amount", params.amount);
    url.searchParams.set("taker", params.taker);

    log("GET Order:", url.toString());

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "x-api-key": this.apiKey,
      },
    });

    log("Order Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      log("Order Error response:", errorText);
      throw new Error(`Jupiter Ultra API error: ${response.status} - ${errorText}`);
    }

    const data: JupiterOrderResponse = await response.json() as JupiterOrderResponse;
    log("Order response keys:", Object.keys(data));
    log("Order requestId:", data.requestId);
    log("Order transaction exists:", !!data.transaction);
    
    if (!data) {
      throw new Error(`No order data found`);
    }
    
    // Check for error in response (can happen even with 200 status)
    if (data.errorCode) {
      throw new Error(`Jupiter order error: ${data.errorMessage || `Error code ${data.errorCode}`}`);
    }
    
    if (!data.transaction) {
      throw new Error(`No transaction returned. Error: ${data.errorMessage || 'Unknown'}`);
    }

    return data;
  }

  /**
   * Execute a swap order by sending the signed transaction
   * Docs: https://dev.jup.ag/api-reference/ultra/execute
   * @param signedTransaction Base64 encoded signed transaction
   * @param requestId Request ID from createOrder
   * @returns Transaction signature
   */
  async executeOrder(
    signedTransaction: string,
    requestId: string
  ): Promise<string> {
    const url = `${JUPITER_ULTRA_API}/execute`;

    log("POST Execute:", url);
    log("Execute requestId:", requestId);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({
        signedTransaction,
        requestId,
      }),
    });

    log("Execute Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      log("Execute Error response:", errorText);
      throw new Error(`Jupiter Execute API error: ${response.status} - ${errorText}`);
    }

    const data: JupiterExecuteResponse = await response.json() as JupiterExecuteResponse;
    log("Execute response:", JSON.stringify(data, null, 2));

    if (data.status === "Failed") {
      throw new Error(`Jupiter execution failed: ${data.error || "Unknown error"}`);
    }

    if (!data.signature) {
      throw new Error("Jupiter execution succeeded but no signature returned");
    }

    return data.signature;
  }

  /**
   * Get a quote for swapping tokens (without creating an order)
   * Uses the order endpoint without a taker to get quote info
   */
  async getSwapQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: string;
  }): Promise<{
    inAmount: string;
    outAmount: string;
    priceImpactPct: string;
  }> {
    const url = new URL(`${JUPITER_ULTRA_API}/order`);
    url.searchParams.set("inputMint", params.inputMint);
    url.searchParams.set("outputMint", params.outputMint);
    url.searchParams.set("amount", params.amount);
    // Don't set taker - this gives us a quote without a transaction

    log("GET Quote:", url.toString());

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "x-api-key": this.apiKey,
      },
    });

    log("Quote Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      log("Quote Error response:", errorText);
      throw new Error(`Jupiter Quote API error: ${response.status} - ${errorText}`);
    }

    const data: JupiterOrderResponse = await response.json() as JupiterOrderResponse;
    log("Quote inAmount:", data.inAmount, "outAmount:", data.outAmount);

    return {
      inAmount: data.inAmount,
      outAmount: data.outAmount,
      priceImpactPct: data.priceImpactPct,
    };
  }
}
