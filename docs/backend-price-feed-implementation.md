# Backend Price Feed Implementation Guide

This document describes how to implement real-time price feed streaming in the dequanW Trading API to support the popout candle charts.

---

## Overview

The Trading API WebSocket server must:
1. Accept `subscribe_price` / `unsubscribe_price` messages from clients
2. Subscribe to data provider (SolanaTracker, Jupiter, etc.) for requested tokens
3. Forward high-frequency price ticks to subscribed clients
4. Manage subscriptions efficiently (deduplicate, cleanup)

---

## Message Handlers

Add these handlers to your existing Trading API WebSocket server (typically in `tradingAPI/server.js` or equivalent):

```javascript
import EventEmitter from 'eventemitter3'

// Tracks which clients are subscribed to which tokens
const priceSubscriptions = new Map() // mint -> Set<WebSocket>

// Tracks which tokens we're actively monitoring from the data provider
const activeProviderSubscriptions = new Set() // Set<mint>

// Event emitter for provider price updates
const providerEmitter = new EventEmitter()

/**
 * Handle incoming client messages
 */
function handleClientMessage(ws, message) {
  try {
    const msg = JSON.parse(message)
    
    switch (msg.type) {
      case 'subscribe_price':
        handleSubscribePrice(ws, msg.mint)
        break
        
      case 'unsubscribe_price':
        handleUnsubscribePrice(ws, msg.mint)
        break
        
      // ... existing handlers (quote, build_swap_tx, etc.)
    }
  } catch (error) {
    logger.error('[PriceFeed] Error handling message:', error)
  }
}

/**
 * Subscribe client to price updates for a token
 */
function handleSubscribePrice(ws, mint) {
  if (!mint || typeof mint !== 'string') {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'Invalid mint address',
      code: 'invalid_mint'
    }))
    return
  }
  
  logger.info(`[PriceFeed] Client subscribing to ${mint.slice(0, 8)}...`)
  
  // Add client to subscription set
  if (!priceSubscriptions.has(mint)) {
    priceSubscriptions.set(mint, new Set())
  }
  priceSubscriptions.get(mint).add(ws)
  
  // If this is the first subscriber for this mint, start provider subscription
  if (!activeProviderSubscriptions.has(mint)) {
    subscribeToProvider(mint)
    activeProviderSubscriptions.add(mint)
  }
  
  // Send confirmation
  ws.send(JSON.stringify({
    type: 'subscribed',
    mint,
    timestamp: Date.now()
  }))
}

/**
 * Unsubscribe client from price updates
 */
function handleUnsubscribePrice(ws, mint) {
  if (!mint) return
  
  logger.info(`[PriceFeed] Client unsubscribing from ${mint.slice(0, 8)}...`)
  
  const clients = priceSubscriptions.get(mint)
  if (clients) {
    clients.delete(ws)
    
    // If no more clients subscribed, stop provider subscription
    if (clients.size === 0) {
      priceSubscriptions.delete(mint)
      unsubscribeFromProvider(mint)
      activeProviderSubscriptions.delete(mint)
    }
  }
}

/**
 * Cleanup all subscriptions for a disconnected client
 */
function cleanupClientSubscriptions(ws) {
  for (const [mint, clients] of priceSubscriptions.entries()) {
    if (clients.has(ws)) {
      clients.delete(ws)
      
      if (clients.size === 0) {
        priceSubscriptions.delete(mint)
        unsubscribeFromProvider(mint)
        activeProviderSubscriptions.delete(mint)
      }
    }
  }
}

// Register cleanup on client disconnect
wss.on('connection', (ws) => {
  ws.on('close', () => cleanupClientSubscriptions(ws))
  ws.on('error', () => cleanupClientSubscriptions(ws))
})
```

---

## Data Provider Integration (SolanaTracker)

### Option A: Reuse Existing WebSocketService

If you already have `WebSocketService` for SolanaTracker (from dequanBuy/dequanSell modules):

