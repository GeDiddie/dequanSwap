# Data Gateway Production Deployment

**Service**: dequanW Data Gateway  
**Purpose**: Real-time token metrics aggregation for dequanSwap frontend  
**Production URL**: `wss://dequandata.dequan.xyz`  
**Local Port**: 8913  
**Deployment Method**: Cloudflare Tunnel

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  Frontend (dequanSwap)                          │
│            https://snipe.dequan.xyz                             │
│         (Cloudflare Pages - Global CDN)                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ wss://dequandata.dequan.xyz
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Cloudflare Tunnel (Global Edge)                    │
│         Tunnel ID: 5e611e8c-f66c-499d-a7fb-ef66c0a0c3a2         │
│                                                                 │
│  Routes:                                                        │
│    • dequanw-api.dequan.xyz → localhost:8901                    │
│    • dequantrade-ws.dequan.xyz → localhost:8900                 │
│    • dequandata.dequan.xyz → localhost:8913  ⬅ Data Gateway    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ localhost:8913
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│           Data Gateway (Node.js WebSocket Server)               │
│                  ~/bot/jul2025/dequanW-data-gateway/            │
│                                                                 │
│  Features:                                                      │
│    • Aggregates 13 SolanaTracker rooms per token                │
│    • Transaction buffering (5-minute window)                    │
│    • Metrics: TPS, liquidity, holders, volume, dev/sniper %     │
│    • TokenMetricsMessage events                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │ wss://datastream.solanatracker.io
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              SolanaTracker Premium Datastream                   │
│                                                                 │
│  Subscribed Rooms (13 per token):                              │
│    • holders, top10, transaction, pool                          │
│    • dev, sniper, insider, fees, curve                          │
│    • tokenPrimary, token:primary, tokenStats, token:stats       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Cloudflare Tunnel Configuration

### Location
`/etc/cloudflared/config.yml`

### Current Configuration
```yaml
tunnel: 5e611e8c-f66c-499d-a7fb-ef66c0a0c3a2
credentials-file: /home/g1/.cloudflared/5e611e8c-f66c-499d-a7fb-ef66c0a0c3a2.json
protocol: http2

ingress:
  # dequanW API-Lite (fast feed/watching endpoints on 8912)
  - hostname: dequanw-api.dequan.xyz
    service: http://localhost:8912

  # trading API / WebSocket (8900)
  - hostname: dequantrade-ws.dequan.xyz
    service: http://localhost:8900

  # data gateway / WebSocket (8913)
  - hostname: dequandata.dequan.xyz
    service: http://localhost:8913

  - service: http_status:404
```

### Restart Tunnel After Config Changes
```bash
sudo systemctl restart cloudflared
sudo systemctl status cloudflared
```

---

## DNS Configuration

### Cloudflare Dashboard Setup
1. Go to: https://dash.cloudflare.com
2. Select domain: **dequan.xyz**
3. Navigate to: **DNS > Records**
4. Click: **Add record**

### DNS Record Settings
| Field | Value |
|-------|-------|
| **Type** | CNAME |
| **Name** | `dequandata` |
| **Target** | `5e611e8c-f66c-499d-a7fb-ef66c0a0c3a2.cfargotunnel.com` |
| **Proxy status** | ✅ Proxied (orange cloud) |
| **TTL** | Auto |

### Verify DNS Propagation
```bash
dig dequandata.dequan.xyz
# Should return Cloudflare proxy IPs

curl -I https://dequandata.dequan.xyz
# Should return "426 Upgrade Required" (normal for WebSocket endpoint)
```

---

## Frontend Configuration

### Development (Local)
**File**: `dequanSwap/.env.local`
```bash
VITE_DATA_GATEWAY_URL=ws://localhost:8913
```

### Production (Cloudflare Pages)
**File**: `dequanSwap/src/App.tsx` (hardcoded)
```typescript
const dataGatewayUrl = useMemo(() => {
  if (import.meta.env.DEV) return 'ws://localhost:8913'
  return 'wss://dequandata.dequan.xyz'  // Production
}, [])
```

**Note**: URL is baked into build. Environment variable `VITE_DATA_GATEWAY_URL` documented in `.env.production` but not actively used (hardcoded for reliability).

---

## Starting the Data Gateway

### Check if Running
```bash
# Check process
lsof -i :8913
ps aux | grep data-gateway

# Test endpoint
curl -v http://localhost:8913
# Should return: "HTTP/1.1 426 Upgrade Required"
```

### Start Service
```bash
cd ~/bot/jul2025/dequanW-data-gateway
npm start
```

**Output**:
```
[DataGateway] Starting on 0.0.0.0:8913...
[SolanaTrackerAdapter] Initialized with URL: wss://datastream.solanatracker.io/...
[SolanaTrackerAdapter] Connected!
[DataGateway] Ready at ws://0.0.0.0:8913
```

### PM2 Management (Optional)
```bash
# Add to PM2
pm2 start npm --name "data-gateway" -- start
pm2 save

# Manage
pm2 restart data-gateway
pm2 logs data-gateway
pm2 stop data-gateway
```

---

## Data Flow

### Frontend Subscription
```typescript
// dequanSwap/src/App.tsx
const gateway = new DataGatewayWs({ url: 'wss://dequandata.dequan.xyz' })
await gateway.connect()
gateway.subscribe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') // USDC

gateway.onToken('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', (data) => {
  console.log('TPS:', data.tx5m / 300)
  console.log('Liquidity:', data.liquidityUsd)
  console.log('Holders:', data.holders)
})
```

