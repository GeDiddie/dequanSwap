# Integration Continuation (Handoff to dequanW LLM)

This doc is meant to be handed to the **dequanW project LLM** so it can implement the missing backend pieces required for dequanSwap parity.

Primary references:
- [BUILD_PLAN.md](BUILD_PLAN.md)
- [BACKEND_CONTRACT.md](BACKEND_CONTRACT.md)
- dequanW WS API overview: [jul2025/dequanW/docs/trading-api/WEBSOCKET_API_IMPLEMENTATION.md](../../../jul2025/dequanW/docs/trading-api/WEBSOCKET_API_IMPLEMENTATION.md)

---

## 1) Current State (what already works)

- Public auth model exists (Control Plane): wallet signature → short-lived JWT → JWKS.
- dequanSwap frontend connects to Trading WS using JWT.
- dequanSwap already uses Trading WS for `quote` and `build_swap_tx`.
- Frontend confirmation currently uses Solana web3.js with real WS endpoint configured.
- Frontend has a Debug Portal with metrics + an event timeline + Feature Shorts help `?` icons.

---

## 2) Goal (dequanW parity)

Make the public UI’s lifecycle match the dequanW engine:

Monitored → Holdings → Sell → Sold history

Key principle:
- **Server is source-of-truth** for orders/positions.
- **Confirmation SSOT** should be event-driven from SolanaTracker `wallet:<pubkey>` where possible.

---

## 3) Required Backend Deliverables

### A) Trading WebSocket: Orders + State Machine
Implement a minimal order state machine so UI actions can be bound to confirmation + persistence.

Required messages/events (names can vary, but semantics must match):

1) `create_order`
- Request: `{ requestId, type: 'create_order', side: 'buy'|'sell', mint, amountSpec, slippageBps, priorityFeeSpec, mode }`
- Response: `{ requestId, type: 'create_order_result', ok: true, orderId }`

2) `build_swap_tx`
- Input may be an `orderId` or (legacy) quote payload.
- Response: `{ type: 'build_swap_tx_result', ok: true, orderId, unsignedTxBase64, recentBlockhash?, lastValidBlockHeight? }`

3) `submit_signed_tx`
- Request: `{ requestId, type: 'submit_signed_tx', orderId, signature, signedTxBase64? }`
- Response: `{ requestId, type: 'submit_signed_tx_result', ok: true }`

4) `order_update` (push)
- Emitted on: `created → built → submitted → confirmed|failed|timeout`
- Must include: `{ orderId, status, signature?, errorCode?, errorMessage?, ts }`

Backend rules:
- Do not write holdings/history on `submit_signed_tx` alone.
- Write holdings/history only after **confirmed**.

### B) Confirmation via SolanaTracker Wallet Rooms
- When a WS client authenticates with a wallet pubkey, the backend should subscribe to SolanaTracker room: `wallet:<pubkey>`.
- Use wallet-room events to confirm the order (dequanW pattern).
- Emit `order_update` (confirmed) and `position_update`.

If SolanaTracker is down, fallback is acceptable:
- Confirm via Solana RPC status polling (bounded attempts), but wallet-room should be primary.

### C) Multi-tenant Persistence (Positions SSOT)
Implement a storage layer keyed by:
- `userId` (JWT `sub`)
- `wallet` (JWT `wallet`)

Minimum tables/collections:
- `holdings`
- `sold_tokens`
- `orders` (strongly recommended)
- `monitored_tokens` (optional now, but required for parity)

Required APIs:
- `get_positions` → holdings list
- `get_history` → sold list

Required push event:
- `position_update` (server → client)

### D) Tier Enforcement (server-side)
Backend must enforce:
- Live trading eligibility (Free cannot)
- Automation (TP/SL only on allowed tiers)
- Throughput limits (max watched tokens, update cadence, subscription caps)
- Fast Mode availability (when backend is involved)

The UI tier selector is not security.

### E) Price Streaming (Charts + Automation)
To support holdings real-time charts and TP/SL:
- Provide a canonical **price proxy** definition and stream.

Minimal:
- `subscribe_token` / `unsubscribe_token`
- `price_update`: `{ mint, ts, priceProxy, mc? }`

Data sources:
- SolanaTracker rooms (`price:aggregated:<mint>`, `transaction:<mint>`) and/or executable quote proxy.

Use the same price proxy stream for:
- UI charts
- growth%
- TP/SL evaluation

---

## 4) Security Requirements (non-negotiables)

