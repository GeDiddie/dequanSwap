# Roadmap (Complete Backend + Frontend)

This roadmap is the operational companion to the build plan:
- [BUILD_PLAN.md](BUILD_PLAN.md)

The key principle: dequanSwap (public UI) must reach **dequanW parity** for the full cycle:
Monitored → Holdings → Sell → Sold history, with confirmation driven by SolanaTracker wallet rooms.

---

## Phase 0 — Foundation (in place / stabilize)
**Goal:** reliable public auth + safe connectivity.

- Control Plane auth/JWKS is stable
- Trading WS JWT verification is stable
- CORS-safe Solana RPC proxy exists
- Jupiter proxy exists for API key injection

Acceptance:
- Production build + smoke passes
- No secrets in browser
- WS reconnect stable under churn

---

## Phase 1 — Minimalist manual trading (complete the holding experience)
**Goal:** a user can buy, see an accurate holding, track it live, and manually sell.

Frontend:
- Holdings show `buy time`, `buy MC`, `entry price proxy`, `growth since buy`
- Real-time growth chart (sparkline + drawer chart)
- Manual sell buttons 25/50/100 with clear status states

Backend:
- WS protocol additions: orders + position updates + price updates
- Confirmation SSOT via SolanaTracker `wallet:<pubkey>`

Acceptance:
- After confirmed buy, holdings display correct buy timestamp and buy MC
- Chart updates at tier cadence without UI lag
- Manual sell updates holding + sold history on confirm

---

## Phase 2 — Multi-tenant persistence (server becomes SSOT)
**Goal:** positions persist across devices and refresh; browser state becomes cache only.

Backend:
- Postgres positions store (holdings, sold history, monitored tokens)
- Orders table (recommended) to bind signatures and confirmations
- `get_positions` + `get_history` + `get_monitored`

Frontend:
- Replace localStorage SSOT with server fetch + realtime updates
- Reconcile cached local holdings with server holdings on load

Acceptance:
- Refresh page: holdings + history rehydrate from server
- No “phantom holdings” that only exist locally

---

## Phase 3 — Pro (assisted automation)
**Goal:** TP/SL automation with strict guardrails.

Backend:
- Persist per-position TP/SL rules
- Evaluate rules on price stream and trigger sell orders
- Enforce caps: max spend/day, max loss/day, max positions
- Notifications/events to client (rule triggered / order placed / order filled)

Frontend:
- Simple TP/SL sliders for Minimalist (optional micro-automation)
- Pro preset automation UI (enable/disable, caps, rule status)

Acceptance:
- TP/SL triggers produce sells reliably and are recorded in history
- Server-side enforcement prevents over-trading regardless of client UI

---

## Phase 4 — Pro/Elite Add-on: Fast Mode (Speed)
**Goal:** reduce signing friction while keeping bounded risk.

- Implement Fast Mode Option A (client session key arming + revoke + expiry)
- Separate milestone: delegate-authority swap builder OR user-owned bot-wallet mode

Acceptance:
- Arm/revoke flows are safe and visible
- Hard caps are enforced

---

## Phase 5 — Elite (strategy lab / full automation)
**Goal:** full cycle automation with advanced tuning.

Backend:
- Multi-rule strategies
- Auto-buy + auto-sell
- Allowlists/denylists and program/route allowlists
- Export/API/webhooks

Frontend:
- Strategy lab UI surfaces
- Backtesting stub (optional later)

Acceptance:
- Elite strategies can run unattended within hard guardrails
