# dequanSwap (MVP)

Minimal public-facing swap/snipe UI that uses dequanW's Trading WebSocket API.

## What this MVP does

- Non-custodial: users connect Phantom and sign swaps with their own wallet.
- SOL ↔ Token only (buy SOL→Token, sell Token→SOL).
- Uses Trading API messages: `quote` → `build_swap_tx` → wallet signs → UI submits to Solana RPC.

## Prereqs

- Node.js (this repo currently works with Node 22.4.1)
- Phantom installed
- A running Trading API server compatible with the docs in `jul2025/dequanW/docs/trading-api`

## Configure

Copy `.env.example` → `.env` and set:

- `VITE_SOLANA_RPC_URL`
- `VITE_DEQUANW_WS_URL`

Auth options:

- For local/dev you can use `VITE_DEQUANW_API_KEY`.
- For public hosting, do NOT ship a long-lived secret to the browser; use short-lived tokens (future: Cloudflare Worker auth) and set `VITE_DEQUANW_AUTH_TOKEN`.

## Run

```bash
npm install
npm run dev
```

## Important API requirement

The Trading API must include `route.serializedQuote` inside `quote_result`, because this UI passes that value back into `build_swap_tx`.

## Roadmap note (tiered features)

MVP is intentionally minimal. dequanW advanced features (risk controls, strategies, premium execution features) can be gated later behind a tiered plan.
