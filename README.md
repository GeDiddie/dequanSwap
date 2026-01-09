# dequanSwap

**Production-grade Solana sniper UI powered by dequanW's Trading WebSocket API**

Live at: [snipe.dequan.xyz](https://snipe.dequan.xyz)

---

## Overview

A tiered, non-custodial swap/snipe interface with:
- **Real-time feed**: Kinetic vertical stream of new tokens from dequanW's 1-minute strategy
- **Live trading**: Phantom signature per trade
- **Fast Mode** (Sniper/Apex): Experimental no-popup execution via WSOL delegation + session key
- **Tier gating**: Scout/Sniper/Apex product tiers with progressive feature unlocks
- **Live 1-second candles**: TradingView-like candlestick chart built client-side from SolanaTracker WebSocket streams

---

## Architecture

### Frontend (this repo)
- **Tech**: React 19, TypeScript, Vite, Tailwind-style utilities, Framer Motion
- **Wallet**: `@solana/wallet-adapter-react` (Phantom)
- **Deployment**: Cloudflare Pages (project: `dequanswap`)

### Backend (dequanW)
- **Location**: `~/bot/jul2025/dequanW/`
- **Trading API**: WebSocket server at `tradingAPI/server.js`
  - Endpoints: `quote`, `build_swap_tx`, `create_order`, `submit_signed_tx`
  - Integrates Jupiter v6 aggregator
  - Deployment: `wss://dequantrade-ws.dequan.xyz` (port 8900 via Cloudflare Tunnel)
- **Data Gateway**: Real-time metrics aggregation at `dequanW-data-gateway/`
  - Aggregates SolanaTracker datastream (13 rooms per token)
  - Provides: TPS, liquidity, holders, volume, dev/sniper percentages
  - Deployment: `wss://dequandata.dequan.xyz` (port 8913 via Cloudflare Tunnel)
- **Strategy**: `oneMinuteStrategy.js` publishes new token signals via WS feed
- **Dashboard**: `https://dequanw-api.dequan.xyz` (API-lite feed/watching)

For backend integration details, see:
- [Trading API Integration](docs/trading-api/TRADING_API_INTEGRATION.md)
- [Data Gateway Deployment](docs/DATA_GATEWAY_DEPLOYMENT.md)

---

## Quick Start

### Prerequisites
- Node.js 22.4.1+
- Running dequanW backend (see below)
- Phantom wallet extension

### Install & Run
```bash
npm install
npm run dev
```

Open `http://localhost:5173`

### Build for Production
```bash
npm run build
```

Artifacts in `dist/` are ready to deploy to Cloudflare Pages.

---

## Configuration

Copy `.env.example` → `.env` (for local development):

```bash
# Required - Backend Services
VITE_DEQUANW_WS_URL=ws://localhost:8900           # Trading API (local)
VITE_DATA_GATEWAY_URL=ws://localhost:8913         # Data Gateway (local)
VITE_SOLANA_RPC_URL=https://auth.dequan.xyz/solana-rpc

# Account Management
VITE_CONTROL_PLANE_URL=https://auth.dequan.xyz

# Auth (Dev Only)
# - For public hosting: protect the WS hostname with Cloudflare Access (edge auth) and use wallet-signature auth (wallet binding)
# - For local/dev: API key / token are supported but not safe for public sites
VITE_DEQUANW_API_KEY=your-api-key          # Dev only
VITE_DEQUANW_AUTH_TOKEN=short-lived-token  # Legacy token auth (dev/staging)

# Optional (recommended): restrict Debug Portal unlock to this wallet
VITE_DEBUG_ADMIN_PUBKEY=YOUR_SOLANA_WALLET_PUBKEY
```

**Security**: Never ship long-lived secrets to the browser. Prefer Cloudflare Access (edge auth) + wallet-signature auth for production.

RPC note:
- Any `VITE_*` value is bundled into the frontend and is effectively public.
- Do not embed paid RPC API keys (Helius/QuickNode/etc) in production builds.
- If you need a paid RPC, proxy it server-side (Worker/Node) so the key stays secret.

---

## Popout Candle Charts (Real-Time 1s OHLC)

The popout chart displays **1-second OHLC candlesticks** with a modular data provider architecture.

### Architecture

```
[Data Provider]     →  [dequanW Backend]      →  [dequanSwap Frontend]
(SolanaTracker)        (Trading API WS)          (Browser)
```

- **Backend** subscribes to data provider (SolanaTracker, Jupiter, etc.)
- **Frontend** subscribes to backend via Trading WS (`subscribe_price` message)
- **Backend** broadcasts high-frequency `price_tick` messages to clients
- **Frontend** builds 1s OHLC candles from price ticks client-side

**Benefits:**
- ✅ Security: data provider keys stay on backend
- ✅ Modularity: swap providers backend-side without frontend changes
- ✅ Cloud-ready: supports deployment anywhere (local PC → VPS → cloud)

### Current Status

**Frontend:** ✅ Ready for price feed subscription  
**Backend:** ⏳ Needs price feed implementation (see `docs/backend-price-feed-implementation.md`)  
**Fallback:** Quote polling (1 tick/sec) until backend price feed is ready

### Tier behavior

- **Scout (Free)**: 1s live candles ✅
- **Sniper/Apex**: 1s live candles ✅ + additional **risk/edge signals** ✅
  - Signals include: holders/top10/dev/sniper/insider/fees/curve + lifecycle/pool stats

### Signal Delivery (SolanaTracker Datastream via Pages Proxy)

Risk/edge signals (paid tiers only) use SolanaTracker datastream.

In production we do **not** ship the SolanaTracker datastream key to the browser.
Instead, the browser connects to a Pages Function WS proxy at `/ws/solanatracker`.

The proxy requires a short-lived session token (query param `st`) minted by `/api/solanatracker/session`.
Both endpoints run as Cloudflare Pages Functions.

### Required Cloudflare secrets

Set these as **Secrets** in your Cloudflare Pages project:

- `SOLANATRACKER_DATASTREAM_KEY` — SolanaTracker datastream key (upstream WS key)
- `SOLANATRACKER_GATE_SECRET` — random secret used to sign/verify short-lived session tokens
  - Generate: `openssl rand -hex 32`

Dashboard steps (Cloudflare): **Workers & Pages** → select your Pages project → **Settings** → **Variables and Secrets** → **Add** → enter name/value → **Encrypt** → **Save** → redeploy.

### Local development

- `npm run dev` (Vite) does **not** run Pages Functions.
  - To develop candles in Vite dev, set `VITE_SOLANATRACKER_DATASTREAM_KEY` (dev-only) and it will connect directly to SolanaTracker.
- To test the production-like setup locally (Functions + proxy), use:
  - `npm run pages:dev`
  - Put secrets in a `.dev.vars` file next to `wrangler.toml` (do not commit it).

### Cloudflare Access (recommended)

Cloudflare Access should protect the public Trading WS hostname (e.g. `wss://dequantrade-ws.dequan.xyz`).
The browser authenticates with Access at the edge; the origin can additionally verify the forwarded assertion JWT.

### Production checklist

#### Option A (recommended): Cloudflare Access + wallet-signature WS auth

1) On the Trading API server, set:
  - `TRADING_API_WALLET_AUTH_REQUIRED=1`
  - `TRADING_API_CLOSE_ON_AUTH_FAIL=1`

