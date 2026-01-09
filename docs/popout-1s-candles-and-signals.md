# Popout: 1s Candles + Risk/Edge Signals (SolanaTracker)

Goal: replace the current popout/sparkline experience with a fast “token detail / snipe page” popout that feels familiar (TradingView-like), stays lightweight, and uses **our own SolanaTracker data** (no TradingView data dependency).

This doc is a build checklist we can execute against.

---

## Principles (non-negotiable)

- **No TradingView datafeed**: all price/tx/metrics come from SolanaTracker (WS + optional Data API backfill). This avoids TradingView throttling/volume-based fees.
- **Subscribe only while popout is open**: WS room joins must be scoped to the selected token and released on close/unmount.
- **Bounded memory**: ring buffers for candles, trades, and events (e.g., last 10–30 minutes of 1s candles, last 200 trades).
- **Graceful staleness**: show a “stale” badge if no ticks/txs arrive for N seconds; do not freeze silently.
- **Fast first paint**: popout should render immediately with placeholders, then hydrate as streams arrive.

---

## What we’re building (MVP)

### UI layout (BullX-inspired structure, not copy)

- Header: token name/symbol, mint (copy), quick links (explorer), status pills.
- Stats strip: price, MC (if available/derived), liquidity, 1m/5m change, 1m volume, buy/sell split.
- Main row:
  - Left: **1s candlestick chart** with timeframe selector.
  - Right: trade ticket (existing “Snipe” / buy/sell UI).
- Below (optional in MVP): recent trades tape (last ~50 swaps).

### Chart renderer choice

Preferred: **`lightweight-charts`** (open-source renderer; we supply our own candles).
- Rationale: best UX/perf for the least engineering. Not the commercial TradingView Charting Library.
- Compliance: include required attribution notice/link as required by its NOTICE.

Fallback if we ever want “no TradingView-produced code”: implement a minimal HTML5 canvas candlestick chart.

---

## Data sources (SolanaTracker)

Base connection:
- `wss://datastream.solanatracker.io/{DATASTREAM_KEY}`

Rooms we will use (scoped per token / per pool as appropriate):

### For 1s candles
- **Token transactions** (preferred truth): build candles from executed swaps, compute volume and buy/sell split.
- **Price aggregated** (optional smoothing): use as tick source when txs are sparse.

### For stats strip
- **Token statistics**: multi-timeframe stats (volume, tx counts, buy/sell split, changes).
- **Pool statistics** (optional): liquidity/volume stats per pool.
- **Token primary**: identify current primary pool (based on liquidity) to anchor “the” price stream.

### Risk + edge signals
- **Holders**: holder count changes.
- **Top10 holders**: concentration changes.
- **Developer holdings**: dev % changes.
- **Sniper tracking** / **Insider tracking**: concentration changes.
- **Curve percentage** + **Graduating/Graduated**: lifecycle context.
- **Fee tracking**: global fee changes (optional badge).

---

## Candle model

We will standardize on an internal candle type:

- time: unix seconds (integer)
- open/high/low/close: number
- volume: number (optional for MVP)
- buyVolume/sellVolume: number (optional)

Aggregation rules:
- Bucket by `floor(tsMs/1000)`.
- When a new second is observed, finalize previous candle.
- Gap handling (optional): if we miss seconds, we may “carry-forward” close to keep the chart continuous.

---

## Markers (signals on chart)

We will render compact markers on/near candles for:
- dev holding changes
- sniper/insider spikes
- curve % milestones
- graduation events
- our own buys/sells (from existing trading ws order updates)

MVP marker rules:
- show only a few types, capped to last N markers to avoid clutter.

---

## Implementation plan (checklist)

### Phase A — Streaming 1s candles (MVP)

- [ ] Add `VITE_SOLANATRACKER_DATASTREAM_KEY` to `.env.example` and wire read path.
- [ ] Implement frontend WS client for SolanaTracker (join/leave rooms, reconnect, heartbeat ping/pong).
- [ ] Implement a 1s candle builder (ring buffer) that can accept ticks or trades.
- [ ] Add `lightweight-charts` and create `CandlesChart` React component.
- [ ] Replace popout line chart with candlestick chart (1s) for selected token.
- [ ] Add basic staleness badge when no updates for N seconds.

Acceptance:
- Popout shows live updating 1s candles within 1–2 seconds of open.
- Closing popout stops all SolanaTracker room subscriptions.
- App remains responsive with 1 popout open.

### Phase B — Backfill + better stats

- [ ] Backfill last X minutes of price history on open via SolanaTracker Data API (if endpoint supports it) or by buffering after open.
- [ ] Add token stats strip fields from Token statistics / Pool statistics.
- [ ] Add trades tape (last 50) from Token transactions.

Acceptance:
- Popout opens with immediate history (not a blank chart) when available.

### Phase C — Risk/Edge strip + markers

- [ ] Subscribe to holders/top10/dev/sniper/insider/curve/graduation while popout open.
- [ ] Render compact badges (single line) and corresponding chart markers.
- [ ] Add severity thresholds (e.g., top10 > 40% = red).

Acceptance:
- Risk strip updates in realtime and is readable at a glance.

### Phase D — “Better than BullX” execution UX

- [ ] Persist per-user execution presets (slippage, priority fee, tip) locally.
- [ ] Clear fee breakdown + outcome states for trades.
- [ ] Marker/annotation for our fills and PnL milestones.

---

## Performance budget

- Keep chart bundle impact small.
- Do not subscribe to >1 token’s risk streams unless the user opens that token.
- Keep per-token memory bounded (candles + markers + trades).

---

## Notes / risks

- SolanaTracker rooms are documented, but message payload fields may vary; we must implement defensive parsing.
- If Token transactions is too heavy at 1s scale, prefer Price aggregated for candles and use tx stream only for tape + volume.
- If `lightweight-charts` attribution is required, we’ll comply in-app.
