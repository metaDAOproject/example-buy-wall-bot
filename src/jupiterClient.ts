import {
  JupiterPriceResponse,
  JupiterOrderRequest,
  JupiterOrderResponse,
  JupiterExecuteResponse,
} from "./types.ts";

const JUPITER_PRICE_API = "https://api.jup.ag/price/v3";
const JUPITER_ULTRA_API = "https://api.jup.ag/ultra/v1";

export class JupiterClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Get the current price of a token in USD
   * @param tokenMint Token mint address
   * @returns Price in USD (human readable)
   */
  async getTokenPrice(tokenMint: string): Promise<number> {
    const url = new URL(JUPITER_PRICE_API);
    url.searchParams.set("ids", tokenMint);

    const response = await fetch(url.toString(), {
      headers: {
        "x-api-key": this.apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jupiter Price API error: ${response.status} - ${errorText}`);
    }

    const data: JupiterPriceResponse = await response.json() as JupiterPriceResponse;
    const tokenData = data[tokenMint];

    if (!tokenData) {
      throw new Error(`No price data found for token: ${tokenMint}`);
    }

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

    const response = await fetch(url.toString(), {
      headers: {
        "x-api-key": this.apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
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
   * @param params Order parameters
   * @returns Order response with transaction
   */
  async createOrder(params: {
    inputMint: string;
    outputMint: string;
    amount: string;
    taker: string;
  }): Promise<JupiterOrderResponse> {
    const url = `${JUPITER_ULTRA_API}/order`;

    const body: JupiterOrderRequest = {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      taker: params.taker,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jupiter Ultra API error: ${response.status} - ${errorText}`);
    }

    const data: JupiterOrderResponse = await response.json() as JupiterOrderResponse;
    if (!data) {
      throw new Error(`No order data found`);
    }
    if (data.simulationError) {
      throw new Error(`Jupiter simulation error: ${data.simulationError}`);
    }

    return data;
  }

  /**
   * Execute a swap order by sending the signed transaction
   * @param signedTransaction Base64 encoded signed transaction
   * @param requestId Request ID from createOrder
   * @returns Transaction signature
   */
  async executeOrder(
    signedTransaction: string,
    requestId: string
  ): Promise<string> {
    const url = `${JUPITER_ULTRA_API}/execute`;

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

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jupiter Execute API error: ${response.status} - ${errorText}`);
    }

    const data: JupiterExecuteResponse = await response.json() as JupiterExecuteResponse;

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
   * This is useful for simulating the swap outcome
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
    // Use the order endpoint but we won't execute it
    // The Ultra API returns quote info in the order response
    const url = `${JUPITER_ULTRA_API}/order`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amount,
        taker: "11111111111111111111111111111111", // Dummy taker for quote
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jupiter Quote API error: ${response.status} - ${errorText}`);
    }

    const data: JupiterOrderResponse = await response.json() as JupiterOrderResponse;

    return {
      inAmount: data.inAmount,
      outAmount: data.outAmount,
      priceImpactPct: data.priceImpactPct,
    };
  }
}

