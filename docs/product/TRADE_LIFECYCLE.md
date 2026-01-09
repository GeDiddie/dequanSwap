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

**Current build:** browser `localStorage` key `dequanswap.holdings.{walletAddress}` is used as a temporary client cache.

### 3) Sold Tokens ("History")
Closed positions.

**Target (dequanW parity):** server-side sold history keyed by the authenticated user.

**Current build:** browser `localStorage` key `dequanswap.soldTokens.{walletAddress}` is used as a temporary client cache.

---

## Buy / Snipe Flow (Live)

### UX rules
1. **Signature receipt is immediate feedback**
   - Once we have a transaction signature from `sendRawTransaction`, the UI reports:
     - `Submitted (sig received)`
     - and shows a Solscan link
    - Important: a signature is **not** proof the transaction landed on-chain.
       - If the signature never appears in `getSignatureStatuses`, we treat it as **dropped / not broadcast**.

2. **Confirmation happens asynchronously**
   - The UI does not block the main Snipe panel on confirmation.
    - Confirmation uses Solana WebSocket subscriptions when available (fast path), but is always **bounded** by timeouts.
    - If confirmation takes too long:
       - **timeout** = signature exists but did not reach confirmed/finalized in the allotted time
       - **not_found** = signature never appeared on chain (likely dropped)

3. **Holdings update happens on confirmation**
   - Only after confirmed/finalized do we move the token into Holdings.

### State transitions (dequanW parity)
- User presses **Snipe**
- App builds/signs the swap transaction (Jupiter route build via dequanW Trading API)
- App submits tx (gets signature)
   - UI: shows **Submitted (sig received)**
   - Engine + UI: begin confirmation (bounded)
- Confirmation source-of-truth: **SolanaTracker wallet room** `wallet:<pubkey>` (event-driven)
- On confirmed:
   - Remove from Monitored
   - Insert/update Holdings
   - Refresh balances

### Failure modes (what users will see)
- **Signature not found on chain**: the tx was likely dropped (RPC didn’t broadcast, blockhash expired, or network congestion).
  - UX: user can safely retry.
- **Timeout**: tx may still confirm later.
  - UX: show “Still confirming — check explorer” and avoid double-buying blindly.

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

Lifecycle rules (dequanW parity):
1. SELL submission returns a signature immediately
2. Confirmation runs in background
3. On confirmed SELL:
   - append to Sold Tokens (History)
   - update Holdings

### Current UX (public dequanSwap)

Beginner-friendly rule: **Sell is a first-class workflow** (not a silent background action).

1) In **Holdings**, pressing **Sell** flips the right-hand **Snipe** card to a **Sell** back-side.
   - The Sell form is pre-filled with the selected holding’s mint.
   - The UI uses a two-button **Snipe/Sell rocker switch** on both sides of the flip card:
     - active side is neon-lit (green for Snipe, red for Sell)
     - inactive side is grey-but-readable
     - clicking the inactive side flips the card (Snipe ⇄ Sell)

2) The Sell view supports quick percent buttons (25/50/100).
   - Note: Holdings are tracked by mint only (no size/amount), so partial sells are best-effort UX.
   - Current behavior:
     - 100% sell: remove the mint from Holdings
     - partial sell (<100%): keep the mint in Holdings

3) On confirmed sell:
   - append a `SoldToken` entry with `{ mint, soldAt, pct, signature, buyMc?, sellMc? }`
   - refresh balances

Implementation notes:
- The rocker switch styling is in `src/App.css` under `/* Popout Snipe/Sell rocker switch */`.
- The rocker switch markup is rendered on both card faces in `src/App.tsx`.

### Storage effects (current)
- Holdings: `dequanswap.holdings.{walletAddress}`
- Sold Tokens: `dequanswap.soldTokens.{walletAddress}`

Both are:
- per-wallet (switching wallets changes the view)
- per-browser/per-device (clearing storage clears history)

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