- Validate JWT via JWKS; require claims: `sub`, `wallet`, `tier`, `exp`.
- Scope all WS subscriptions per user; never leak cross-tenant data.
- Rate limit:
  - per user
  - per IP
  - per wallet
- Treat client signatures as untrusted until confirmed.

---

## 5) Observability Requirements

Add cheap but high-value metrics/logging:
- Confirmation latency (submitted→confirmed)
- Order failure codes (rate_limited_user, unauthorized, rpc_error, no_route, etc.)
- WS disconnect reasons
- SolanaTracker subscription health (connected, rooms joined, last message)

---

## 6) Frontend Expectations (so backend matches UI)

The dequanSwap UI already:
- shows “Submitted (sig received)” immediately
- confirms asynchronously
- needs server events to become SSOT later

The backend should aim to provide:
- deterministic, structured error codes
- explicit state transitions (order_update)

---

## 7) Acceptance Criteria (integration complete)

- A confirmed buy results in:
  - `order_update: confirmed`
  - `position_update` creating/updating a holding
  - `get_positions` returns that holding after refresh
- A confirmed sell results in:
  - holding reduced/closed
  - sold history appended
  - `get_history` returns the sold item
- No position changes occur without a confirmed event.

---

## 8) Where to Look in dequanW (implementation hints)

- SolanaTracker room join model:
  - [jul2025/dequanW/dequanBuy/utils/WebSocketService.js](../../../jul2025/dequanW/dequanBuy/utils/WebSocketService.js)
- Wallet-room buy confirmation logic:
  - [jul2025/dequanW/dequanBuy/strategies/buyStrategy.js](../../../jul2025/dequanW/dequanBuy/strategies/buyStrategy.js)
- Token tx room subscriptions:
  - [jul2025/dequanW/dequanBuy/services/fetchTokenData.js](../../../jul2025/dequanW/dequanBuy/services/fetchTokenData.js)

---

## 9) Tailored to `jul2025/dequanW/tradingAPI/server.js` (exact insertion points)

This section maps the required backend deliverables to the actual Trading API server layout.

### A) WS message dispatch: where to add new message types

File: [jul2025/dequanW/tradingAPI/server.js](../../../jul2025/dequanW/tradingAPI/server.js)

The WS request handling is a single `ws.on('message', async (data) => { ... })` chain with:

- global per-IP rate limit check
- JSON parse + `type` extraction
- `auth` and `ping`
- per-user rate limiting for JWT sessions (`state.session?.userId`)
- `quote` handler
- `build_swap_tx` handler
- final fallback: `Unknown message type`

Insert new message type handlers **after** the per-user rate limiting block and **before** the final `Unknown message type` error.

Recommended ordering inside the existing chain:

1) `create_order` (new)
2) `build_swap_tx` (already exists; extend to optionally accept `orderId`)
3) `submit_signed_tx` (new)
4) `get_positions` (new)
5) `get_history` (new)

Rationale:
- keeps all “trade lifecycle” messages behind both IP and per-user rate limiting
- keeps current `quote` and `build_swap_tx` API backward-compatible for the existing dequanSwap UI

### B) Session model: require JWT session for multi-tenant features

Today, `server.js` can be “authed” via legacy apiKey/token without a `state.session` (multi-tenant session is only established by JWT).

For new multi-tenant stateful features (`create_order`, `submit_signed_tx`, `get_positions`, `get_history`, subscriptions), require **JWT session presence**:

- Add a helper near `requireAuthed(state)`:
  - `requireSession(state)` that throws `Unauthorized` unless `state.session?.userId && state.session?.wallet`

Then call `requireAuthed(state)` + `requireSession(state)` at the start of the new handlers.

### C) Module ownership: what goes in which folder

This is already scaffolded but not wired:

- Orders state machine + persistence:
  - [jul2025/dequanW/tradingAPI/orders/orderStateMachine.js](../../../jul2025/dequanW/tradingAPI/orders/orderStateMachine.js)
  - [jul2025/dequanW/tradingAPI/orders/orderStore.js](../../../jul2025/dequanW/tradingAPI/orders/orderStore.js)

- Positions persistence (holdings + sold history):
  - [jul2025/dequanW/tradingAPI/positions/positionsStore.js](../../../jul2025/dequanW/tradingAPI/positions/positionsStore.js)

- Tier policy enforcement (server-side clamps / deny list):
  - [jul2025/dequanW/tradingAPI/policy/tiers.js](../../../jul2025/dequanW/tradingAPI/policy/tiers.js)

