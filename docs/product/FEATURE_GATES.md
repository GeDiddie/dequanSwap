# Feature Gates

This document defines what is **enabled**, **disabled**, or **limited** by tier. This is the single source of truth used by the UI and enforced by the backend.

## Rules
- **All enforcement must be server-side** for anything that costs money or affects safety.
- The UI also hides/locks features to keep UX simple, but UI gating is not security.
- Prefer gating by **mode** rather than exposing dozens of controls.

## Gate matrix (v0)

| Capability | Scout | Sniper | Apex |
|---|---:|---:|---:|
| Paper trading | ✅ | ✅ | ✅ |
| Live trading | ✅ (limited) | ✅ | ✅ |
| Watchlist + Growth % | ✅ (limited) | ✅ | ✅ |
| Manual buy/sell buttons | ✅ | ✅ | ✅ |
| Holdings metadata (buy time + buy MC) | ✅ | ✅ | ✅ |
| Holdings real-time chart | ✅ (limited) | ✅ | ✅ |
| Sold history (trade journal) | ✅ | ✅ | ✅ |
| Alerts on growth thresholds | ❌ (later) | ✅ | ✅ |
| Take profit / stop loss (TP/SL) | ❌ (later) | ✅ (later) | ✅ (later) |
| Auto-sell (rule-triggered exits) | ❌ (later) | ✅ (later) | ✅ (later) |
| Auto-buy | ❌ (later) | ✅ (later) | ✅ (later) |
| Fast Mode (speed execution) | ❌ | ✅ | ✅ |
| Strategy presets | ❌ (later) | ✅ (later) | ✅ (later) |
| Full strategy tuning | ❌ | ❌ | ✅ (later) |
| Higher throughput (more watched tokens) | ✅ (limited) | ✅ | ✅ |
| Server-side persistence (positions/history) | ✅ | ✅ | ✅ |

## Limits (recommended defaults)
These are intentionally conservative.

- **Scout**
  - max watched tokens: 5
  - quote polling: 4s

- **Sniper**
  - max watched tokens: 20
  - quote polling: 0.8s

- **Apex**
  - max watched tokens: unlimited
  - quote polling: 0.5s

## Definitions
- **Growth %**: percent change between the first observed “price proxy” and the current price proxy.
- **Price proxy (v0)**: derived from swap quote for a fixed input amount.
