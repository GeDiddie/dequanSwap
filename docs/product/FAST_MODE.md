# Fast Mode (Hybrid System) — Spec

## Purpose
Dequan’s default model is self-custody with explicit user signing (Phantom connect → every trade requires a wallet signature). This is secure and composable, but it introduces latency and cognitive load during high-velocity trading.

**Fast Mode** is an optional, paid-tier feature designed to reduce per-trade signing friction while preserving self-custody and strong blast-radius limits.

Fast Mode is intentionally **opt-in**, **time-bounded**, and **funds-capped**.

---

## Terminology
- **Main Wallet**: the user’s Phantom-connected wallet (owner of funds).
- **Session Key**: an ephemeral keypair created by the app to enable rapid signing without Phantom popups.
- **WSOL**: wrapped SOL SPL token (`NATIVE_MINT`), used so we can apply SPL Token allowance/delegation primitives.
- **Delegate Allowance**: SPL Token’s mechanism to let a delegate spend up to an approved amount from a token account.
- **Arming**: the 1-time Phantom signature that enables Fast Mode.
- **Executor**: the component/process that uses the session key to sign and submit swap transactions.

---

## Product/Tier Positioning
Recommended gating:
- Free / Minimalist: Fast Mode disabled.
- Pro / Elite: Fast Mode enabled.

Why: speed and automation are most valuable for users who will pay for reduced latency and advanced controls.

---

## Security Philosophy
Fast Mode is built around **containment**, not blind trust:
- Dequan does **not** custody the user’s main wallet keys.
- The session key has **limited authority** (allowance) and **limited lifespan**.
- If compromised, the maximum loss is **bounded** to the configured cap.

Fast Mode must always provide:
- A visible **armed indicator** (timer + remaining cap).
- A **revoke** control that immediately removes authority.
- Clear UX warnings that Fast Mode increases speed **and** risk.

---

## Option A (MVP) — Client-only Session Key (Recommended First Build)
### What it is
- The session keypair is generated in the browser.
- The private key is stored **only in memory** (Option A baseline).
- Dequan backend never receives the session private key.

### What it enables
- “1 signature to arm → many fast swaps” (once the executor supports delegate-authority swaps).
- Reduced latency: only the arming transaction uses Phantom.

### What it does NOT (initially) solve
- Cross-device continuity.
- Persistence across refresh (unless we add encrypted storage later).

---

## On-chain Mechanics (WSOL + Delegate Allowance)
Fast Mode uses SPL Token delegation on the user’s **WSOL associated token account**.

### Why WSOL
SOL itself is native lamports; SPL Token delegation applies to SPL token accounts. To have a capped spend allowance with delegate authority, we:
1) create the WSOL token account (ATA)
2) wrap a user-selected amount of SOL into WSOL
3) approve a delegate to spend up to that WSOL amount

### Arming Transaction (single Phantom signature)
A single transaction constructed by the frontend should:
1) Ensure the user’s WSOL ATA exists (create if missing)
2) Transfer `capLamports` from the user to the WSOL ATA
3) `SyncNative` on the WSOL ATA (so it reflects lamports balance)
4) `Approve` delegate = session key, amount = `capLamports`

Result:
- Session key can authorize token transfers from the WSOL ATA **up to capLamports**.

### Revocation
Two supported actions:
- `Revoke` delegate on the WSOL ATA (preferred)
- or `Approve` with amount `0` (fallback)

### Expiration
Because delegate approval is on-chain and doesn’t expire automatically:
- The app must implement a **soft expiry** (UI + executor stop)
- and encourage/trigger **automatic revoke** at expiry

---

## Executor Model (How swaps will be signed)
### Goal
Have swaps signed by the session key without Phantom popups.

### Important implementation detail
Most aggregators (including many Jupiter integration patterns) assume the swap authority is the token account **owner**.

For delegate-based Fast Mode to work, the swap transaction must be built such that the **authority/signing account for WSOL transfers is the delegate** (session key), not the owner.

That implies one of:
1) **Custom swap builder** that constructs SPL Token transfer instructions using the delegate as authority.
2) A backend path that can build a swap transaction specifically for **delegate authority**.
3) A Jupiter-compatible method (if available) to specify authority separate from owner.

MVP scope for Option A implementation:
- Implement arming/revoke + session key lifecycle.
- Wire up interfaces for an executor, but keep swaps on the existing owner-sign flow until the delegate-authority swap builder is implemented.

---

## UX Requirements
### Fast Mode Panel
- Status: `DISARMED` / `ARMED`
- Remaining time: e.g. 30 minutes
- Cap: e.g. 2.0 SOL
- Remaining allowance (future): show spend remaining from WSOL ATA delegate allowance
- Actions:
  - Enable Fast Mode (arms)
  - Revoke Fast Mode (on-chain revoke)

### Warnings
- “Fast Mode increases speed and risk; cap limits loss.”
- “If you refresh, Fast Mode session key will be lost (Option A). Revoke if unsure.”

---

## Threat Model (Practical)
### What Fast Mode protects against
- Server compromise draining user main wallet (session key is client-only).
- Unbounded loss if session key leaks (cap limits authority).

### What Fast Mode increases exposure to
- Client compromise (malware/XSS) could use the in-memory session key to trade within the cap.
- User error: arming with too high a cap.

### Mitigations
- Small default caps and clear UI.
- Short default expiry.
- Easy revoke.
- Strict program/route allowlists (future).

---

## Future Options (Later Phases)
### Option B — Encrypted Key Escrow (Cross-device)
- Store encrypted session key ciphertext server-side.
- Decrypt only client-side via passphrase / device key.

### Option C — MPC / co-signing
- Maximum continuity and risk controls, maximum complexity.

### Alternate Hybrid — User-owned Bot Wallet
- Generate a separate wallet (still self-custody) and fund it.
- Simplifies swap building because the session key is the **owner**.
- Different risk/UX tradeoffs; can be offered as an alternative mode.

---

## Implementation Checklist (Option A)
- [ ] Add tier gate: `allowFastMode` enabled for Pro/Elite.
- [ ] Generate session keypair client-side.
- [ ] Build and submit arming transaction:
  - [ ] Ensure WSOL ATA
  - [ ] Wrap SOL into WSOL
  - [ ] Approve delegate
- [ ] Add UI status + revoke flow.
- [ ] Add soft expiry timer + prompt to revoke.
- [ ] Add logs/telemetry hooks (optional).

---

## Non-goals (MVP)
- Delegate-authority swap builder (will be separate milestone).
- Persistent session across reload.
- Full accounting of allowance remaining (nice-to-have).
