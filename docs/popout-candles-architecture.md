# Popout Candle Chart: Modular Architecture

## Overview

Real-time 1-second OHLC candlestick charts for token popouts, built with a modular data provider architecture that supports seamless migration from local PC to cloud deployment.

---

## Architecture Principles

### 1. **Backend-Sourced Data**
Frontend subscribes to dequanW Trading API WebSocket for real-time price ticks. Backend handles all data provider integration.

### 2. **Modular Data Provider**
Backend integrates with data providers (SolanaTracker, Jupiter, Raydium, etc.). Providers can be swapped backend-side without any frontend changes.

### 3. **Cloud-Ready Design**
- No client-side data provider keys
- No hardcoded local IPs or PC-specific config
- Supports deployment to Cloudflare Pages, Vercel, AWS, etc.
- Backend can run anywhere (local PC, VPS, cloud container)

### 4. **Security**
- Data provider API keys stay on backend (never exposed to browser)
- Frontend authenticates to backend via wallet signature or API key
- Rate limiting and access control enforced backend-side

### 5. **Performance**
- Subscribe only while popout open (resource-efficient)
- Ring buffers for bounded memory (last 10-30 minutes of candles)
- Client-side candle aggregation from ticks (reduces bandwidth)

---

## Data Flow

```
[Data Provider]          [dequanW Backend]             [dequanSwap Frontend]
(SolanaTracker/         (Trading API WebSocket)        (Browser)
 Jupiter/Raydium)   
      |                         |                            |
      | price stream            |                            |
      |------------------------>|                            |
      |                         | subscribe_price            |
      |                         |<---------------------------|
      |                         |                            |
      |                         | price_tick (10-100/sec)    |
      |                         |--------------------------->|
      |                         |                            | 
      |                         |                            | Build 1s candles
      |                         |                            | Render chart
      |                         |                            |
      | transaction stream      | trade (optional)           |
      |------------------------>|--------------------------->|
      |                         |                            |
```

---

## WebSocket Protocol (Frontend ↔ Backend)

### Frontend → Backend Messages

#### Subscribe to Price Ticks
```json
{
  "type": "subscribe_price",
  "mint": "TokenMintAddress"
}
```

Subscribe to real-time price updates for a token. Backend will start forwarding price ticks from the configured data provider.

#### Unsubscribe from Price Ticks
```json
{
  "type": "unsubscribe_price",
  "mint": "TokenMintAddress"
}
```

Stop receiving price updates for a token (cleanup when popout closes).

---

### Backend → Frontend Messages

#### Price Tick Update
```json
{
  "type": "price_tick",
  "mint": "TokenMintAddress",
  "price": 0.00001234,
  "priceUsd": 0.00001234,
  "priceSol": 0.0001,
  "timestamp": 1704672000123,
  "source": "solanatracker"
}
```

**Frequency:** 10-100+ ticks per second (depending on token activity and data provider)

**Price fields:**
- `price`: Primary price (usually USD)
- `priceUsd`: USD price (explicit)
- `priceSol`: SOL price (optional, for SOL-denominated tokens)

**Source:** Data provider name (`solanatracker`, `jupiter`, `raydium`, etc.)

#### Trade/Transaction Update (Optional)
```json
{
  "type": "trade",
  "mint": "TokenMintAddress",
  "side": "buy|sell",
  "price": 0.00001234,
  "amount": 1000000,
  "amountUsd": 12.34,
  "timestamp": 1704672000123,
  "txSignature": "...",
  "wallet": "...",
  "source": "solanatracker"
}
```

Individual trades/swaps for volume calculations and trade tape display.

#### Token Stats Update (Optional)
```json
{
  "type": "token_stats",
  "mint": "TokenMintAddress",
  "marketCap": 100000,
  "liquidity": 50000,
  "volume24h": 25000,
  "priceChange1m": 5.2,
  "priceChange5m": 12.8,
  "buyVolume": 15000,
  "sellVolume": 10000,
  "holders": 523,
  "timestamp": 1704672000123,
  "source": "solanatracker"
}
```

Aggregated token metrics for stats strip display.

---

## Frontend Implementation

### 1. Candle Builder (`src/lib/candles1s.ts`)

```typescript
export class Candles1sBuilder {
  /**
   * Push a price tick into the builder
   * Automatically aggregates ticks into 1-second OHLC candles
   */
  pushTick(tick: { tsMs: number; price: number }): boolean
  
  /**
   * Get all completed candles (ring buffer, max 1200 candles = 20 minutes)
   */
  getAll(): Candle1s[]
}
```

### 2. Price Subscription (App.tsx)

```typescript
// When popout opens, subscribe to price ticks
useEffect(() => {
  if (!activePopoutMint) return
  if (!ws) return
  
  ws.send({ type: 'subscribe_price', mint: activePopoutMint })
  
  const handler = (msg: any) => {
    if (msg.type === 'price_tick' && msg.mint === activePopoutMint) {
      candleBuilder.pushTick({ 
        tsMs: msg.timestamp, 
        price: msg.price 
      })
      setPopoutCandles([...candleBuilder.getAll()])
    }
  }
  
  ws.onMessage(handler)
  
  return () => {
    ws.send({ type: 'unsubscribe_price', mint: activePopoutMint })
    ws.offMessage(handler)
  }
}, [activePopoutMint, ws])
```

