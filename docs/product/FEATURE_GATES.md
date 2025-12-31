# Feature Gates

This document defines what is **enabled**, **disabled**, or **limited** by tier. This is the single source of truth used by the UI and enforced by the backend.

## Rules
- **All enforcement must be server-side** for anything that costs money or affects safety.
- The UI also hides/locks features to keep UX simple, but UI gating is not security.
- Prefer gating by **mode** rather than exposing dozens of controls.

## Gate matrix (v0)

| Capability | Free | Minimalist | Pro | Elite |
|---|---:|---:|---:|---:|
| Paper trading | ✅ | ✅ | ✅ | ✅ |
| Live trading | ❌ | ✅ | ✅ | ✅ |
| Watchlist + Growth % | ✅ (limited) | ✅ | ✅ | ✅ |
| Manual buy/sell buttons | ✅ (paper only) | ✅ | ✅ | ✅ |
| Alerts on growth thresholds | ❌ (later) | ✅ | ✅ | ✅ |
| Auto-buy | ❌ | ❌ | ✅ | ✅ |
| Strategy presets | ❌ | ❌ | ✅ | ✅ |
| Full strategy tuning | ❌ | ❌ | ❌ | ✅ |
| Higher throughput (more watched tokens) | ❌ | ⚠️ | ✅ | ✅ |

## Limits (recommended defaults)
These are intentionally conservative.

- **Free**
  - max watched tokens: 10
  - quote polling: 3–5s
  - max stored events: 50

- **Minimalist**
  - max watched tokens: 50
  - quote polling: 1–2s
  - max open paper positions: 10
  - max open live positions: 1–3 (guardrail)

- **Pro/Elite**
  - raise limits gradually, driven by infra metrics

## Definitions
- **Growth %**: percent change between the first observed “price proxy” and the current price proxy.
- **Price proxy (v0)**: derived from swap quote for a fixed input amount.
