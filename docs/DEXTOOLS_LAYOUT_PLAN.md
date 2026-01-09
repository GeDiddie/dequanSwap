# DexTools-Style Chart Popout Layout Plan

**Reference:** https://www.dextools.io/app/solana/pair-explorer/6qjcjeuGhvio9TEedodaL5NMbCF1GoDmLCTxWi6np7L7

**Goal:** Reorganize the chart popout drawer to match DexTools' familiar layout with:
1. Large chart at top
2. Live transaction feed scrolling below chart
3. Organized metric cards surrounding the chart area

---

## 🎨 Current Layout Analysis

### Current Popout Structure (App.tsx ~L5145-5400)
```
┌─────────────────────────────────────────┐
│ Header (Token Name, Mint, Close Button)│
├─────────────────────────────────────────┤
│ Metrics Row (MC, PnL, Age, etc.)       │
├─────────────────────────────────────────┤
│                                         │
│         Candle Chart                    │
│         (CandlesChart.tsx)              │
│                                         │
├─────────────────────────────────────────┤
│ Signal Indicators (Graduated, etc.)     │
├─────────────────────────────────────────┤
│ Action Buttons (Snipe, Sell)           │
└─────────────────────────────────────────┘
```

---

## 🎯 Target DexTools Layout

### Proposed New Structure
```
┌─────────────────────────────────────────────────────────┐
│ Header Bar (Token Info, Controls)                      │
├──────────────┬───────────────────────────┬──────────────┤
│              │                           │              │
│   Left Card  │    CANDLE CHART          │  Right Card  │
│   Metrics    │    (Larger, Centered)    │  Metrics     │
│              │                           │              │
│   - Price    │                           │  - Liquidity │
│   - MC/FDV   │                           │  - Volume    │
│   - 24h Chg  │                           │  - Holders   │
│              │                           │              │
├──────────────┴───────────────────────────┴──────────────┤
│                                                          │
│           LIVE TRANSACTION FEED                          │
│  ┌────────────────────────────────────────────────┐    │
│  │ 🟢 BUY  | 0.5 SOL | 1,234 TOKENS | 2s ago     │    │
│  │ 🔴 SELL | 0.3 SOL | 890 TOKENS  | 5s ago     │    │
│  │ 🟢 BUY  | 1.2 SOL | 2,456 TOKENS | 8s ago     │    │
│  │ 🔴 SELL | 0.8 SOL | 1,567 TOKENS | 12s ago    │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ Action Buttons (Snipe, Sell, etc.)                      │
└──────────────────────────────────────────────────────────┘
```

---

## 📦 Component Breakdown

### 1. Left Metrics Card
**Data to Display:**
- 💰 **Current Price** (USD + SOL)
- 📊 **Market Cap** / FDV
- 📈 **24h Change** (% + absolute)
- 🕐 **Token Age** (time since launch)
- 🎯 **Buy MC** (for holdings)
- 📊 **PnL %** (for holdings)

**Data Sources:**
- Current: `getHoldingDisplayMc()`, `computeGrowthPct()`
- New: Need 24h price history from backend or cache

### 2. Right Metrics Card
**Data to Display:**
- 💧 **Liquidity** (USD + SOL)
- 📊 **Volume 24h** (USD)
- 👥 **Holder Count**
- 🔒 **Liquidity Lock** (if available)
- ⚡ **Top Holder %** (whale risk)
- 🏊 **Pool Info** (Raydium, Orca, etc.)

**Data Sources:**
- Current: SolanaTracker WebSocket signals (`popoutSignals`)
- New: Need holder data endpoint, liquidity/volume from backend

### 3. Live Transaction Feed
**Real-Time Data to Display:**
- **Transaction Type** (Buy 🟢 / Sell 🔴)
- **SOL Amount** (e.g., "0.5 SOL")
- **Token Amount** (e.g., "1,234 TOKENS")
- **USD Value** (e.g., "$25.50")
- **Wallet Address** (shortened, e.g., "Abc...xyz")
- **Timestamp** (relative, e.g., "2s ago")
- **Transaction Link** (Solscan)

