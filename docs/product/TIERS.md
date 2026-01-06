# Tiers

This is the official tier definition for the dequanSwap user-facing product.

## Tier 0: Scout (Free)
**Goal:** let anyone learn the system with clear, conservative defaults.

**Identity requirement:** wallet-only (no email/account required)

**Core experience:**
- Live discovery + watch feed
- Manual buy/sell with transparent fees (tier-gated)
- Simple “why pass/skip” explanations
- Tip jar / supporter badge

**Limits (to protect infra):**
- Lower update frequency and/or fewer watched tokens
- Reduced retention (e.g., last N events only)
- Presets only (no advanced tuning)

Scout can access Live trading only when permitted by the tier gates.

## Tier 1: Sniper (Pro)
**Goal:** faster execution + higher limits.

**Identity requirement:** paid users must have an account (email) created during upgrade so we can manage subscriptions and renewal reminders.

**Core experience:**
- Choose a preset strategy (e.g., DequanW 1-minute)
- Toggle auto-buy for eligible tokens
- Hard caps: max spend per trade/day, max loss/day, max positions
- Notifications (eligible/bought/sold)

**Fast Mode:**
- Available on Sniper and above.
- Faster execution flows with strict caps and explicit user opt-in.

## Tier 2: Apex (Elite)
**Goal:** full power controls for advanced users.

**Identity requirement:** paid users must have an account (email) created during upgrade so we can manage subscriptions and renewal reminders.

**Core experience:**
- Full strategy configuration surface
- Multi-strategy, multi-rule
- Advanced filters / allowlists / denylists
- API access/webhooks/export

---

## Tier-to-Mode mapping (UI)
- Scout → **Observe + Manual Execute**
- Sniper → **Faster execution (+ Fast Mode)**
- Apex → **Strategy Lab (+ Fast Mode)**