2) Protect the public WS hostname with Cloudflare Access and configure the Trading API to verify it:
  - `TRADING_API_CF_ACCESS_REQUIRED=1`
  - `TRADING_API_CF_ACCESS_ISSUER=https://<team>.cloudflareaccess.com`
  - `TRADING_API_CF_ACCESS_AUDIENCE=<access-app-aud>`
  - Recommended: `TRADING_API_DISABLE_JWT=1`

3) Configure the frontend:
  - Set `VITE_DEQUANW_WS_URL=wss://dequantrade-ws.dequan.xyz`
  - Ensure the site is served over HTTPS

That’s it — the UI will sign the server-provided challenge using the connected wallet.

---

## Running the Backend (dequanW)

Right now the backend engine is **dequanW**.

### Engine start procedure (3 steps)

1) Start the PM2 service `1min`

```bash
cd ~/bot/jul2025/dequanW
pm2 restart 1min
```

2) In a terminal, start dequanSell:

```bash
cd ~/bot/jul2025/dequanW/dequanSell
npm start
```

3) In a separate terminal, start dequanBuy:

```bash
cd ~/bot/jul2025/dequanW/dequanBuy
npm start
```

Important:
- You must use `npm start` (not `node index.js`). The start scripts include special memory allocation to prevent crashes.
- Start order matters: `1min` → dequanSell → dequanBuy.

