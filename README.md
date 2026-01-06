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

---

## Architecture

### Frontend (this repo)
- **Tech**: React 19, TypeScript, Vite, Tailwind-style utilities, Framer Motion
- **Wallet**: `@solana/wallet-adapter-react` (Phantom)
- **Deployment**: Cloudflare Pages (project: `dequanswap`)

### Backend (dequanW)
- **Location**: `~/bot/jul2025/dequanW/`
- **Trading API**: WebSocket server at `tradingAPI/server.js`
  - Endpoints: `quote`, `build_swap_tx`
  - Integrates Jupiter v6 aggregator
- **Strategy**: `oneMinuteStrategy.js` publishes new token signals via WS feed
- **Deployment**:
  - API-lite (feed/watching): `https://dequanw-api.dequan.xyz`
  - Trading API (WebSocket): `wss://dequantrade-ws.dequan.xyz`

For backend integration details, see [docs/trading-api/TRADING_API_INTEGRATION.md](docs/trading-api/TRADING_API_INTEGRATION.md).

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

Copy `.env.example` → `.env`:

```bash
# Required
VITE_SOLANA_RPC_URL=https://auth.dequan.xyz/solana-rpc
VITE_DEQUANW_WS_URL=wss://dequantrade-ws.dequan.xyz

# Account (paid tier upgrades)
VITE_CONTROL_PLANE_URL=https://auth.dequan.xyz

# Auth
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

