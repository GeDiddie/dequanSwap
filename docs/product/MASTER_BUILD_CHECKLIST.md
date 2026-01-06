# Master Build Checklist (Dequan)

This is the always-on checklist we use to prevent losing track of MVP vs later work. We should review this anytime we touch core trading, wallet flows, or deployment.

---

## A) Every Change (no exceptions)
- [ ] `npm run build` passes.
- [ ] UI smoke: load https://snipe.dequan.xyz, confirm feed renders, confirm WS status changes.
- [ ] Trading smoke (live): small buy → confirm signature receipt → confirm holdings update → small sell.
- [ ] Live trading safety: ensure live trading remains gated by tier and explicit user choice.
- [ ] Tiered auth E2E: confirm **Free = wallet-only** and **Paid = account-required** (see [Tiered Auth E2E Checklist](../../../jul2025/dequanW/docs/public-backend/TIERED_AUTH_E2E_CHECKLIST.md)).
- [ ] For any new user-facing feature: add a tiny `?` help icon that plays a short explainer video on hover (or click on mobile).
- [ ] No secrets shipped to browser (verify env var usage).
- [ ] Cloudflare Pages deploy successful.

---

## B) Release Checklist (production push)
- [ ] Decide deployment target (record it here so we stop re-asking):
  - [ ] **Phase 0 (zero-cost validation)**: run Trading WS from a home PC behind **Cloudflare Tunnel** (good for proving demand, not long-term reliable).
  - [ ] **Phase 1 (real production)**: move Trading WS to a 24/7 host (VPS / cloud instance) with proper TLS + monitoring.
- [ ] Confirm correct Pages project name: `dequanswap`.
- [ ] If running Trading WS from home (Phase 0), set up Cloudflare Tunnel:
  - [ ] Cloudflare Tunnel routes `wss://<trading-ws-host>` → local `http://127.0.0.1:8900` (WebSocket upgrade must work).
  - [ ] Confirm public health: `https://<trading-ws-host>/healthz`.
  - [ ] Update UI env: `VITE_DEQUANW_WS_URL=wss://<trading-ws-host>` and redeploy Pages.
- [ ] If running Trading WS on a server (Phase 1), confirm reverse proxy + backend health:
  - [ ] Public health: `https://<trading-ws-host>/healthz`.
  - [ ] Backend bind is localhost only (`TRADING_API_HOST=127.0.0.1`), reachable via nginx.
- [ ] Confirm CORS/origins allow `https://snipe.dequan.xyz`.
- [ ] Confirm no breaking API changes for the worker/proxy.

---

## C) MVP Scope (must-have)
### Core
- [ ] Stable feed + WS connection with backpressure protections.
- [ ] Minimalist view remains fast and readable under load.
- [ ] Live trading via Phantom signing (explicit per trade).

### Holdings Experience (Minimalist live)
- [ ] On confirmed buy, holdings show **buy time** and **buy MC** (not just mint).
- [ ] Holdings show entry price proxy + growth since buy.
- [ ] Holdings include a real-time chart (sparkline + detail drawer).
- [ ] Manual sell buttons 25/50/100 exist and are readable under load.

### Backend Contract (must-have)
- [ ] Trading WS implements orders: `create_order`, `submit_signed_tx`, `order_update`.
- [ ] Trading WS implements `get_positions` and `get_history` (even if empty in early MVP).
- [ ] Confirmation SSOT uses SolanaTracker `wallet:<pubkey>` (dequanW parity).
- [ ] Tier enforcement is server-side for: live trading, automation, throughput, Fast Mode.

### UI/UX
- [ ] Legibility palette + hierarchy maintained.
- [ ] Critical signals remain attention-grabbing but not blinding.
- [ ] Tiered UX: Free shows Live Feed max 10 tokens + Watching max 3; attempts to exceed show upgrade prompt for real live 1s candle chart.
- [ ] Update subscription/tier page descriptions to mention: Free limits + "real live 1s candle chart" as a paid feature.
- [ ] Implement real live 1-second candle chart in Watching + Holdings popout chart (replace current ~5s sparkline proxy).
- [ ] Popout chart: add direct Snipe button (and later Apex one-tap automation).

---

## D) Pro/Elite Roadmap (scheduled after MVP)
### Fast Mode (Hybrid)
- [ ] Tier gate `allowFastMode` (Pro/Elite only).
- [ ] Option A: client-only session key arming + revoke.
- [ ] Delegate-authority swap builder (required for true “no-popup” swaps using WSOL delegation).
- [ ] Apex automation: pressing Snipe skips the Snipe form and goes straight to wallet signature; if custodial wallet is enabled, buy happens immediately.
- [ ] Per-trade guardrails: max notional, max slippage, max priority fee.
- [ ] Allowlist swap programs/routes (reduce malicious route risk).
- [ ] Allowance remaining meter.

### Performance
- [ ] Chunk/code-split to reduce initial JS bundle.
- [ ] Reduce long-lived arrays/state growth.
- [ ] Animation budget checks (avoid layout thrash).

### Explainer Microvideos (Feature Shorts)
- [ ] Video production checkpoint (continue from here):
  - [ ] Next video to produce: `live-feed-explainer.mp4` (script + style spec live in `docs/product/FEATURE_SHORTS.md`)
  - [ ] When uploaded (YouTube unlisted or Cloudflare), record the final URL mapping so the app can resolve the ID via `VITE_HELP_VIDEO_BASE_URL`
  - [ ] After each video: mark it “Done” in `docs/product/FEATURE_SHORTS.md` and add/update its hosted link target
- [ ] Add help icons to the most “not obvious” advantages:
  - [ ] JWT wallet-binding (why it matters)
  - [ ] No-secrets-in-browser (why it matters)
  - [ ] Debug Portal health metrics (how to use it)
- [ ] Add an in-app “Help Library” panel:
  - [ ] Lists all Feature Shorts
  - [ ] Search/filter
  - [ ] Opens video links using `VITE_HELP_VIDEO_BASE_URL`

---

## E) Security Checklist (whenever wallet/trading changes)
- [ ] Threat model updated (what can be drained, by whom, and max loss).
- [ ] Fast Mode caps are conservative by default.
- [ ] Revoke action is always visible when armed.
- [ ] No server ever receives private keys (unless explicitly in a future encrypted-escrow design).
- [ ] Rate limit requests to any trade builder endpoints.
- [ ] JWT claims required and verified: `sub`, `wallet`, `tier`, `exp` (no client-only tier).
- [ ] WS subscriptions are scoped per user (no cross-tenant room leaks).
- [ ] Orders/positions are written only on confirmed events (not client assertions).

---

## F) Observability
- [ ] Backend logs are bounded (no unbounded arrays).
- [ ] WS reconnection logic doesn’t leak listeners.
- [ ] Health endpoints stable.
- [ ] Optional: client telemetry for WS disconnect rates and feed latency.
