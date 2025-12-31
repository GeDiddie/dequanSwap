# Tiers

This is the official tier definition for the dequanSwap user-facing product.

## Tier 0: Free (Training / Paper)
**Goal:** let anyone learn the system risk-free.

**Core experience:**
- Live discovery + watch feed
- Paper positions and paper PnL
- Simple “why pass/skip” explanations
- Tip jar / supporter badge

**Limits (to protect infra):**
- Lower update frequency and/or fewer watched tokens
- Reduced retention (e.g., last N events only)
- Presets only (no advanced tuning)

**No live orders.**

## Tier 1: Minimalist (Manual Snipe)
**Goal:** real trading without full automation.

**Core experience:**
- Watch tokens from detection time and track **Growth %**
- User manually executes with one-click actions:
  - Buy fixed size (e.g., 0.01 / 0.05 / 0.1 SOL)
  - Sell 25/50/100%
- Optional “micro-automation” allowed (still minimalist):
  - Simple TP/SL sliders (one pair)

**Limits:**
- Presets for slippage/fees; advanced execution hidden by default
- Small number of concurrent positions by default (e.g., 1–3)

## Tier 2: Pro (Assisted Automation)
**Goal:** preset-based automation with guardrails.

**Core experience:**
- Choose a preset strategy (e.g., DequanW 1-minute)
- Toggle auto-buy for eligible tokens
- Hard caps: max spend per trade/day, max loss/day, max positions
- Notifications (eligible/bought/sold)

## Tier 3: Elite (Strategy Lab)
**Goal:** full power controls for advanced users.

**Core experience:**
- Full strategy configuration surface
- Multi-strategy, multi-rule
- Advanced filters / allowlists / denylists
- API access/webhooks/export

---

## Tier-to-Mode mapping (UI)
- Free → **Observe + Paper**
- Minimalist → **Observe + Manual Execute**
- Pro → **Observe + Assisted Auto**
- Elite → **Strategy Lab**