**Data Sources:**
- SolanaTracker WebSocket: Already subscribed to trading rooms
- Current signals: `holders:${mint}`, `top10:${mint}`, `dev:${mint}`, etc.
- Need: New subscription to transaction feed or parse existing signals

### 4. Enhanced Chart Area
**Improvements:**
- Larger chart (increase height from 380px to 500-600px)
- Full width in center column
- Better integration with transaction feed below
- Chart controls (timeframe selector: 1m, 5m, 15m, 1h, 4h, 1d)

---

## 🔌 Data Integration Plan

### Existing Data Sources ✅
**Already Available:**
- ✅ Price feed: `subscribe_price` / `price_tick` (Trading API)
- ✅ Candle data: `Candles1sBuilder` with persistent history
- ✅ Market cap: Computed from `getHoldingDisplayMc()`
- ✅ Signals: SolanaTracker WebSocket (`popoutSignals`)
- ✅ Holder tracking: `popoutWsRoomWinners` state

### New Data Sources Needed 🔨

#### A. Transaction Feed
**Option 1: SolanaTracker WebSocket**
- Subscribe to existing holder/swap events
- Parse transaction data from signals
- Filter for buy/sell transactions

**Option 2: Trading API Extension**
- Add `subscribe_transactions` message type
- Backend subscribes to Raydium/Jupiter swap events
- Stream formatted transactions to frontend

**Option 3: Helius Webhooks**
- Subscribe to token account changes
- Parse swap transactions
- Real-time feed via WebSocket relay

**Recommendation:** Start with Option 1 (existing SolanaTracker), add Option 2 later

#### B. 24h Historical Data
**Need:**
- 24h price change calculation
- 24h volume aggregation
- Historical MC tracking

**Implementation:**
- Backend cache: Store 24h price snapshots
- New API endpoint: `/api/token-metrics/${mint}`
- Response: `{ price24h, volume24h, priceChange24h }`

#### C. Liquidity & Pool Data
**Need:**
- Current liquidity (USD + SOL)
- Pool address and DEX
- Liquidity lock status

**Sources:**
- SolanaTracker API (already connected)
- Parse from existing signals or add dedicated endpoint

---

## 🛠️ Implementation Roadmap

### Phase 1: Layout Restructure (Week 1)
**Goal:** Reorganize existing components into 3-column layout

**Tasks:**
1. ✅ Create new CSS grid layout for popout drawer
   - 3 columns: left card (200px), chart (flex), right card (200px)
   - Transaction feed row below chart (full width)

2. ✅ Extract metrics into separate card components
   - `<MetricsCardLeft />` component
   - `<MetricsCardRight />` component
   - Move existing data into cards

3. ✅ Increase chart height and adjust responsive behavior
   - Chart: 500-600px height
   - Mobile: Stack vertically

**Files to Modify:**
- `src/App.tsx` (lines ~5145-5400)
- `src/App.css` (new `.holdingDrawerGrid`, `.metricsCard`, `.txFeed` classes)

### Phase 2: Transaction Feed Component (Week 2)
**Goal:** Display live buy/sell transactions below chart

**Tasks:**
1. ✅ Create `<TransactionFeed />` component
   - Props: `mint`, `transactions[]`
   - Auto-scroll to show latest (max 20 visible)
   - Color-coded rows (green buy, red sell)

2. ✅ Parse existing SolanaTracker signals for transactions
   - Hook into `popoutWsRoomWinners` updates
   - Extract wallet, amount, timestamp from signals
   - Store in `popoutTransactionsRef`

3. ✅ Add transaction row component
   - Display: Type icon, SOL amount, token amount, wallet, time
   - Click to open Solscan in new tab
   - Animated entry (fade in from top)

**Files to Create:**
- `src/components/TransactionFeed.tsx`
- `src/components/TransactionRow.tsx`

**Files to Modify:**
- `src/App.tsx` (add transaction state and parsing)

### Phase 3: Enhanced Metrics Cards (Week 2-3)
**Goal:** Add missing data points to left/right cards

**Tasks:**
1. ✅ Left Card Enhancements
   - Add 24h price change (% and absolute)
   - Add sparkline chart for 24h price
   - Add FDV calculation

