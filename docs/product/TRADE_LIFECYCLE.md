# Trade Lifecycle (Public dequanSwap, dequanW Parity)

This document defines **exactly how Buy → Holdings → Sell → Sold** works for public users.

The goal is to keep the app beginner-friendly while still behaving like a real sniper tool:
- show **fast feedback** at submission time
- confirm in the background
- keep state consistent and explainable

---

## Entities (User-Facing)

### 1) Monitored / Watchlist ("Watching")
A list of tokens the user is actively monitoring.

**Target (dequanW parity):** server-side monitored tokens table keyed by the authenticated user.

**Current build:** browser `localStorage` key `dequanswap.watchedTokens` is used as a temporary client cache.

### 2) Holdings ("Holdings")
Open positions.

**Target (dequanW parity):** server-side holdings store keyed by the authenticated user.

**Current build:** browser `localStorage` key `dequanswap.holdings` is used as a temporary client cache.

### 3) Sold Tokens ("History")
Closed positions.

**Target (dequanW parity):** server-side sold history keyed by the authenticated user.

**Current build:** not implemented.

---

## Buy / Snipe Flow (Live)

### UX rules
1. **Signature receipt is immediate feedback**
   - Once we have a transaction signature from `sendRawTransaction`, the UI reports:
     - `Submitted (sig received)`
     - and shows a Solscan link

2. **Confirmation happens asynchronously**
   - The UI does not block the main Snipe panel on confirmation.
   - Confirmation uses Solana WebSocket subscriptions when available (fast path).

3. **Holdings update happens on confirmation**
   - Only after confirmed/finalized do we move the token into Holdings.

### State transitions (dequanW parity)
- User presses **Snipe**
- App builds/signs the swap transaction (Jupiter route build via dequanW Trading API)
- App submits tx (gets signature)
   - UI: shows **Submitted (sig received)**
   - Engine + UI: begin confirmation
- Confirmation source-of-truth: **SolanaTracker wallet room** `wallet:<pubkey>` (event-driven)
- On confirmed:
   - Remove from Monitored
   - Insert/update Holdings
   - Refresh balances

### Storage effects
**Target:** server-side persistence (positions store). The browser may cache for UX.

---

## Holdings (What it means)

Holdings in the public app are **frontend-native state**.

Important constraints:
- No database writes.
- No server state of “positions”.
- If the user clears browser storage or changes devices, their Holdings are lost.

Holdings are still valuable because:
- they mirror the *workflow* from dequanW (monitor → buy → hold)
- they give the user a simple place to sell from

---

## Sell Flow (Live)

Status:
- SELL must be completed to match dequanW’s full buy/sell lifecycle.

Lifecycle rules (dequanW parity):
1. SELL submission returns a signature immediately
2. Confirmation runs in background
3. On confirmed SELL:
   - remove (or reduce) the Holding
   - append to Sold Tokens (History)

---

## Paper Trading Lifecycle

Paper trades are tracked in the in-browser paper ledger (see the paper trading module).

Paper mode is the reference for how Live mode should feel:
- fast UI feedback
- clear “position opened/closed” semantics
- no ambiguous state transitions

---

## Confirmation Source of Truth (Planned)

Current:
- Browser confirms via Solana RPC (WebSocket signature subscriptions when available).

Planned (dequanW parity):
- Use **SolanaTracker WebSocket** room subscriptions, including the **tx confirmation room**, as the confirmation source-of-truth.
- This is ideal for sniping UX because it provides a fast, uniform confirmation signal even when the client uses an HTTP proxy for JSON-RPC.

Before implementing this, we will document:
- exact room name(s) and message schema
- reliability guarantees (confirmed vs finalized)
- fallbacks when SolanaTracker is unavailable
