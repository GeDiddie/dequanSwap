# dequanSwap Build Plan (dequanW Parity)

This is the **single source of truth** for how dequanSwap will be finished.

Core requirement from g1:
- The **entire buy → sell → saved state cycle** must mimic the proven dequanW engine behavior.
- dequanSwap is the public UI; dequanW is the engine.

This plan intentionally references the already-documented dequanW implementation so we don’t reinvent processes.

---

## 0) Authoritative References (dequanW)

Use these before making decisions:

- Wallet/JWT contract: [jul2025/dequanW/docs/public-backend/control-plane-mvp-spec.md](../../jul2025/dequanW/docs/public-backend/control-plane-mvp-spec.md)
- Public backend handoff: [jul2025/dequanW/docs/public-backend/dequanSwap-llm-handoff.md](../../jul2025/dequanW/docs/public-backend/dequanSwap-llm-handoff.md)
- WS API engine overview: [jul2025/dequanW/docs/trading-api/WEBSOCKET_API_IMPLEMENTATION.md](../../jul2025/dequanW/docs/trading-api/WEBSOCKET_API_IMPLEMENTATION.md)
- Confirmation source + SolanaTracker rooms (code):
  - Wallet room subscription: [jul2025/dequanW/dequanBuy/strategies/buyStrategy.js](../../jul2025/dequanW/dequanBuy/strategies/buyStrategy.js)
  - Token tx room subscription: [jul2025/dequanW/dequanBuy/services/fetchTokenData.js](../../jul2025/dequanW/dequanBuy/services/fetchTokenData.js)
  - Room examples: [jul2025/dequanW/test-token-rooms.js](../../jul2025/dequanW/test-token-rooms.js)

---

## 1) Non‑Custodial Execution (public users)

Non-custodial means:
- The engine **never** holds user private keys.
- The engine can **quote + build** transactions.
- The user wallet signs.
- Broadcast can be done by the UI (direct RPC) or the engine (optional).

Already implemented in the stack:
- Control Plane (Cloudflare Worker) mints short-lived JWTs + serves JWKS.
- Trading WS verifies JWT via JWKS.
- UI uses Trading WS to get quote + build swap transaction.

---

## 2) SolanaTracker WebSocket Rooms (dequanW parity)

Room naming used by the engine today (SolanaTracker WS):

- `latest` (new mints / new pools)
- `pool:<poolId>` (pool updates)
- `price:aggregated:<tokenMint>` (aggregated price)
- `transaction:<tokenMint>` (token-level transactions)
- `wallet:<walletPubkey>` (**wallet tx stream; used for buy confirmation**)

The proven low-latency confirmation pattern in dequanW:
- Subscribe to `wallet:<pubkey>`
- When a buy is submitted, track it as pending
- When a matching wallet tx event arrives (`data.type === 'buy'`), treat it as confirmed and finalize the buy lifecycle

Reference implementation:
- [jul2025/dequanW/dequanBuy/strategies/buyStrategy.js](../../jul2025/dequanW/dequanBuy/strategies/buyStrategy.js)

---

## 3) Trade Lifecycle Data Model (dequanW parity)

dequanW engine model:

1) **Monitored Tokens**
- A queue/table of tokens under monitoring ("watching")
- In dequanW: `shared/monitoredDB.js` (sqlite-backed + JSON export)

2) **Holdings**
- A table of open positions
- In dequanW: `shared/holdingsDB.js` (sqlite-backed)
- Key behavior: on confirmed buy → create holding record (includes tx sig + timing + amounts)

3) **Sold Tokens / History**
- A table of closed positions
- In dequanW personal bot: persisted via holdings fields + exported summaries (see dequanSell)
- In dequanW public scaffold: `tradingAPI/positions/positionsStore.js` (Postgres scaffold)

Public dequanSwap must implement the same lifecycle semantics, but **multi-tenant**:
- Every user has their own monitored tokens / holdings / sold history
- User identity is the JWT `sub` (userId) and `wallet` claim

---

## 4) dequanSwap Product Semantics (what users experience)

### 4.1 Buy (Snipe)
1. UI requests quote + builds tx through Trading WS
2. UI signs and submits tx
3. UI immediately shows: **Submitted (sig received)**
4. Confirmation is driven by the engine’s SolanaTracker `wallet:<pubkey>` stream
5. On confirmation event:
   - remove from Monitored
   - insert/update Holdings
   - emit UI update (position update)

### 4.2 Holdings
Holdings are not “just local UI state” in the final design.

- Source-of-truth: engine positions store (multi-tenant)
- UI may cache locally for fast render, but must reconcile against server state.

**Holdings UX requirements (Minimalist and up):**
- Show **buy time** (timestamp) and **buy MC** (market cap at entry).
- Show **entry price proxy** and **current price proxy**.
- Show **Growth % since buy**.
- Show a lightweight **real-time chart** per holding (sparkline in list + full chart in drawer).
- Manual sell buttons: `Sell 25%`, `Sell 50%`, `Sell 100%`.

**Data required to render holdings correctly:**
- `boughtAt` (UTC timestamp)
- `buyTxSignature` (for Solscan link)
- `buyMc` and `buyPrice` (entry snapshot)
- `currentMc` and `currentPrice` (live)
- `amountTokens`, `amountSolSpent` (or quote-based equivalent)
- Chart series points (time, price) at tier-dependent cadence