### 3. Chart Rendering

```tsx
<CandlesChart 
  candles={popoutCandles} 
  markers={popoutMarkers} 
  height={220} 
/>
```

Uses `lightweight-charts` for TradingView-like candle display.

---

## Backend Implementation Requirements

### 1. Data Provider Integration

Backend must subscribe to data provider's price/trade streams:

**SolanaTracker Example:**
```javascript
// Join SolanaTracker room for price updates
const room = `price:aggregated:${mint}`
solanaTrackerWs.send({ type: 'join', room })

// Forward price ticks to subscribed clients
solanaTrackerWs.on('message', (data) => {
  if (data.room === room && data.price) {
    broadcastToClients({
      type: 'price_tick',
      mint,
      price: data.price,
      timestamp: data.time || Date.now(),
      source: 'solanatracker'
    })
  }
})
```

**Jupiter/Other Providers:**
```javascript
// Swap out provider with minimal code changes
jupiterWs.subscribe({ tokens: [mint] })
jupiterWs.on('price', (data) => {
  broadcastToClients({
    type: 'price_tick',
    mint: data.mint,
    price: data.price,
    timestamp: data.timestamp,
    source: 'jupiter'
  })
})
```

### 2. Client Subscription Management

```javascript
const priceSubscriptions = new Map() // mint -> Set<clientWs>

function handleMessage(clientWs, msg) {
  if (msg.type === 'subscribe_price') {
    const mint = msg.mint
    if (!priceSubscriptions.has(mint)) {
      priceSubscriptions.set(mint, new Set())
      // Subscribe to data provider for this mint
      subscribeToProvider(mint)
    }
    priceSubscriptions.get(mint).add(clientWs)
  }
  
  if (msg.type === 'unsubscribe_price') {
    const mint = msg.mint
    const clients = priceSubscriptions.get(mint)
    if (clients) {
      clients.delete(clientWs)
      if (clients.size === 0) {
        // No more clients, unsubscribe from provider
        unsubscribeFromProvider(mint)
        priceSubscriptions.delete(mint)
      }
    }
  }
}

function broadcastToClients(msg) {
  const clients = priceSubscriptions.get(msg.mint)
  if (clients) {
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(msg))
      }
    }
  }
}
```

### 3. Rate Limiting & Resource Management

- Limit concurrent price subscriptions per client (e.g., 3-5 max)
- Deduplicate provider subscriptions (multiple clients = 1 provider sub)
- Auto-cleanup stale subscriptions on client disconnect

---

## Migration Path (Local PC → Cloud)

### Current State (Local PC)
```
[SolanaTracker] --> [Local dequanW] --> [Browser on LAN]
                    (localhost:8900)
```

### Production State (Cloud)
```
[SolanaTracker] --> [Cloud dequanW]     --> [Browser (public)]
                    (VPS/container)
                    wss://api.dequan.xyz
```

**Migration Steps:**
1. Deploy dequanW backend to cloud (VPS, Docker, Fly.io, Railway, etc.)
2. Update frontend `VITE_DEQUANW_WS_URL` to point to cloud endpoint
3. Zero frontend code changes (architecture is cloud-agnostic)

---

## Data Provider Swap Example

### Swap from SolanaTracker to Jupiter

**Backend changes only:**
```javascript
// Old: SolanaTracker integration
// const provider = new SolanaTrackerProvider(config.solanaTrackerKey)

// New: Jupiter integration
const provider = new JupiterProvider(config.jupiterKey)

// Same interface, different provider
provider.subscribePriceFeed(mint, (tick) => {
  broadcastToClients({
    type: 'price_tick',
    mint,
    price: tick.price,
    timestamp: tick.timestamp,
    source: 'jupiter'
  })
})
```

**Frontend changes:** None (still subscribes with `subscribe_price`, receives `price_tick`)

---

## Benefits of This Architecture

✅ **Security:** API keys never exposed to browser  
✅ **Modularity:** Swap data providers without frontend changes  
✅ **Scalability:** Backend can cache, aggregate, rate-limit  
✅ **Cloud-ready:** No local dependencies, deploy anywhere  
✅ **Cost-efficient:** Deduplicated provider subscriptions  
✅ **Developer experience:** Clean separation of concerns  

---

## Next Steps

1. ✅ Update build docs to reflect modular architecture
2. ⏳ Implement `subscribe_price` / `unsubscribe_price` handlers in dequanW Trading API
3. ⏳ Integrate price feed forwarding from data provider (SolanaTracker first)
4. ⏳ Update frontend to use price subscription (remove quote polling hack)
5. ⏳ Test candle chart with real-time data
6. ⏳ Deploy to production (Cloudflare Pages + cloud backend)