2. ✅ Right Card Enhancements
   - Add liquidity display (from backend)
   - Add 24h volume (from backend)
   - Add holder count (from SolanaTracker)
   - Add top holder % warning

3. ✅ Backend API additions
   - New endpoint: `/api/token-metrics/${mint}`
   - Cache 24h data in Redis/memory
   - Return: `{ liquidity, volume24h, holderCount, topHolder }`

**Files to Create:**
- `jul2025/dequanW/apiLiteServer.js` - Add `/token-metrics` endpoint

**Files to Modify:**
- `src/App.tsx` - Fetch and display new metrics
- `src/components/MetricsCard.tsx` (new component)

### Phase 4: Chart Controls (Week 3)
**Goal:** Add timeframe selector and chart improvements

**Tasks:**
1. ✅ Add timeframe selector buttons
   - Options: 1m, 5m, 15m, 1h, 4h, 1d
   - Switch between candle intervals
   - Persist selection in localStorage

2. ✅ Implement multi-timeframe candle building
   - Aggregate 1s candles into larger timeframes
   - New `Candles5mBuilder`, `Candles1hBuilder` classes
   - Use same persistence pattern

3. ✅ Add chart indicators (optional)
   - Volume bars below price
   - Moving averages (20, 50, 200)
   - Toggle controls

**Files to Create:**
- `src/lib/candles5m.ts`, `src/lib/candles1h.ts`

**Files to Modify:**
- `src/components/CandlesChart.tsx` - Add timeframe controls
- `src/App.tsx` - Manage timeframe state

### Phase 5: Polish & Optimization (Week 4)
**Goal:** Performance tuning and UX improvements

**Tasks:**
1. ✅ Optimize transaction feed performance
   - Virtual scrolling for large lists
   - Debounce updates (max 2 updates/sec)
   - Limit history to 100 transactions

2. ✅ Add loading states
   - Skeleton loaders for metrics cards
   - Spinner for transaction feed
   - Graceful fallbacks

3. ✅ Mobile responsive adjustments
   - Stack layout vertically on mobile
   - Collapsible cards
   - Swipeable transaction feed

4. ✅ Accessibility improvements
   - Keyboard navigation for transaction list
   - Screen reader labels
   - ARIA attributes

**Files to Modify:**
- `src/App.css` - Media queries
- All component files - Add aria labels

---

## 📐 CSS Layout Implementation

### Grid Structure
```css
.holdingDrawerGrid {
  display: grid;
  grid-template-columns: 220px 1fr 220px;
  grid-template-rows: auto 1fr auto;
  gap: 12px;
  height: calc(100vh - 100px);
  padding: 16px;
}

.metricsCardLeft {
  grid-column: 1;
  grid-row: 1 / 3;
}

.chartArea {
  grid-column: 2;
  grid-row: 1 / 3;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.metricsCardRight {
  grid-column: 3;
  grid-row: 1 / 3;
}

.txFeed {
  grid-column: 1 / 4;
  grid-row: 3;
  max-height: 200px;
  overflow-y: auto;
}

.holdingDrawerActions {
  grid-column: 1 / 4;
  grid-row: 4;
}

/* Mobile */
@media (max-width: 1024px) {
  .holdingDrawerGrid {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto auto auto auto;
  }
  
  .metricsCardLeft { grid-column: 1; grid-row: 1; }
  .chartArea { grid-column: 1; grid-row: 2; }
  .metricsCardRight { grid-column: 1; grid-row: 3; }
  .txFeed { grid-column: 1; grid-row: 4; }
  .holdingDrawerActions { grid-column: 1; grid-row: 5; }
}
```

### Metrics Card Styling
```css
.metricsCard {
  background: rgba(20, 20, 30, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.metricRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.metricLabel {
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.metricValue {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.metricValuePositive {
  color: rgba(34, 197, 94, 0.95);
}

.metricValueNegative {
  color: rgba(248, 81, 73, 0.95);
}
```

