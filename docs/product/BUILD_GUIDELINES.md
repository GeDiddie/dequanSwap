# Build Guidelines

These are the rules for implementing tiered UX and trading features safely.

## Architecture principles
- Keep the UI **mode-based** (Scout/Sniper/Apex), not settings-based.
- Keep “infra config” (WS URLs, tokens) out of the main surface; put it in a Diagnostics drawer.
- Never rely on UI-only gating for safety.

## State management
- Prefer React local state + small helper modules.
- Persist only what improves UX (tier selection, mode, trade size, watchlist) via localStorage.

## Safety / security
- Never ship long-lived secrets to the browser.
- All live-trade limits must be enforced by the trading backend:
  - max spend per trade/day
  - max open positions
  - slippage clamps
  - rate limits
- UI must clearly distinguish **Paper** vs **Live**.

## Data & performance
- Polling is acceptable in v0, but must be tier-limited.
- Keep per-token polling bounded (max tokens + interval).

## Observability
- UI should show a single “Engine status” indicator.
- Keep errors human-readable; hide stack traces.

## Coding conventions
- New product/tier logic lives in `src/lib/`.
- New UI sections live in `src/components/`.
- Avoid large monolithic components; prefer 1-file components that do one thing.
