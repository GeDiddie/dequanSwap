/**
 * Data Gateway WebSocket Client
 * 
 * Connects to dequanW Data Gateway for unified token metrics.
 * Replaces direct SolanaTracker connections with provider-agnostic backend.
 */

export type DataGatewayWsOptions = {
  url: string
  reconnectMinMs?: number
  reconnectMaxMs?: number
}

export type TokenMetricsMessage = {
  type: 'token_metrics'
  mint: string
  timestamp: number
  
  // Core metrics
  holders: number | null
  liquidityUsd: number | null
  marketCapUsd?: number | null
  priceUsd?: number | null
  
  // Transaction/volume metrics
  tx5m: number | null
  vol5mUsd: number | null
  
  // Holder concentration
  top10Pct?: number | null
  devPct?: number | null
  sniperPct?: number | null
  insiderPct?: number | null
  
  // Bonding curve (Pump.fun)
  curvePct?: number | null
  graduating?: boolean | null
  graduated?: boolean | null
  
  // Fees
  feesUsd?: number | null
  
  // Extended metrics
  volume24hUsd?: number | null
  priceChange24h?: number | null
  
  // Pool info
  primaryPoolId?: string | null
  primaryPoolDex?: string | null
  
  // Metadata
  source: 'solanatracker' | 'helius' | 'dequanw' | 'mock'
  confidence: 'high' | 'medium' | 'low'
  staleMs?: number
}

export type DataGatewayMessage =
  | { type: 'subscribed'; mint: string; source?: string }
  | { type: 'unsubscribed'; mint: string }
  | { type: 'error'; code: string; message: string; mint?: string }
  | TokenMetricsMessage

export class DataGatewayWs {
  private ws: WebSocket | null = null
  private readonly url: string
  private readonly reconnectMinMs: number
  private readonly reconnectMaxMs: number

  private readonly mintListeners = new Map<string, Set<(data: TokenMetricsMessage) => void>>()
  private readonly globalListeners = new Set<(msg: DataGatewayMessage) => void>()

  private reconnectTimer: number | null = null
  private destroyed = false

  constructor(opts: DataGatewayWsOptions) {
    this.url = opts.url
    this.reconnectMinMs = opts.reconnectMinMs ?? 1000
    this.reconnectMaxMs = opts.reconnectMaxMs ?? 6000
  }

  get endpointUrl() {
    return this.url
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Listen for metrics updates for a specific token
   */
  onToken(mint: string, fn: (data: TokenMetricsMessage) => void): () => void {
    const m = String(mint || '').trim()
    if (!m) return () => {}
    
    const set = this.mintListeners.get(m) ?? new Set()
    set.add(fn)
    this.mintListeners.set(m, set)
    
    return () => {
      const cur = this.mintListeners.get(m)
      if (!cur) return
      cur.delete(fn)
      if (cur.size === 0) this.mintListeners.delete(m)
    }
  }

  /**
   * Listen for all gateway messages
   */
  onMessage(fn: (msg: DataGatewayMessage) => void): () => void {
    this.globalListeners.add(fn)
    return () => {
      this.globalListeners.delete(fn)
    }
  }

  async connect(): Promise<void> {
    if (this.destroyed) throw new Error('DataGatewayWs destroyed')
    if (this.isOpen) return

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url)
      this.ws = ws

      const cleanup = () => {
        ws.removeEventListener('open', onOpen)
        ws.removeEventListener('error', onError)
      }

      const onOpen = () => {
        cleanup()
        
        // Resubscribe to all active mints
        for (const mint of this.mintListeners.keys()) {
          this.sendSubscribe(ws, mint)
        }

        // Notify listeners
        for (const fn of this.globalListeners) {
          try {
            fn({ type: 'subscribed', mint: '', source: 'gateway' })
          } catch {
            // ignore
          }
        }
        
        resolve()
      }

      const onError = () => {
        cleanup()
        reject(new Error('Data Gateway WS connection error'))
      }

      ws.addEventListener('open', onOpen)
      ws.addEventListener('error', onError)

      ws.addEventListener('close', () => {
        // Notify listeners
        for (const fn of this.globalListeners) {
          try {
            fn({ type: 'error', code: 'disconnected', message: 'Gateway disconnected' })
          } catch {
            // ignore
          }
        }

        if (!this.destroyed) {
          this.scheduleReconnect()
        }
      })

      ws.addEventListener('error', () => {
        for (const fn of this.globalListeners) {
          try {
            fn({ type: 'error', code: 'ws_error', message: 'WebSocket error' })
          } catch {
            // ignore
          }
        }
      })

      ws.addEventListener('message', (event) => {
        let parsed: DataGatewayMessage | null = null
        try {
          parsed = JSON.parse(String(event.data)) as DataGatewayMessage
        } catch {
          return
        }

        if (!parsed || typeof parsed !== 'object') return

        // Broadcast to global listeners
        for (const fn of this.globalListeners) {
          try {
            fn(parsed)
          } catch {
            // ignore
          }
        }

        // Handle token_metrics messages
        if (parsed.type === 'token_metrics') {
          const metrics = parsed as TokenMetricsMessage
          const listeners = this.mintListeners.get(metrics.mint)
          if (listeners && listeners.size) {
            for (const fn of listeners) {
              try {
                fn(metrics)
              } catch {
                // ignore
              }
            }
          }
        }
      })
    })
  }

  /**
   * Subscribe to token metrics
   */
  subscribe(mint: string) {
    const m = String(mint || '').trim()
    if (!m) return
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSubscribe(this.ws, m)
    }
  }

  /**
   * Unsubscribe from token metrics
   */
  unsubscribe(mint: string) {
    const m = String(mint || '').trim()
    if (!m) return
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendUnsubscribe(this.ws, m)
    }
  }

  destroy() {
    this.destroyed = true
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    
    try {
      this.ws?.close()
    } catch {
      // ignore
    }
    
    this.ws = null
    this.mintListeners.clear()
    this.globalListeners.clear()
  }

  private sendSubscribe(ws: WebSocket, mint: string) {
    try {
      ws.send(JSON.stringify({ type: 'subscribe_token', mint }))
    } catch {
      // ignore
    }
  }

  private sendUnsubscribe(ws: WebSocket, mint: string) {
    try {
      ws.send(JSON.stringify({ type: 'unsubscribe_token', mint }))
    } catch {
      // ignore
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    
    const delay = Math.floor(
      this.reconnectMinMs + Math.random() * Math.max(0, this.reconnectMaxMs - this.reconnectMinMs),
    )
    
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      if (this.destroyed) return
      
      this.connect().catch(() => {
        if (!this.destroyed) this.scheduleReconnect()
      })
    }, delay)
  }
}
