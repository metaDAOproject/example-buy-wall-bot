# MetaDAO Bid Wall Arbitrage Bot

An arbitrage bot that monitors MetaDAO bid walls and executes profitable trades by buying tokens on Jupiter and selling them into bid walls.

## How It Works

1. **Monitor**: The bot continuously polls configured bid walls and Jupiter prices
2. **Compare**: For each token, it compares:
   - **Spot price**: Current market price on Jupiter
   - **Bid wall price**: NAV-based price from the bid wall (treasury + AMM reserves / supply) minus 1% fee
3. **Execute**: When `spot_price < bid_wall_price * (1 - buffer)`, the bot:
   - Buys tokens on Jupiter using USDC
   - Sells the tokens into the bid wall for USDC
   - Pockets the difference as profit

## Prerequisites

- [Bun](https://bun.sh/) v1.0+
- A Solana wallet with USDC and SOL for transaction fees
- A free Jupiter API key from [Jupiter Portal](https://portal.jup.ag/)

## Installation

```bash
# Clone the repository
git clone https://github.com/metaDAOproject/example-buy-wall-bot
cd example-buy-wall-bot

# Install dependencies
bun install
```

## Configuration

Create a `.env` file in the project root with the following variables:

```bash
# Solana Configuration
RPC_URL=https://api.mainnet-beta.solana.com
WALLET_PRIVATE_KEY=your_base58_encoded_private_key

# Jupiter API Configuration
# Get your free API key at https://portal.jup.ag/
JUPITER_API_KEY=your_jupiter_api_key

# Bot Configuration
# Polling interval in milliseconds (default: 30000 = 30 seconds)
POLLING_INTERVAL_MS=30000

# Trade size in USDC (default: 100 USDC)
TRADE_SIZE_USDC=100

# Slippage tolerance for Jupiter swaps in basis points (default: 50 = 0.5%)
SLIPPAGE_BPS=50

# Price buffer on top of bid wall 1% fee, in percentage (default: 1 = 1%)
# Total threshold = 1% bid wall fee + this buffer
# E.g., if buffer is 1%, you'll only trade if spot price is at least 2% below bid wall NAV
PRICE_BUFFER_PERCENT=1

# Dry run mode - set to true to simulate without executing trades
DRY_RUN=true

# Bid Wall Configurations (JSON array)
# Format: [{"tokenMint": "...", "bidWallAddress": "...", "name": "Optional Name"}]
BID_WALLS=[{"tokenMint":"TOKEN_MINT_ADDRESS","bidWallAddress":"BID_WALL_ADDRESS","name":"TOKEN"}]
```

### Finding Bid Walls

To find active bid walls for tokens, you can:

1. Query the bid wall program directly using the futarchy SDK
2. Use the Solana Explorer to find bid wall accounts

### Configuration Parameters Explained

| Parameter | Description | Default |
|-----------|-------------|---------|
| `RPC_URL` | Solana RPC endpoint | `https://api.mainnet-beta.solana.com` |
| `WALLET_PRIVATE_KEY` | Base58 encoded private key of your trading wallet | Required |
| `JUPITER_API_KEY` | Your Jupiter API key | Required |
| `POLLING_INTERVAL_MS` | How often to check for opportunities (ms) | `30000` (30s) |
| `TRADE_SIZE_USDC` | Amount of USDC to trade per opportunity | `100` |
| `SLIPPAGE_BPS` | Max slippage for Jupiter swaps (basis points) | `50` (0.5%) |
| `PRICE_BUFFER_PERCENT` | Additional buffer on top of 1% bid wall fee | `1` (1%) |
| `DRY_RUN` | Simulate trades without executing | `false` |
| `BID_WALLS` | JSON array of bid walls to monitor | `[]` |

## Usage

### Option 1: Web Frontend (Manual Swaps)

A web frontend is included for users who want to manually swap tokens into bid walls using their own wallet.

```bash
# Install frontend dependencies
bun run frontend:install

# Start the API server (requires JUPITER_API_KEY and BID_WALLS in .env)
bun run server

# In another terminal, start the frontend
bun run frontend
```

Then open http://localhost:3000 in your browser to:
1. Connect your Phantom or Solflare wallet
2. View bid wall information (NAV price, spot price, wall balance)
3. Swap USDC into the bid wall

**Frontend Environment Variables:**
| Variable | Description | Required |
|----------|-------------|----------|
| `RPC_URL` | Solana RPC endpoint | No (defaults to mainnet) |
| `JUPITER_API_KEY` | Your Jupiter API key | **Yes** |
| `BID_WALLS` | JSON array of bid walls | **Yes** |

### Option 2: Automated Bot

For automated arbitrage trading, use the bot which monitors prices and executes trades automatically.

#### Dry Run Mode (Recommended for Testing)

```bash
# Run in dry run mode to simulate without executing trades
bun run dry-run
```

#### Production Mode

```bash
# Start the bot in production mode
bun start
```

#### Development Mode

```bash
# Run with hot-reloading for development
bun run dev
```

## Example Output

```
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🏛️  MetaDAO Bid Wall Arbitrage Bot                         ║
║                                                              ║
║   Buy tokens on Jupiter, sell into bid walls for profit      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

🔧 Bot Configuration:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  RPC URL: https://api.mainnet-beta.solana.com
  Jupiter API Key: abc12345...
  Polling Interval: 30s
  Trade Size: 100.00 USDC
  Slippage: 0.5%
  Price Buffer: 1% (total threshold: 2%)
  Dry Run: ✅ YES
  Bid Walls: 1 configured

📋 Monitored Bid Walls:
  1. META: EPjFWdd5...
     Bid Wall: 7xKXtg2C...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 Starting Bid Wall Arbitrage Bot
   Wallet: YourWa11etAddress...
   Mode: DRY RUN

💰 USDC Balance: 1000.00 USDC
⚡ SOL Balance: 0.5 SOL

📊 Checking opportunities at 2025-01-07T12:00:00.000Z
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─ META ✅ PROFITABLE
│  Spot Price:      $0.018500 USDC
│  Bid Wall NAV:    $0.020000 USDC
│  After 1% Fee:    $0.019800 USDC
│  Est. Profit:     +5.41% ($5.41)
└──────────────────────────────

🎯 Found 1 profitable opportunities!

🔄 Executing arbitrage for META...
   🏃 DRY RUN - Simulating trade...
   📊 Simulation Results:
      Input:  100 USDC
      Tokens: 5405.405405
      Output: 107.03 USDC (from bid wall)
      Profit: +7.03 USDC (7.03%)
      Price Impact: 0.12%

⏳ Waiting 30s until next check...
```

## How Bid Wall Pricing Works

The bid wall calculates token price based on **Net Asset Value (NAV)**:

```
NAV = DAO Treasury USDC + AMM USDC Reserves + Bid Wall USDC Balance
Price = NAV / Active Token Supply
Sell Price = Price * (1 - 1% fee)
```

The bot monitors when the Jupiter spot price falls below this NAV-based price, creating an arbitrage opportunity.

## Architecture

```
src/
├── index.ts          # Bot entry point
├── config.ts         # Configuration loading
├── types.ts          # TypeScript type definitions
├── bot.ts            # Main bot logic
├── jupiterClient.ts  # Jupiter API integration
├── bidWallService.ts # Bid wall interactions
└── server.ts         # API server for frontend

frontend/
├── src/
│   ├── main.tsx         # Frontend entry point
│   ├── App.tsx          # Root component with wallet providers
│   ├── index.css        # Tailwind CSS styles
│   └── components/
│       ├── Header.tsx        # Header with wallet connect
│       ├── Background.tsx    # Animated background
│       └── SwapInterface.tsx # Main swap UI
├── package.json         # Frontend dependencies
├── vite.config.ts       # Vite configuration
└── tailwind.config.js   # Tailwind theme
```

## Risk Disclaimer

⚠️ **USE AT YOUR OWN RISK**

- This bot executes real financial transactions
- Cryptocurrency trading carries significant risk
- Always test with small amounts first
- The bot operators are not responsible for any losses
- Smart contract interactions can have unexpected outcomes

## Dependencies

- `@metadaoproject/futarchy` - MetaDAO Futarchy SDK
- `@solana/web3.js` - Solana Web3 library
- `@solana/spl-token` - SPL Token library

## License

MIT

