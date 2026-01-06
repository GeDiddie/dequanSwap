# Minimalist UX (Manual Snipe)

## Purpose
Deliver a beginner-friendly sniping experience without full automation.

## Home screen layout
Single screen, 3 main sections:

1) **KPI strip**
- Watching now
- Alerts triggered (session)
- Live PnL
- Engine status (green/yellow/red)

2) **Live Feed (Evaluations)**
A table where each row is actionable.

Columns (v0):
- Token (name + short mint)
- Age (since first seen)
- Entry price proxy
- Current price proxy
- **Growth %** (big)
- Actions: **Buy** / **Watch**

3) **Watching / Positions**
- Watching: shows tokens being tracked now
- Positions: shows holdings with quick sells

## Token drawer (row click)
Right-side drawer:
- Growth sparkline (last 60–120s)
- Simple reason chips (v0: “fast growth”, “stable liquidity”, “no freeze”) – can be stubbed initially
- Buttons: Ignore / Watch / Buy / Sell

## Minimal settings (top bar)
Keep this tiny:
- Trade size (quick buttons)
- Slippage: hidden in Advanced dropdown

## Growth % definition (v0)
We treat a quote-derived price proxy as:

- For a fixed input amount $A$ (lamports), and quote output $Q$ (base units), define price proxy:

$$p = \frac{A}{Q}$$

Then growth percent from first observation $p_0$ is:

$$g = \frac{p - p_0}{p_0} \times 100$$

This works for relative change even if token decimals are unknown, because decimals cancel.

## Safety rails (minimalist)
- Default 1 open live position (configurable later)
- Default max spend/trade
- Confirmations run in the background and are bounded by timeouts (no infinite “confirming”).