```javascript
import WebSocketService from '../shared/WebSocketService.js'

const solanaTrackerWsUrl = 'wss://datastream.solanatracker.io/YOUR_KEY_HERE'
const solanaTrackerWs = new WebSocketService(solanaTrackerWsUrl)

function subscribeToProvider(mint) {
  const room = `price:aggregated:${mint}`
  
  // Listen for price updates from SolanaTracker
  solanaTrackerWs.on(room, (data) => {
    // Extract price from SolanaTracker data structure
    const price = data.aggregated?.median || data.price || 0
    const priceUsd = data.aggregated?.median || 0
    const priceSol = data.price || 0
    
    if (price > 0) {
      // Broadcast to all subscribed clients
      broadcastPriceTick({
        mint,
        price: priceUsd,
        priceUsd,
        priceSol,
        timestamp: data.time || Date.now(),
        source: 'solanatracker'
      })
    }
  })
  
  // Join the room
  solanaTrackerWs.joinRoom(room)
  logger.info(`[PriceFeed] Subscribed to SolanaTracker room: ${room}`)
}

function unsubscribeFromProvider(mint) {
  const room = `price:aggregated:${mint}`
  solanaTrackerWs.leaveRoom(room)
  logger.info(`[PriceFeed] Unsubscribed from SolanaTracker room: ${room}`)
}
```

### Option B: Direct WebSocket Integration

If you prefer direct WebSocket management:

```javascript
import WebSocket from 'ws'

const solanaTrackerWsUrl = 'wss://datastream.solanatracker.io/YOUR_KEY_HERE'
let providerWs = null

function ensureProviderConnection() {
  if (providerWs && providerWs.readyState === WebSocket.OPEN) {
    return providerWs
  }
  
  providerWs = new WebSocket(solanaTrackerWsUrl)
  
  providerWs.on('open', () => {
    logger.info('[PriceFeed] Connected to SolanaTracker')
  })
  
  providerWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data)
      
      // Handle price:aggregated:{mint} room messages
      if (msg.room && msg.room.startsWith('price:aggregated:')) {
        const mint = msg.room.split(':')[2]
        const price = msg.aggregated?.median || msg.price || 0
        
        if (price > 0) {
          broadcastPriceTick({
            mint,
            price,
            priceUsd: msg.aggregated?.median || 0,
            priceSol: msg.price || 0,
            timestamp: msg.time || Date.now(),
            source: 'solanatracker'
          })
        }
      }
    } catch (error) {
      logger.error('[PriceFeed] Error parsing provider message:', error)
    }
  })
  
  providerWs.on('close', () => {
    logger.warn('[PriceFeed] Disconnected from SolanaTracker, reconnecting...')
    setTimeout(ensureProviderConnection, 5000)
  })
  
  providerWs.on('error', (error) => {
    logger.error('[PriceFeed] Provider error:', error)
  })
  
  return providerWs
}

function subscribeToProvider(mint) {
  const ws = ensureProviderConnection()
  
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'join',
      room: `price:aggregated:${mint}`
    }))
  } else {
    ws.once('open', () => {
      ws.send(JSON.stringify({
        type: 'join',
        room: `price:aggregated:${mint}`
      }))
    })
  }
}

function unsubscribeFromProvider(mint) {
  if (providerWs && providerWs.readyState === WebSocket.OPEN) {
    providerWs.send(JSON.stringify({
      type: 'leave',
      room: `price:aggregated:${mint}`
    }))
  }
}
```

---

## Broadcasting to Clients

```javascript
/**
 * Broadcast a price tick to all subscribed clients
 */
function broadcastPriceTick(tickData) {
  const { mint, price, priceUsd, priceSol, timestamp, source } = tickData
  
  const clients = priceSubscriptions.get(mint)
  if (!clients || clients.size === 0) return
  
  const message = JSON.stringify({
    type: 'price_tick',
    mint,
    price,
    priceUsd,
    priceSol,
    timestamp,
    source
  })
  
  let broadcastCount = 0
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message)
      broadcastCount++
    }
  }
  
  // Optionally log at debug level (high frequency)
  if (broadcastCount > 0) {
    logger.debug(`[PriceFeed] Broadcasted ${mint.slice(0, 8)}... price ${price} to ${broadcastCount} clients`)
  }
}
```

---

## Rate Limiting & Resource Management

### Limit Concurrent Subscriptions Per Client

```javascript
const MAX_SUBS_PER_CLIENT = 5

function handleSubscribePrice(ws, mint) {
  // Count current subscriptions for this client
  let clientSubCount = 0
  for (const [_, clients] of priceSubscriptions) {
    if (clients.has(ws)) clientSubCount++
  }
  
  if (clientSubCount >= MAX_SUBS_PER_CLIENT) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Maximum concurrent price subscriptions reached',
      code: 'subscription_limit_exceeded',
      limit: MAX_SUBS_PER_CLIENT
    }))
    return
  }
  
  // ... rest of subscribe logic
}
```

