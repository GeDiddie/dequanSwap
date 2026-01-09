# Subscriptions — implementation plan

## Goals
- Let a user upgrade/downgrade plans (Scout → Sniper → Apex) and manage renewals.
- Accept crypto payments safely, with clear receipts and renewal reminders.
- Tie subscription state to a user identity (wallet + optional email), and gate features reliably.

## Non-goals (for now)
- Copy/paste or reproduce any competitor’s UI/branding.
- Custody user funds/keys.

## User identity model
- **Primary identity:** wallet address (Solana).
- **Optional identity:** verified email (required for paid tiers so we can send renewal reminders).
- **Linking:** `wallet <-> email` mapping must be stored server-side and verified.

## Plans + gates (source of truth)
- Keep **server** as the source of truth for feature gates.
- Client tier is for UX only; backend must enforce access.

### Plan tiers
- **Scout (free):** basic usage + live candles.
- **Sniper (paid):** adds risk/edge signals + higher limits.
- **Apex (paid):** adds Fast Mode + highest limits.

## Payment acceptance (crypto)

### Recommended initial crypto rails
- **SOL** (native on Solana) — simplest, lowest integration surface.
- **USDC (SPL, Solana)** — stable pricing, reduces volatility.

### What to avoid initially
- Multi-chain payment acceptance (Ethereum, Tron, etc.) until the Solana flow is rock-solid.
- Exotic tokens that complicate accounting/refunds.

### Pricing approach
- Keep plan price denominated in **USD**.
- At checkout time:
  - If paying in SOL: quote SOL amount from a trusted price source + apply a small buffer.
  - If paying in USDC: fixed USDC amount.

## Payment flow (on-chain “checkout”)
1. User chooses tier (Sniper/Apex).
2. Backend creates a **payment attempt**:
   - `attemptId`, `tier`, `amount`, `mint` (SOL/USDC), `merchantWallet`, `expiresAt`.
3. Client signs and sends the transaction (transfer + memo/reference).
4. Backend verifies:
   - Signature confirmed/finalized.
   - Correct destination.
   - Correct mint.
   - Amount >= expected.
   - Memo/reference matches `attemptId`.
5. Backend activates subscription and returns updated status.

## Renewals / overdue
- Subscriptions have:
  - `active`, `currentPeriodStart`, `currentPeriodEnd`, `overdue`, `needsRenewalSoon`.
- Client UX:
  - “Renew soon” warning within N days.
  - “Renew overdue” warning after end.

## Data model (initial)

### Tables
- `users`
  - `id`, `createdAt`
- `wallets`
  - `walletAddress` (PK), `userId` (FK), `createdAt`, `lastSeenAt`
- `emails`
  - `email` (PK), `userId` (FK), `verifiedAt`
- `subscriptions`
  - `userId` (FK), `tier`, `status`, `currentPeriodEnd`, `createdAt`, `updatedAt`
- `payment_attempts`
  - `attemptId` (PK), `userId`, `tier`, `mint`, `amount`, `merchantWallet`, `expiresAt`, `status`
- `payments`
  - `signature` (PK), `attemptId`, `userId`, `mint`, `amount`, `confirmedAt`

## App work items
- UI
  - Fix/verify “Upgrade Plan” and Subscribe buttons.
  - Subscription page: show current plan, renewal date, payment history, renew CTA.
- Backend (Trading WS / control-plane)
  - `get_subscription_status`
  - `build_subscription_tx`
  - `submit_subscription_payment`
  - Webhook/worker to confirm payments + activate subscriptions.

## Competitive research notes (BullX / pump.fun)
- Goal: identify high-level patterns (not copy assets).
- What to capture:
  - What currencies/rails they accept.
  - Whether they use on-chain transfers vs. third-party processors.
  - How they identify a payment (memo/reference, unique address per user, unique amount, etc.).
  - How they handle confirmations, failures, and retries.

## Security checklist
- Never trust client tier.
- Idempotency for payment submissions.
- Strict validation of payment tx (mint/destination/amount/reference).
- Rate-limit checkout creation.
- Prevent replay of a signature to activate multiple times.