- Solana broadcast + confirm (fallback path):
  - [jul2025/dequanW/tradingAPI/solana/txBroadcast.js](../../../jul2025/dequanW/tradingAPI/solana/txBroadcast.js)
  - [jul2025/dequanW/tradingAPI/solana/confirm.js](../../../jul2025/dequanW/tradingAPI/solana/confirm.js)

Add the missing business logic as:

- `orders/*`: idempotent create, status transitions, store `signature`, store `txBase64` if needed
- `positions/*`: upsert holding on confirmed buy; insert sold record + reduce/close holding on confirmed sell
- `policy/*`: implement `enforce(type, params, session)` and call it from `server.js` for every stateful message
- `solana/*`: implement RPC broadcast/confirm fallbacks only (SolanaTracker wallet-room is the primary SSOT)

### D) `create_order`: implementation sketch in server.js

Add a `create_order` handler that:

- calls `requireAuthed(state)` and `requireSession(state)`
- calls `enforce('create_order', msg.params, state.session)` (and denies if `ok:false`)
- validates `side`, `mint`, and an idempotency key (recommended field name: `idempotencyKey`)
- uses the order store:
  - `orderStore.createOrGetByIdempotency({ userId, wallet, side, mint, idempotencyKey, params })`
- emits:
  - `create_order_result` (reply)
  - `order_update` with status `CREATED` (push)

### E) `build_swap_tx`: extend existing handler for `orderId`

The existing `build_swap_tx` handler already:

- enforces that `userPubkey` matches `state.session.wallet`
- takes `quote.serializedQuote`
- returns `transactionBase64`

Extend it to support the order flow:

- allow request shape: `{ type:'build_swap_tx', params:{ orderId, userPubkey, ... } }`
- if `orderId` present:
  - load order
  - ensure it belongs to `state.session.userId`
  - use stored order params to (re)compute quote or use a cached quote reference
  - after building, persist `TX_BUILT` and store `recentBlockhash/lastValidBlockHeight` if present
  - push `order_update: TX_BUILT`

Keep the current “legacy quote path” so the UI continues to work during migration.

### F) `submit_signed_tx`: signature capture + confirmation SSOT

Add a `submit_signed_tx` handler that:

- requires session
- validates `{ orderId, signature }` (and optionally `signedTxBase64`)
- persists `SUBMITTED` with signature and timestamps
- immediately returns `submit_signed_tx_result` (reply)
- pushes `order_update: SUBMITTED`

Then confirmation happens asynchronously:

Primary path (required):
- subscribe to SolanaTracker wallet room `wallet:<state.session.wallet>` on auth success
- when a wallet-room event indicates the submitted signature is confirmed:
  - transition to `CONFIRMED`
  - push `order_update: CONFIRMED`
  - write positions (holding or sold) and push `position_update`

Fallback (acceptable when SolanaTracker unavailable):
- implement [jul2025/dequanW/tradingAPI/solana/confirm.js](../../../jul2025/dequanW/tradingAPI/solana/confirm.js) and call it with bounded retry/timeouts

### G) `get_positions` / `get_history`: hydrate UI from SSOT

Add request/response handlers:

- `get_positions` → reply with holdings list for `state.session.userId`
- `get_history` → reply with sold list for `state.session.userId`

Wire them to [jul2025/dequanW/tradingAPI/positions/positionsStore.js](../../../jul2025/dequanW/tradingAPI/positions/positionsStore.js).

### H) SolanaTracker wallet-room wiring: where it attaches

The Trading API currently does not include a SolanaTracker WS client module.

Minimum requirement for parity:
- add a small WS client module under `tradingAPI/` (recommended new folder: `solanatracker/`)
- on successful JWT auth in `server.js`, join `wallet:<wallet>` and keep it joined until WS close
- route wallet-room events back into the order state machine

You can lift the room join/leave mechanics from:
- [jul2025/dequanW/dequanBuy/utils/WebSocketService.js](../../../jul2025/dequanW/dequanBuy/utils/WebSocketService.js)

Note: for public multi-tenant, ensure the SolanaTracker connection is shared (or pooled) and room subscriptions are per-wallet.

---

## 10) Notes / Open Decisions

- Whether the backend should broadcast user txs itself (optional) vs UI broadcasts:
  - Current UI broadcasts via Solana RPC (non-custodial).
  - Backend broadcast could improve consistency but increases infra costs and complexity.

- Positions store choice:
  - Prefer Postgres for public multi-tenant (per existing scaffold references).

- “Monitored tokens” SSOT:
  - UI currently keeps watchlist in localStorage; backend SSOT is required for true parity.