### Transaction Feed Styling
```css
.txFeed {
  background: rgba(10, 10, 15, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 12px;
}

.txRow {
  display: grid;
  grid-template-columns: 60px 100px 150px 120px 80px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  transition: background 0.2s;
  cursor: pointer;
}

.txRow:hover {
  background: rgba(255, 255, 255, 0.05);
}

.txRowBuy {
  border-left: 3px solid rgba(34, 197, 94, 0.6);
}

.txRowSell {
  border-left: 3px solid rgba(248, 81, 73, 0.6);
}

.txType {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.txTypeBuy {
  color: rgba(34, 197, 94, 0.95);
}

.txTypeSell {
  color: rgba(248, 81, 73, 0.95);
}

.txAmount {
  font-size: 13px;
  font-family: 'Courier New', monospace;
}

.txWallet {
  font-size: 11px;
  font-family: 'Courier New', monospace;
  color: var(--muted);
}

.txTime {
  font-size: 11px;
  color: var(--muted);
  text-align: right;
}
```

---

## 🔍 Data Structures

### Transaction Type
```typescript
type Transaction = {
  signature: string
  type: 'buy' | 'sell'
  solAmount: number
  tokenAmount: number
  usdValue: number
  wallet: string
  timestamp: number
  poolAddress?: string
}
```

### Enhanced Metrics Type
```typescript
type TokenMetrics = {
  // Price
  currentPriceUsd: number
  currentPriceSol: number
  price24hAgo?: number
  priceChange24h?: number
  priceChangePct24h?: number
  
  // Market Cap
  marketCap: number
  fullyDilutedValue?: number
  
  // Liquidity & Volume
  liquidityUsd?: number
  liquiditySol?: number
  volume24hUsd?: number
  
  // Holders
  holderCount?: number
  topHolderPct?: number
  
  // Pool
  poolAddress?: string
  dexName?: string
  liquidityLocked?: boolean
}
```

---

## 🎯 Success Metrics

### User Experience Goals
- ✅ **Familiarity:** Layout matches DexTools for instant recognition
- ✅ **Information Density:** All key metrics visible without scrolling
- ✅ **Real-Time Feel:** Transaction feed updates smoothly (< 2s delay)
- ✅ **Performance:** No lag when rendering 100+ transactions
- ✅ **Mobile Friendly:** Usable on tablets and large phones

### Technical Goals
- Chart height: 500-600px (vs current 380px)
- Transaction feed: Support 100+ items with virtual scroll
- Layout render time: < 100ms
- WebSocket latency: < 500ms for transaction updates
- Metrics refresh: Every 5-10 seconds

---

## 📋 Migration Strategy

### Backward Compatibility
- Keep existing popout functional during development
- Feature flag: `USE_DEXTOOLS_LAYOUT` (localStorage)
- A/B test with subset of users
- Full rollout after 1 week of testing

### Gradual Rollout
1. **Week 1-2:** Implement new layout behind feature flag
2. **Week 2-3:** Beta test with opt-in users
3. **Week 3-4:** Default to new layout, allow opt-out
4. **Week 4+:** Remove old layout code

---

## 🚀 Quick Start Commands

### Development
```bash
# Run dev server with hot reload
cd /home/g1/bot/dequanSwap
npm run dev

# Build and deploy
npm run build
npx wrangler pages deploy dist --project-name=dequanswap
```

### Testing
```bash
# Test transaction feed parsing
# Open browser console and enable feature flag:
localStorage.setItem('dequanswap.useDexToolsLayout', '1')

# Monitor WebSocket messages:
localStorage.setItem('dequanswap.debugWs', '1')
```

---

## 📚 Reference Links

- **DexTools Example:** https://www.dextools.io/app/solana/pair-explorer/6qjcjeuGhvio9TEedodaL5NMbCF1GoDmLCTxWi6np7L7
- **SolanaTracker API Docs:** (existing integration)
- **Trading API WebSocket:** `/home/g1/bot/jul2025/dequanW/tradingAPI/`
- **Current Chart Component:** `/home/g1/bot/dequanSwap/src/components/CandlesChart.tsx`
- **Candle Builder:** `/home/g1/bot/dequanSwap/src/lib/candles1s.ts`

---

**End of Plan Document**

**Next Steps:**
1. Review and approve this plan
2. Create feature branch: `feature/dextools-layout`
3. Implement Phase 1 (layout restructure)
4. Test on staging deployment
5. Iterate based on feedback
