# Backend Contract (Control Plane + Trading WS)

This doc states **exactly** what dequanSwap (frontend) requires from the backend to be seamless, secure, and dequanW-parity.

Related:
- [BUILD_PLAN.md](BUILD_PLAN.md)
- [TRADE_LIFECYCLE.md](TRADE_LIFECYCLE.md)

---

## 1) Identity & Security

## 1.1) Tiered identity (Free vs Paid) — one-screen diagram

Goal: match the common UX pattern in modern trading terminals (BullX/PumpSwap-style):

- **Free (Scout)**: user can start with **wallet connect only** (no email/account required).
- **Paid (Sniper/Apex)**: upgrade flow requires an **account (email)** so we can send renewal reminders and manage lifecycle.

Diagram:

```
Browser UI (dequanSwap)
  |
  |  (A) Wallet connect + signMessage
  v
Trading WS (public hostname)
  - walletSig auth binds wallet/session
  - tier enforcement is server-side
  - subscriptions stored server-side (per wallet/user)

Paid upgrade path only:
  |
  |  (B) Account login (email)
  v
Control Plane (auth.dequan.xyz)
  - stores verified email account session
  - mints short-lived account proof token (JWT)
  |
  |  (C) Attach account proof during WS auth
  v
Trading WS
  - requires account proof for subscription purchase
  - stores email for renewal reminders
```

Notes:
- Cloudflare Access interactive login is not a customer account system; do not use it to satisfy the paid-tier sign-in requirement.
- Wallet signature remains the source of truth for execution (non-custodial).

### JWT (required)
Frontend obtains a short-lived JWT from the Control Plane (wallet-signature auth).

Required JWT claims (minimum):
- `sub` (stable user id)
- `wallet` (base58 pubkey)
- `tier` (Scout/Sniper/Apex via canonical ids `free`/`pro`/`elite` or a numeric level)
- `iat`, `exp`
- `jti` (recommended; supports revocation/anti-replay)

Rules:
- Trading WS must validate JWT signature via JWKS.
- Trading WS must enforce tier gates server-side.
- Never trust a client-supplied tier.

### CORS / Origin allowlist
- Control Plane endpoints only allow known origins (e.g. `https://snipe.dequan.xyz`).

---

## 2) Control Plane HTTP Endpoints

Required endpoints:
- `/.well-known/jwks.json` (JWKS)
- `/auth/*` (wallet-challenge flow per existing spec)
- `/solana-rpc` (JSON-RPC proxy with allowlisted methods)
- `/jupiter/*` (proxy that injects `x-api-key` server-side)

Rules:
- `/solana-rpc` must allow required methods for trading flows (send, status, blockhash, simulate as needed).
- Rate limit abusive traffic.

---

## 3) Trading WebSocket Protocol (required messages)

All messages are JSON. Every request includes `requestId`.

### 3.1 Session
- `hello` (client → server): includes JWT
- `hello_ok` (server → client): includes `tierInfo` and limits

### 3.2 Orders (SSOT for trade lifecycle)
- `create_order` (buy/sell intent)
  - request: `{ side, mint, amountSpec, slippageBps, priorityFeeSpec, mode }`
  - response: `{ orderId }`

- `build_swap_tx` (returns unsigned tx for the order)
  - response: `{ orderId, unsignedTxBase64 }`

- `submit_signed_tx`
  - request: `{ orderId, signature, signedTxBase64? }`
  - response: `{ orderId, accepted: true }`

- `order_update` (server → client push)
  - emitted on state transitions: `created → built → submitted → confirmed|failed|timeout`

Rules:
- Server writes positions/history only after confirmed events.
- Confirmation must be event-driven via SolanaTracker wallet rooms when available.

---

## 4) Positions & History (multi-tenant)

### Required APIs
- `get_positions` → holdings
- `get_history` → sold tokens
- `get_monitored` / `set_monitored` (optional but recommended for parity)

### Required push events
- `position_update` (server → client)
  - emitted when a holding is created/updated/closed

---

## 5) Price + Chart Data

Frontend requires a real-time chart for holdings.

Two acceptable backend approaches:

### Option A (recommended): server streams `price_update`
- `subscribe_token` / `unsubscribe_token`
- `price_update`: `{ mint, ts, priceProxy, mc? }`

Source-of-truth for low latency:
- SolanaTracker rooms (`price:aggregated:<mint>`, `transaction:<mint>`) and/or quote-based proxy.

### Option B: server provides a query endpoint
- `get_price_series` for a mint and time window
- Still needs push updates for low-latency UX

The backend must define which "price proxy" is used so growth% is consistent across UI and automation.

---

## 6) Tier Enforcement (must be server-side)

Enforce on backend:
- Live trading limits by tier (Scout vs paid)
- Throughput limits (max watched tokens, update cadence)
- Automation (TP/SL only for allowed tiers)
- Fast Mode availability

---

## 7) Observability / Health

Required:
- `/health` endpoints for Control Plane and Trading WS
- Bounded logs
- Connection metrics: WS disconnect rate, order failure codes, confirmation latency
