# Identity + Billing Plan (Free wallet-only + Paid account)

This document defines how dequanSwap should support:

- **Free tier users**: no email/account required; they can simply **connect a wallet**.
- **Paid tier users**: must have an **account** (email) created during the payment/upgrade flow so we can manage subscriptions and send renewal reminders.

This matches the common pattern used by popular trading UIs (e.g. BullX / PumpSwap-style experiences): **wallet-first** for public usage, **account-based** for subscription, multi-device access, and lifecycle comms.

---

## Core principles

1. **Wallet controls execution.**
   - The wallet signature is the source of truth for “who can trade”.
   - The backend never receives private keys.

2. **Account controls billing + lifecycle.**
   - Email/account exists to: manage subscription, send renewal reminders, provide customer portal access, and support multi-device.

3. **Tier enforcement is server-side.**
   - UI gating is UX only; Trading API must enforce tier/limits.

4. **Keep free onboarding frictionless.**
   - No forced email prompts.
   - No Cloudflare Access interactive login for the free trading hostname.

---

## Data model (recommended)

Minimum entities:

- **User**
  - `id`
  - `email` (nullable for wallet-only users)
  - `emailVerifiedAt` (nullable)
  - `createdAt`

- **Wallet**
  - `pubkey` (unique)
  - `userId` (nullable until linked)
  - `createdAt`

- **Subscription**
  - `userId`
  - `provider` (`stripe`)
  - `status` (`active|trialing|past_due|canceled|incomplete`)
  - `plan` (`scout|sniper|apex`)
  - `currentPeriodEnd`
  - `providerCustomerId`, `providerSubscriptionId`

- **EffectiveTier** (derived, not stored)
  - Resolve tier at request time based on subscription state + any promotional/trial flags.

---

## Authentication model (two layers)

### Layer A: Wallet authentication (required for trading)

- **Challenge/response signature**:
  1. Client asks for a nonce.
  2. Server returns a challenge.
  3. Client signs with Phantom.
  4. Server verifies and creates a session.

Outcome:
- Free users are now authenticated as a wallet owner, without email.

### Layer B: Account authentication (required for paid features)

- Account login can be **passwordless (magic link)** or password-based.
- Use secure, httpOnly session cookies.
- Paid features require:
  - authenticated account session AND
  - active subscription AND
  - wallet is linked to that user (or linked on first use).

---

## Flows (end-to-end)

### 1) Free user flow (no sign-in)

1. User visits UI.
2. User clicks **Connect Wallet**.
3. User signs wallet challenge.
4. UI connects to Trading WS.
5. Server assigns **Scout (Free)** tier + conservative limits.

Expected UX:
- No email collection.
- No forced redirects to third-party login pages.

### 2) Upgrade / payment flow (paid tier requires account)

Best practice: **account first, then payment**.

1. User clicks **Upgrade**.
2. UI prompts: "Create account" (email) or "Continue" if already logged in.
3. Create/verify account (magic link recommended to reduce password risk).
4. Run the payment flow for the selected plan.
5. Server updates subscription state.
6. UI refreshes entitlement state and unlocks tier features.

Notes:
- If using Stripe, Stripe Billing can send renewal reminders; additionally we can send product reminders.
- If using on-chain subscriptions, the product must send reminders (email + in-app) based on subscription period end.

---

## Payment options (supported patterns)

### Option A: On-chain subscription payments (wallet-first)

This is already implemented in the public Trading API as an on-chain USDC subscription flow:

- Builds an unsigned subscription transaction (USDC transfer + memo)
- User signs in wallet
- Server records confirmation and activates tier

See: [On-chain subscription implementation](../../../jul2025/dequanW/tradingAPI/SUBSCRIPTIONS.md)

How this satisfies the requirement:
- Free tier: no account required
- Paid tier: require account creation before initiating the on-chain subscription payment so we can send renewal reminders

### Option B: Stripe subscriptions (account-first)

Use Stripe Checkout + webhooks to activate/renew tiers.

How this satisfies the requirement:
- Free tier: no account required
- Paid tier: account is the billing identity and the email destination for reminders

### 3) Paid user daily usage

1. User loads UI → account session restored.
2. UI displays tier badge + entitlement state.
3. User connects wallet (if not already linked on this device).
4. Trading WS enforces paid limits.

### 4) Wallet linking rules (recommended)

- A wallet can be linked to a single account at a time.
- Linking requires an explicit signature from the wallet.
- If a wallet is already linked to another account, require support/manual recovery.

---

## Recommended deployment pattern

### A) Keep the public Trading WS hostname wallet-first

- **Public WS** (used by free users): no Cloudflare Access interactive login.
- Auth relies on wallet signature + server-side tier enforcement.

### B) Avoid Cloudflare Access as the customer login mechanism

Cloudflare Access is great for:
- internal admin dashboards
- private beta hostnames
- service-to-service auth (Service Tokens)

But it is not a replacement for customer accounts/subscriptions:
- it does not represent your product account
- it cannot drive subscription lifecycle emails/renewal reminders

If you want edge protection for *internal* endpoints, use a separate hostname (recommended).

---

## Best-practice security checklist (design-level)

- Short-lived session tokens; rotate on privilege changes.
- Strict server-side tier enforcement for anything that costs money.
- Origin allowlist on WS.
- Per-user + per-wallet rate limits.
- Audit logs for: wallet link/unlink, plan changes, trade attempts denied by tier.
- Stripe webhooks verified (signature verification) and idempotent.

---

## Implementation sequencing (practical)

1. Make free flow perfect: wallet connect + WS auth + Scout tier limits.
2. Add subscription service (Stripe) + webhooks.
3. Add accounts (email) + login.
4. Add wallet linking to accounts.
5. Enforce paid tier server-side with clear error messages.
6. Add renewal reminders + customer portal.

