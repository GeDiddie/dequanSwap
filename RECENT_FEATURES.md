# Recent Features & Improvements

This document tracks all features and improvements added to dequanSwap to prevent duplicate implementation.

**Last Updated:** January 7, 2026

---

## ✅ Implemented Features

### Candle Chart Persistence (Jan 7, 2026)
**Status:** ✅ Complete  
**Deployment:** https://03bac073.dequanswap.pages.dev

**Description:**
- Candle history now persists across chart open/close events
- History continues when tokens move from watching → holdings
- History clears only on explicit removal or sale

**Implementation Details:**
- Added `candleHistoryRef = useRef<Record<string, Candle1s[]>>({})` ([App.tsx L1232](src/App.tsx#L1232))
- Load existing candles on chart open ([App.tsx L1468-1485](src/App.tsx#L1468-1485))
- Save candles on cleanup ([App.tsx L1698-1704](src/App.tsx#L1698-1704))
- Clear on token removal ([App.tsx L2356-2360, 3397-3401](src/App.tsx#L2356-2360))

**User Flow:**
1. Open chart in watching → close → reopen → candles persist ✅
2. Buy token (watching→holdings) → candles continue ✅
3. Close holdings chart → reopen → candles persist ✅
4. Sell/remove token → candles cleared ✅

---

### Popout Drawer Auto-Close on Snipe (Jan 7, 2026)
**Status:** ✅ Complete  
**Deployment:** https://a8c6ddfe.dequanswap.pages.dev

**Description:**
- Clicking "Snipe" from chart popout now automatically closes the drawer
- Reveals snipe card underneath for immediate action
- Free tier users see alert first, then drawer closes

**Implementation Details:**
- Holdings drawer: Added `closeHoldingDrawer()` call ([App.tsx L5226](src/App.tsx#L5226))
- Watching drawer: Added `closeWatchDrawer()` call ([App.tsx L5537](src/App.tsx#L5537))

**User Flow:**
1. Free tier: Click Snipe → alert shown → drawer closes → snipe card visible ✅
2. Paid tier: Click Snipe → drawer closes → snipe card visible ✅

---

### Wallet Connection Optimization (Jan 7, 2026)
**Status:** ✅ Complete  
**Deployment:** https://38688ae8.dequanswap.pages.dev

**Description:**
- Eliminated need to click "Connect Wallet" button twice
- Auto-reconnect on page refresh for returning users
- Eager connection immediately after wallet selection

**Implementation Details:**
- Added `autoConnect` prop to WalletProvider ([main.tsx L31](src/main.tsx#L31))
- Added eager connection effect ([App.tsx L717-724](src/App.tsx#L717-724))
- Uses `wallet`, `connect` from `useWallet()` hook

**User Flow:**
1. First time: Click "Connect Wallet" → Select Phantom → **immediately connects** (no second click) ✅
2. Return visit: **Automatically reconnects** on page load ✅

---

### Warning Banners for Rugged/Stale Tokens (Prior to Jan 7, 2026)
**Status:** ✅ Complete

**Description:**
- Red warning banner in chart popouts for rugged tokens
- Yellow warning banner in watching drawer for stale tokens
- Warns users before they interact with problematic tokens

**Implementation Details:**
- Rugged warnings in holdings drawer ([App.tsx ~L5126-5170](src/App.tsx))
- Rugged/stale warnings in watching drawer ([App.tsx ~L5390-5440](src/App.tsx))

---

### Custom Reticle Logo (Prior to Jan 7, 2026)
**Status:** ✅ Complete

**Description:**
- Replaced chart attribution text with custom reticle logo
- 16px height, 70% opacity, bottom-right position

**Implementation Details:**
- Logo import and display in CandlesChart.tsx
- Source: `src/media/reticleLogo.png`

---

### Enhanced Wallet Connection Prompt (Prior to Jan 7, 2026)
**Status:** ✅ Complete

**Description:**
- Larger, clearer message when wallet not connected
- 18px font size with instructions
- Displays in chart popouts when candles unavailable

**Implementation Details:**
- Error detection and display ([App.tsx L5348-5351, 5660-5663](src/App.tsx))

---

### Backend Price Feed Architecture (Prior to Jan 7, 2026)
**Status:** ✅ Complete

**Description:**
- Real-time price streaming via Trading API WebSocket
- subscribe_price/price_tick protocol
- 1s OHLC candles built from high-frequency ticks
- Fallback to quote polling if price feed unavailable

**Implementation Details:**
- API-Lite server (port 8912): CORS-enabled HTTP endpoints
- Trading API (port 8900): WebSocket price feed
- Cloudflare tunnel routing configured

---

## 🚧 Planned Features

### Telegram Alerts System
**Status:** 📋 Planned (Not Started)  
**Todo Item:** Added to todo list

**Description:**
- Alert users via Telegram on various events
- Dropdown selector for alert triggers
- Event types: MC reached, graduated, mooning, etc.

**Requirements:**
- Telegram bot integration
- User notification preferences
- Event trigger configuration UI
- Backend webhook/notification system

---

## 📝 Notes

### Feature Request Protocol
1. Check this document before implementing
2. Update status when starting work
3. Document implementation details when complete
4. Add deployment URL for verification

### Deployment URLs
- Latest stable: https://38688ae8.dequanswap.pages.dev
- Candle persistence: https://03bac073.dequanswap.pages.dev
- Drawer auto-close: https://a8c6ddfe.dequanswap.pages.dev

---

## 🔍 Quick Reference

**Key Files:**
- Frontend main: `src/App.tsx` (6921 lines)
- Wallet setup: `src/main.tsx`
- Chart component: `src/components/CandlesChart.tsx`
- Candle builder: `src/lib/candles1s.ts`

**Backend Services:**
- Trading API: `jul2025/dequanW/tradingAPI/` (port 8900)
- API-Lite: `jul2025/dequanW/apiLiteServer.js` (port 8912)
- 1-Minute Strategy: `jul2025/dequanW/strategies/oneMinuteStrategy.js` (port 8901)

---

**End of Document**