### Trading WebSocket (required for the UI trade flow)

The UI trade flow requires the dequanW Trading API WebSocket server (`trading-api`, default `:8900`).
If it’s already running under PM2, restart it like:

```bash
cd ~/bot/jul2025/dequanW
pm2 restart trading-api --update-env
```

Backend must:
- Listen on port `8900` (or configure via env)
- Return `route.serializedQuote` in `quote_result` messages
- Support `quote` and `build_swap_tx` WebSocket commands

Full backend API spec: [docs/trading-api/WEBSOCKET_API_IMPLEMENTATION.md](docs/trading-api/WEBSOCKET_API_IMPLEMENTATION.md)

---

## Project Structure

```
dequanSwap/
├── src/
│   ├── components/        # UI components (TokenRow, RadarPulse, etc.)
│   ├── lib/
│   │   ├── product.ts     # Tier gating and feature flags
│   │   ├── tradingWs.ts   # WebSocket client for dequanW
│   │   ├── fastMode.ts    # WSOL delegation tx builders
│   │   ├── botWallet.ts   # Local keypair storage
│   │   └── solana.ts      # Web3.js helpers
│   ├── App.tsx            # Main application
│   └── App.css            # Styling
├── docs/
│   ├── product/           # Product & UX documentation
│   │   ├── MASTER_BUILD_CHECKLIST.md  ⭐ ALWAYS CHECK BEFORE CHANGES
│   │   ├── ROADMAP.md     # Feature roadmap
│   │   ├── TIERS.md       # Tier definitions
│   │   ├── FAST_MODE.md   # Fast Mode hybrid design
│   │   └── ...
│   └── trading-api/       # Backend integration docs
├── dev-docs/              # Private deployment docs (gitignored)
└── public/                # Static assets
```

---

## 🚨 Master TODO List

**Location**: [docs/product/MASTER_BUILD_CHECKLIST.md](docs/product/MASTER_BUILD_CHECKLIST.md)

**⚠️ ALWAYS review this checklist before making changes or deploying.**

Current priorities:
1. ✅ Delegate-authority BUY path (experimental, implemented)
2. 🔴 Delegate-authority SELL path (high priority, in progress)
3. Bot wallet hardening (encryption, export/backup)
4. Explainer microvideo system (? icon + clips)

---

## Product Tiers

| Tier | Quote Poll | Live Trading | Fast Mode | Tracked Tokens |
|------|------------|--------------|-----------|----------------|
| **Scout** | 4s | ✅ | ❌ | 5 |
| **Sniper** | 0.8s | ✅ | ✅ | 20 |
| **Apex** | 0.5s | ✅ | ✅ | Unlimited |

See [docs/product/TIERS.md](docs/product/TIERS.md) for full feature matrix.

---

## Fast Mode (Experimental)

**Tier**: Sniper/Apex only  
**Status**: BUY path implemented, SELL in progress

Fast Mode enables no-popup swaps by:
1. User arms a WSOL delegation (Phantom signs once, 30min TTL)
2. Session key (ephemeral) is delegated to spend up to a capped amount
3. BUYs execute via session key (no Phantom popup)

---

## Watchlist → Holdings (how it works in the frontend)

In your personal dequanW bot, a successful buy typically **moves** a token from a monitored/queue table into a holdings table.

dequanSwap mirrors that UX, but it’s frontend-native:

