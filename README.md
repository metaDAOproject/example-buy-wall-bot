# MetaDAO Bid Wall Bot

A bot and web interface for interacting with MetaDAO bid walls.

## Quick Start

```bash
# Install
bun install

# Copy example env and configure
cp example.env .env

# Run the bot (dry run mode)
bun run dry-run
```

## What is a Bid Wall?

MetaDAO bid walls buy back tokens at a NAV (Net Asset Value) price:

```
NAV Price = (DAO Treasury + AMM Reserves + Bid Wall Balance) / (10M - Tokens Burned)
```

The bid wall charges a 1% fee, so you receive `NAV * 0.99` when selling.

## Configuration

Edit your `.env` file:

```bash
# Required
JUPITER_API_KEY=your_key_from_portal.jup.ag
BID_WALLS='[{"tokenMint":"TOKEN_MINT","bidWallAddress":"WALL_ADDRESS","name":"Token Name"}]'

# For the bot (not needed for frontend-only)
WALLET_PRIVATE_KEY=your_private_key

# Optional
RPC_URL=https://api.mainnet-beta.solana.com
TRADE_SIZE_USDC=10
DRY_RUN=true
```

### Private Key Format

The bot supports two formats:

**Base58** (from Phantom):
```
WALLET_PRIVATE_KEY=5abc123def...
```

**JSON byte array** (from `solana-keygen`):
```
WALLET_PRIVATE_KEY=[1,2,3,4,5,6,7,8,9,10,...]
```

## Usage

### Web Frontend

For manually selling tokens to bid walls:

```bash
# Terminal 1: Start API server
bun run server

# Terminal 2: Start frontend
bun run frontend
```

Open http://localhost:5173 and connect your wallet.

### Automated Bot

For automated arbitrage (buy on Jupiter when spot < NAV, sell to bid wall):

```bash
# Test mode (recommended first)
bun run dry-run

# Production mode
bun start
```

## Example Bot Output

```
┌─ Solomon ✅ PROFITABLE
│  Spot Price:      $0.815654 USDC
│  Bid Wall NAV:    $1.000013 USDC
│  After 1% Fee:    $0.990012 USDC
│  Wall Balance:    $500.00 USDC
│  Est. Profit:     +21.38% ($2.14)
└──────────────────────────────

🎯 Found 1 profitable opportunities!

🔄 Executing arbitrage for Solomon...
   🏦 Bid Wall Balance: $500.00 USDC
   📝 Creating Jupiter swap order...
   💱 Jupiter: 10 USDC -> 12.26 tokens
   📊 Expected output: $12.14 USDC
   ✅ Trade executed!
```

The bot checks:
- ✅ Is spot price below NAV (minus fees and buffer)?
- ✅ Does the bid wall have enough USDC to pay out?

## Scripts

| Command | Description |
|---------|-------------|
| `bun start` | Run bot in production mode |
| `bun run dry-run` | Run bot in simulation mode |
| `bun run server` | Start API server for frontend |
| `bun run frontend` | Start web frontend |

## Project Structure

```
src/
├── index.ts          # Bot entry point
├── bot.ts            # Arbitrage logic
├── server.ts         # API for frontend
├── jupiterClient.ts  # Jupiter API
└── bidWallService.ts # Bid wall interactions

frontend/
└── src/
    └── components/
        └── SwapInterface.tsx  # Sell UI
```

## Risk Disclaimer

⚠️ **USE AT YOUR OWN RISK** - This executes real transactions. Always test with small amounts first.

## License

MIT
