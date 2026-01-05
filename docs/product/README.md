# Product Docs (dequanSwap)

These docs define the **tiered UX**, what each tier is allowed to do, and the build rules for implementing features safely.

---

## 🚨 ALWAYS CHECK FIRST

**[MASTER_BUILD_CHECKLIST.md](MASTER_BUILD_CHECKLIST.md)** ← Primary TODO list

Review this checklist **before making any changes** and **before every deployment**.

---

## Product North Star

A beginner should be able to:
1. Connect a wallet (or start in paper mode)
2. Watch new tokens in a live feed
3. Understand *why* a token is interesting (simple growth + simple reasons)
4. Buy / sell with one click

The UI should feel like:
- **DequanW dashboard simplicity** (one screen, signal-first)
- With **BullX/PumpSwap ergonomics** (fast actions, minimal decisions)

---

## The Three "Modes" (How the App Stays Simple)

We avoid adding 50 toggles by mapping tiers to modes:

- **Scout** → Observe + Manual Execute (+ Paper)
- **Sniper** → Faster execution (+ Fast Mode)
- **Apex** → Strategy Lab (+ Fast Mode)

Each mode has its own UI surface area. Users only see the controls needed for that mode.

---

## Core Documents

### Planning & Workflow
- **[MASTER_BUILD_CHECKLIST.md](MASTER_BUILD_CHECKLIST.md)** ⭐ PRIMARY TODO - check before all changes
- [ROADMAP.md](ROADMAP.md) - Feature roadmap & milestones
- [BUILD_PLAN.md](BUILD_PLAN.md) - DequanW parity build plan (buy/sell/persistence/confirmations)
- [BACKEND_CONTRACT.md](BACKEND_CONTRACT.md) - Exact backend requirements (Control Plane + Trading WS)
- [INTEGRATION_CONTINUATION_DEQUANW.md](INTEGRATION_CONTINUATION_DEQUANW.md) - Handoff requirements for dequanW backend work

### Product Specification
- [TIERS.md](TIERS.md) - Product tier definitions & pricing
- [IDENTITY_BILLING_PLAN.md](IDENTITY_BILLING_PLAN.md) - Free wallet-only + Paid account/subscription plan
- [FEATURE_GATES.md](FEATURE_GATES.md) - Tier gating matrix
- [FAST_MODE.md](FAST_MODE.md) - Fast Mode hybrid design (Pro/Elite)
- [TRADE_LIFECYCLE.md](TRADE_LIFECYCLE.md) - Buy → Holdings → Sell → Sold (public user semantics)
- [FEATURE_SHORTS.md](FEATURE_SHORTS.md) - Short video ideas + IDs for `?` help icons
- [HELP_SYSTEM.md](HELP_SYSTEM.md) - Final contextual help + onboarding tour design

### UX Guidelines
- [UX_MINIMALIST.md](UX_MINIMALIST.md) - Minimalist UI requirements
- [KINETIC_STREAM.md](KINETIC_STREAM.md) - Feed animation spec
- [BUILD_GUIDELINES.md](BUILD_GUIDELINES.md) - Development standards

---

## Current State (Jan 3, 2026)

**Implemented**:
- ✅ Tiered product (Scout/Sniper/Apex)
- ✅ Live feed (kinetic vertical stream)
- ✅ Paper trading mode
- ✅ Live trading (Phantom signature)
- ✅ Fast Mode arming/revoke (WSOL delegation)
- ✅ Fast Mode BUYs (delegate-authority, no popup)

**In Progress**:
- 🔴 Fast Mode SELLs (high priority)
- Bot wallet hardening
- Explainer microvideo system

---

## Related Documentation

- **Project Organization**: [../PROJECT_ORGANIZATION.md](../PROJECT_ORGANIZATION.md)
- **Trading API Integration**: [../trading-api/TRADING_API_INTEGRATION.md](../trading-api/TRADING_API_INTEGRATION.md)
- **Main README**: [../../README.md](../../README.md)