### Gateway Message Format
```typescript
interface TokenMetricsMessage {
  type: 'token_metrics'
  mint: string
  timestamp: number
  
  // Transaction metrics (5min window)
  tx5m?: number              // Total transactions
  vol5mUsd?: number          // Volume USD
  
  // Token metrics
  liquidityUsd?: number      // Pool liquidity
  holders?: number           // Holder count
  top10Pct?: number          // Top 10 holder %
  
  // Developer metrics
  devPct?: number            // Dev wallet %
  sniperPct?: number         // Sniper %
  insiderPct?: number        // Insider %
  
  // Pool metrics
  feesUsd?: number           // Fees collected
  curvePct?: number          // Bonding curve %
  graduating?: boolean       // Migrating to Raydium
  graduated?: boolean        // Migration complete
  primaryPoolId?: string     // Main pool ID
}
```

---

## Monitoring & Debugging

### Check Tunnel Status
```bash
sudo systemctl status cloudflared
sudo journalctl -u cloudflared -f
```

### Check Data Gateway Logs
```bash
# If running via npm
tail -f ~/bot/jul2025/dequanW-data-gateway/gateway.log

# If running via PM2
pm2 logs data-gateway
```

### Test WebSocket Connection
```bash
# Install wscat if needed
npm install -g wscat

# Connect to local gateway
wscat -c ws://localhost:8913

# Send subscription
> {"type":"subscribe_token","mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"}

# Should receive token_metrics messages
< {"type":"token_metrics","mint":"EPj...","tx5m":1234,...}
```

### Browser Console (Production)
```javascript
// Open DevTools Console at https://snipe.dequan.xyz
// WebSocket connection auto-established when viewing token

// Check connection
window._dataGateway?.ws?.readyState
// 1 = OPEN, 0 = CONNECTING, 2 = CLOSING, 3 = CLOSED

// Monitor messages
window._dataGateway?.onMessage((msg) => console.log('Gateway:', msg))
```

---

## Security Best Practices

### 1. **No Authentication Required**
- Data Gateway provides **public market data only**
- No private keys, user data, or sensitive operations
- Read-only metrics aggregation

### 2. **Cloudflare DDoS Protection**
- All requests pass through Cloudflare edge
- Automatic DDoS mitigation
- Rate limiting at proxy layer

### 3. **WebSocket-Only Protocol**
- HTTP requests return 426 (expected behavior)
- Prevents accidental HTTP exposure
- Clear protocol separation

### 4. **SolanaTracker API Key Management**
- Keys stored in `dequanW-data-gateway/.env`
- Never exposed to frontend
- Used server-side only

### 5. **Process Isolation**
- Data Gateway runs separate from Trading API
- Independent restart/scale without affecting order execution
- Separate logs and error boundaries

---

## Troubleshooting

### Issue: "426 Upgrade Required" in Browser
**Cause**: Trying to access WebSocket endpoint via HTTP  
**Solution**: This is **normal** - WebSocket servers return 426 to HTTP requests. Frontend connects via `wss://` protocol.

### Issue: "Connection Refused"
**Check**:
1. Data Gateway running? `lsof -i :8913`
2. Cloudflare Tunnel active? `sudo systemctl status cloudflared`
3. DNS configured? `dig dequandata.dequan.xyz`

### Issue: No Metrics Data in UI
**Check**:
1. Browser console for WebSocket errors
2. Data Gateway logs: `pm2 logs data-gateway`
3. SolanaTracker connection: Check logs for "Connected!"
4. Frontend subscription: Should see "subscribe_token" in gateway logs

### Issue: Port Already in Use
```bash
# Find process using port 8913
lsof -i :8913

# Kill if needed (find PID from above)
kill <PID>

# Restart gateway
npm start
```

---

## Performance Optimization

### Transaction Buffer Management
- **Window**: 5 minutes rolling
- **Cleanup**: Every 30 seconds
- **Purpose**: Accurate TPS and volume calculations

### Connection Pooling
- Single upstream SolanaTracker connection
- Multiplexed client subscriptions
- Efficient room management (subscribe on first client, unsubscribe when last client leaves)

### Data Caching (Future)
- 10-second TTL for repeated subscriptions
- Reduces upstream API calls
- Improves response time for popular tokens

---

## Deployment Checklist

- [x] Data Gateway running on port 8913
- [x] Cloudflare Tunnel config updated
- [x] Tunnel service restarted
- [ ] DNS CNAME record added in Cloudflare Dashboard
- [x] Frontend updated with production URL
- [x] Frontend built and deployed
- [ ] DNS propagation verified (2-5 minutes)
- [ ] Test WebSocket connection from production frontend
- [ ] Monitor gateway logs for client connections
- [ ] Verify TPS/Liquidity data appears in UI

---

## Related Documentation

- [Trading API Deployment](../../jul2025/dequanW/tradingAPI/PUBLIC_DEPLOYMENT.md)
- [Data Gateway Architecture](../../jul2025/dequanW-data-gateway/README.md)
- [Trading API Integration](./docs/trading-api/TRADING_API_INTEGRATION.md)
- [Master Build Checklist](./docs/product/MASTER_BUILD_CHECKLIST.md)

---

**Last Updated**: January 8, 2026  
**Deployment Date**: January 8, 2026  
**Status**: ✅ Production Ready (pending DNS propagation)