### Periodic Cleanup of Stale Subscriptions

```javascript
// Clean up every 60 seconds
setInterval(() => {
  for (const [mint, clients] of priceSubscriptions.entries()) {
    // Remove closed clients
    for (const ws of clients) {
      if (ws.readyState !== WebSocket.OPEN) {
        clients.delete(ws)
      }
    }
    
    // If no clients remain, cleanup provider subscription
    if (clients.size === 0) {
      priceSubscriptions.delete(mint)
      unsubscribeFromProvider(mint)
      activeProviderSubscriptions.delete(mint)
      logger.info(`[PriceFeed] Auto-cleanup: unsubscribed from ${mint.slice(0, 8)}...`)
    }
  }
}, 60_000)
```

---

## Testing the Implementation

### 1. Start Trading API Server

```bash
cd ~/bot/jul2025/dequanW
pm2 restart trading-api --update-env
pm2 logs trading-api
```

### 2. Test with WebSocket Client

```javascript
const WebSocket = require('ws')

const ws = new WebSocket('ws://localhost:8900')

ws.on('open', () => {
  console.log('Connected to Trading API')
  
  // Subscribe to price feed
  ws.send(JSON.stringify({
    type: 'subscribe_price',
    mint: 'So11111111111111111111111111111111111111112' // SOL mint (for testing)
  }))
})

ws.on('message', (data) => {
  const msg = JSON.parse(data)
  
  if (msg.type === 'price_tick') {
    console.log(`[Price Tick] ${msg.mint.slice(0, 8)}... = $${msg.price} @ ${new Date(msg.timestamp).toISOString()}`)
  } else {
    console.log('Message:', msg)
  }
})

// Unsubscribe after 30 seconds
setTimeout(() => {
  ws.send(JSON.stringify({
    type: 'unsubscribe_price',
    mint: 'So11111111111111111111111111111111111111112'
  }))
  
  setTimeout(() => ws.close(), 1000)
}, 30_000)
```

---

## Configuration

Add to your Trading API `.env` or config:

```bash
# Data provider (solanatracker, jupiter, etc.)
DATA_PROVIDER=solanatracker

# SolanaTracker config
SOLANATRACKER_DATASTREAM_KEY=your_key_here

# Price feed settings
PRICE_FEED_MAX_SUBS_PER_CLIENT=5
PRICE_FEED_CLEANUP_INTERVAL_MS=60000
```

---

## Next Steps

1. ✅ Implement handlers in Trading API server
2. ⏳ Test with simple WebSocket client
3. ⏳ Update frontend to use `subscribe_price` (remove quote polling)
4. ⏳ Deploy and test in production
5. ⏳ Monitor performance and resource usage

---

## Appendix: Alternative Providers

### Jupiter Price Feed

```javascript
// Jupiter doesn't have a public WebSocket yet, but you can poll their API
async function subscribeToJupiterPrice(mint) {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`https://price.jup.ag/v4/price?ids=${mint}`)
      const data = await res.json()
      const price = data.data[mint]?.price
      
      if (price) {
        broadcastPriceTick({
          mint,
          price,
          priceUsd: price,
          priceSol: null,
          timestamp: Date.now(),
          source: 'jupiter'
        })
      }
    } catch (error) {
      logger.error('[PriceFeed] Jupiter fetch error:', error)
    }
  }, 1000) // Poll every second
  
  jupiterIntervals.set(mint, interval)
}
```

### Raydium WebSocket

```javascript
// Raydium pool monitoring via Solana accountSubscribe
import { Connection, PublicKey } from '@solana/web3.js'

const connection = new Connection(process.env.SOLANA_RPC_URL)

function subscribeToRaydiumPool(poolAddress) {
  const subscription = connection.onAccountChange(
    new PublicKey(poolAddress),
    (accountInfo) => {
      // Parse pool account data to extract price
      // (requires Raydium pool layout parsing)
      const price = parseRaydiumPoolPrice(accountInfo.data)
      
      broadcastPriceTick({
        mint: tokenMint,
        price,
        priceUsd: price,
        priceSol: null,
        timestamp: Date.now(),
        source: 'raydium'
      })
    },
    'confirmed'
  )
  
  raydiumSubscriptions.set(poolAddress, subscription)
}
```