- **Watchlist (“Watching” panel)** is stored in the browser (`localStorage` key: `dequanswap.watchedTokens`).
- **Holdings (“Holdings” panel)** is stored per wallet (`localStorage` key: `dequanswap.holdings.{walletAddress}`).
- **Sold Tokens (“Sold Tokens” panel)** is stored per wallet (`localStorage` key: `dequanswap.soldTokens.{walletAddress}`).

When you press **Snipe** and the transaction is confirmed, the UI calls `addHolding(mint)` in [src/App.tsx](src/App.tsx):

- It snapshots the token’s market-cap numbers from the current feed (`getFeedMcSnapshot`) and saves `{ mint, boughtAt, buyMc, currentMc }` into Holdings.
- It removes the same mint from the Watchlist so you’re no longer “monitoring” a token you already bought.

Notes:

- This does **not** write to any database. It’s per-browser/per-device state.
- Holdings “current MC” gets refreshed from the live feed over time, so PnL% updates as the feed updates.

### Holdings → Sell → Sold Tokens

Selling is treated as a first-class workflow:

- Clicking **Sell** in the **Holdings** panel flips the right-hand **Snipe** card to a **Sell** back-side.
- The Sell view is pre-filled with the holding’s mint, supports quick percent buttons (25/50/100), and shows the sell signature/error.
- On confirmed sell, the UI appends a Sold Tokens history entry and updates Holdings.

Implementation details: [docs/product/TRADE_LIFECYCLE.md](docs/product/TRADE_LIFECYCLE.md)

**Implementation**: [docs/product/FAST_MODE.md](docs/product/FAST_MODE.md)

**Trade lifecycle** (Buy → Holdings → Sell → Sold): [docs/product/TRADE_LIFECYCLE.md](docs/product/TRADE_LIFECYCLE.md)

**Build plan (dequanW parity)**: [docs/product/BUILD_PLAN.md](docs/product/BUILD_PLAN.md)

---

## Deployment

### Production (Cloudflare Pages)
```bash
npm run build
npx wrangler pages deploy dist --project-name=dequanswap
```

**Project**: `dequanswap`  
**URL**: [snipe.dequan.xyz](https://snipe.dequan.xyz)

Full deployment guide: [dev-docs/DEPLOYMENT.md](dev-docs/DEPLOYMENT.md) (private)

---

## Development Guidelines

- **Legibility first**: [docs/product/BUILD_GUIDELINES.md](docs/product/BUILD_GUIDELINES.md)
- **Run checklist**: [docs/product/MASTER_BUILD_CHECKLIST.md](docs/product/MASTER_BUILD_CHECKLIST.md)
- **UI requirements**: [docs/product/UX_MINIMALIST.md](docs/product/UX_MINIMALIST.md)

---

## Fees & Subscriptions

### Trade Fees (by plan)

- **Scout**: 1% fee per trade (buy + sell)
- **Sniper**: 0.75% fee per trade (buy + sell)
- **Apex**: 0.5% fee per trade (buy + sell)
- Fee wallet: `FBPHWzeFDo8bskFBBgwuZRXDfUuZ69Gu2t7Ty75sXSVw`

Backend implementation details: [../jul2025/dequanW/tradingAPI/FEE_IMPLEMENTATION.md](../jul2025/dequanW/tradingAPI/FEE_IMPLEMENTATION.md)

### Subscriptions (Sniper/Apex)

- Paid plans are billed in **USDC** (SPL token) and sent to:
  - `BvXeLv6PVrVCn6iFLaBf4weZc32ayrRXy785b39cDQfa`
- Trading API tracks payment attempts and activates tiers server-side.

Backend documentation: [../jul2025/dequanW/tradingAPI/SUBSCRIPTIONS.md](../jul2025/dequanW/tradingAPI/SUBSCRIPTIONS.md)

---

## Security Notes

- Never commit secrets (`.env`, `dev-docs/` are gitignored)
- Fast Mode caps are conservative by default
- All transactions require explicit user action
- Private keys never leave the browser (except Bot Wallet, stored in localStorage)

---

## License

Proprietary - Internal use only

---

**Maintainer**: g1@G1  
**Created**: December 2025  
**Last Updated**: January 5, 2026