### 4.3 Sell
1. User initiates SELL from Holdings
2. UI requests a sell transaction build (or order creation) from the engine
3. UI signs + submits
4. UI immediately shows: **Submitted (sig received)**
5. Confirmation again uses `wallet:<pubkey>`
6. On confirmation:
   - reduce/remove holding
   - append Sold history record

### 4.4 Sold Tokens (History)
- Shows realized trades with entry/exit, timestamps, signatures, and outcome classification.

---

## 5) Required Trading WS Protocol Additions (finish the engine contract)

These are already listed in dequanW’s public-backend handoff as next steps.

MVP protocol additions:
- `create_order` (buy or sell intent; returns orderId)
- `submit_signed_tx` (UI sends signature (and optionally signed tx bytes) to bind it to an order)
- `get_positions` (holdings)
- `get_history` (sold tokens)
- `order_update` events (server push)

Additional messages/events required for “holdings with real-time chart”:
- `subscribe_token` / `unsubscribe_token` (server pushes price/tx updates for a mint)
- `price_update` (timestamped price proxy updates)
- `position_update` (when holding fields change: confirmed buy, partial sells, realized PnL, etc.)
- `tier_info` (server-asserted tier + limits so UI renders the correct gating)

Why orders matter:
- They map UI actions → confirmations → persistence.
- They prevent “UI thinks bought” vs “server thinks not bought”.

Reference: [jul2025/dequanW/docs/public-backend/dequanSwap-llm-handoff.md](../../jul2025/dequanW/docs/public-backend/dequanSwap-llm-handoff.md)

---

## 6) Persistence Strategy (public, multi-user)

We must move from browser-local state to server-side persistence to truly mimic dequanW.

Recommended:
- Implement `tradingAPI/positions/positionsStore.js` against Postgres.
- Key by `userId` from JWT (`sub`) and `wallet` claim.
- Tables:
  - `holdings`
  - `sold_tokens`
  - `orders` (optional but strongly recommended)
  - `monitored_tokens` (user watchlist)

Minimum fields required (align to dequanW semantics):
- holdings: `userId`, `wallet`, `mint`, `boughtAt`, `buyTxSignature`, `buyPrice`, `buyMc`, `amountTokens`, `amountSolSpent`, `currentPrice`, `currentMc`, `isSold`, `soldAt`, `sellTxSignature`
- sold_tokens: `userId`, `wallet`, `mint`, `boughtAt`, `soldAt`, `buyPrice`, `sellPrice`, `buyMc`, `sellMc`, `pnlSol`, `pnlPct`, `buyTxSignature`, `sellTxSignature`
- orders: `userId`, `wallet`, `orderId`, `side`, `mint`, `createdAt`, `status`, `submittedSignature`, `confirmedSignature`, `error`

Until that is complete:
- UI may keep a temporary local cache, but it must be labeled as temporary and not the SSOT.

---

## 7) Performance Requirements (sniper-grade UX)

We explicitly separate **submission speed** from **confirmation speed**:

- Submission UX: < 200ms after signature receipt → show “Submitted (sig received)”
- Confirmation: event-driven via SolanaTracker `wallet:<pubkey>`
- Fallback: Solana RPC confirmation if SolanaTracker WS is down

Chart update cadence (recommended):
- Free: 3–5s (limited)
- Minimalist: 1–2s
- Pro/Elite: 250ms–1s, driven by infra capacity

This is how dequanW achieves minimal latency.

---

## 8) Milestones (Definition of Done)

### Milestone A — Engine parity for confirmation
- Trading WS subscribes to SolanaTracker `wallet:<pubkey>` per authenticated user session
- WS emits `tx_confirmed` events to that user
- UI uses those events to update holdings/watchlist state

### Milestone B — Multi-tenant positions (holdings + history)
- Implement `get_positions` + `get_history`
- Persist confirmed buys/sells
- UI renders from server data

### Milestone B2 — Holdings metadata + real-time chart
- Engine provides `buyTime` and `buyMc` snapshot at confirmation time
- Engine streams `price_update` for subscribed holdings
- UI shows sparkline + chart drawer, and buy timestamp + buy MC

### Milestone C — Sell completion
- Live sell path fully implemented (manual sell)
- Partial sell updates holdings amount + history entries

### Milestone C2 — Manual sell UX parity
- Holdings list contains fast sell buttons (25/50/100)
- Sell uses the same submission/confirmation split as buy ("Submitted" immediately; confirmation async)
- On confirm: update holding, append history

### Milestone D — Watchlist/Monitored parity
- UI watchlist writes to `monitored_tokens` (server)
- Engine removes monitored token on buy confirm

### Milestone E — Pro automation (take profit / stop loss)
- Persist per-position automation rules (TP/SL) server-side
- Engine evaluates rules using the same price proxy stream used for charts
- Engine triggers sell orders when rules fire (with tier-capped risk limits)
- UI shows rule state and last-trigger evaluation timestamps

### Milestone F — Elite automation (full cycle)
- Multi-rule strategies, scheduling, and per-strategy allowlists/denylists
- Full automation can create buy orders and manage sell exits
- Strong guardrails: max spend/day, max loss/day, max positions, max slippage, max priority fee

---

## 9) Non-negotiables (stability + security)

- No long-lived secrets in browser
- JWT binding enforces wallet correctness on build requests
- All critical state transitions happen on confirmed events
- Do not accept "client says confirmed" as SSOT

**Backend must enforce paid-tier capabilities:**
- Live trading, automation, throughput limits, and Fast Mode are enforced server-side.
- Client tier selection is only UI; server derives tier from JWT and billing state.
