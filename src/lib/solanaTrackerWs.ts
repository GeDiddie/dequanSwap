export type SolanaTrackerWsOptions = {
  datastreamKey?: string
  /**
   * Optional full WebSocket URL to connect to (e.g. a server-side proxy).
   * If provided, `datastreamKey` is ignored.
   */
  url?: string
  baseUrl?: string
  /**
   * NOTE: SolanaTracker Datastream does not define a JSON ping/pong message.
   * Leave unset/0 to disable app-level heartbeats.
   */
  heartbeatMs?: number
  reconnectMinMs?: number
  reconnectMaxMs?: number
}

type AnyJson = Record<string, unknown>

export type SolanaTrackerWsMessage =
  | { type: 'message'; room?: string; data?: AnyJson }
  | { type: 'joined'; room?: string }
  | { type: 'error'; message?: string; code?: string }
  | { type: 'open' }
  | { type: 'close'; code?: number; reason?: string }
  | (AnyJson & { type?: string })

export class SolanaTrackerWs {
  private ws: WebSocket | null = null
  private readonly url: string
  private readonly heartbeatMs: number
  private readonly reconnectMinMs: number
  private readonly reconnectMaxMs: number

  private readonly roomListeners = new Map<string, Set<(data: AnyJson) => void>>()
  private readonly globalListeners = new Set<(msg: SolanaTrackerWsMessage) => void>()

  // We allow callers to "join" multiple alias room names (because the `room` string
  // on incoming messages can vary). Under the hood, the upstream subscription is
  // based on a token/pool and should be ref-counted.
  private readonly roomToSubKey = new Map<string, string>()
  private readonly subKeyCounts = new Map<string, number>()

  private reconnectTimer: number | null = null
  private heartbeatTimer: number | null = null
  private destroyed = false

  private lastOpenMs: number | null = null
  private sawDataMessageSinceOpen = false
  private immediateUpstreamCloseCount = 0

  constructor(opts: SolanaTrackerWsOptions) {
    const explicitUrl = String(opts.url || '').trim()
    if (explicitUrl) {
      this.url = explicitUrl
    } else {
      const base = (opts.baseUrl || 'wss://datastream.solanatracker.io').replace(/\/$/, '')
      const key = String(opts.datastreamKey || '').trim()
      if (!key) throw new Error('Missing SolanaTracker datastream key')
      this.url = `${base}/${encodeURIComponent(key)}`
    }
    // Default: disabled. Browsers cannot send WebSocket ping frames, and the
    // Datastream protocol does not specify JSON ping messages.
    this.heartbeatMs = opts.heartbeatMs ?? 0
    this.reconnectMinMs = opts.reconnectMinMs ?? 1_000
    this.reconnectMaxMs = opts.reconnectMaxMs ?? 6_000
  }

  get endpointUrl() {
    return this.url
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  onRoom(room: string, fn: (data: AnyJson) => void): () => void {
    const r = String(room || '').trim()
    if (!r) return () => {}
    const set = this.roomListeners.get(r) ?? new Set()
    set.add(fn)
    this.roomListeners.set(r, set)
    return () => {
      const cur = this.roomListeners.get(r)
      if (!cur) return
      cur.delete(fn)
      if (cur.size === 0) this.roomListeners.delete(r)
    }
  }

  onMessage(fn: (msg: SolanaTrackerWsMessage) => void): () => void {
    this.globalListeners.add(fn)
    return () => {
      this.globalListeners.delete(fn)
    }
  }

  async connect(): Promise<void> {
    if (this.destroyed) throw new Error('SolanaTrackerWs destroyed')
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
        this.lastOpenMs = Date.now()
        this.sawDataMessageSinceOpen = false
        this.startHeartbeat()
        // resubscribe
        for (const subKey of this.subKeyCounts.keys()) {
          this.sendJoinForSubKey(ws, subKey)
        }

        if (this.globalListeners.size) {
          for (const fn of this.globalListeners) {
            try {
              fn({ type: 'open' })
            } catch {
              // ignore
            }
          }
        }
        resolve()
      }

      const onError = () => {
        cleanup()
        reject(new Error('SolanaTracker WS connection error'))
      }

      ws.addEventListener('open', onOpen)
      ws.addEventListener('error', onError)

      ws.addEventListener('close', (evt) => {
        this.stopHeartbeat()

        const now = Date.now()
        const openAge = this.lastOpenMs ? now - this.lastOpenMs : Number.POSITIVE_INFINITY
        const reason = String(evt.reason || '')
        const isUpstream1000 = reason.startsWith('upstream_close:1000')
        if (!this.sawDataMessageSinceOpen && isUpstream1000 && openAge < 1500) {
          this.immediateUpstreamCloseCount += 1
        } else {
          this.immediateUpstreamCloseCount = 0
        }

        if (this.globalListeners.size) {
          for (const fn of this.globalListeners) {
            try {
              fn({ type: 'close', code: evt.code, reason: evt.reason })
            } catch {
              // ignore
            }
          }
        }

        if (!this.destroyed) {
          if (this.immediateUpstreamCloseCount >= 3) {
            for (const fn of this.globalListeners) {
              try {
                fn({
                  type: 'error',
                  message:
                    'Datastream closed immediately (upstream_close:1000). This usually means the SolanaTracker Datastream key is invalid/unauthorized or your plan is not entitled to Datastream (Premium+).',
                })
              } catch {
                // ignore
              }
            }
            return
          }
          this.scheduleReconnect()
        }
      })

      ws.addEventListener('error', () => {
        if (this.globalListeners.size) {
          for (const fn of this.globalListeners) {
            try {
              fn({ type: 'error', message: 'WebSocket error' })
            } catch {
              // ignore
            }
          }
        }
      })

      ws.addEventListener('message', (event) => {
        let parsedAny: AnyJson | null = null
        try {
          parsedAny = JSON.parse(String(event.data)) as AnyJson
        } catch {
          return
        }

        if (!parsedAny || typeof parsedAny !== 'object') return

        // Normalize message shape: upstream may send `{ room, data }` without `type: 'message'`.
        const rawType = (parsedAny as { type?: unknown }).type
        const inferredType =
          typeof rawType === 'string'
            ? rawType
            : typeof (parsedAny as { room?: unknown }).room === 'string' &&
                typeof (parsedAny as { data?: unknown }).data === 'object' &&
                (parsedAny as { data?: unknown }).data
              ? 'message'
              : undefined

        const parsed = (inferredType ? ({ ...parsedAny, type: inferredType } as SolanaTrackerWsMessage) : (parsedAny as SolanaTrackerWsMessage))

        if (this.globalListeners.size) {
          for (const fn of this.globalListeners) {
            try {
              fn(parsed)
            } catch {
              // ignore
            }
          }
        }

        if (parsed && (parsed as AnyJson).type === 'message') {
          const room = typeof (parsed as { room?: unknown }).room === 'string' ? String((parsed as { room: string }).room) : ''
          const data =
            typeof (parsed as { data?: unknown }).data === 'object' && (parsed as { data?: unknown }).data
              ? ((parsed as { data: AnyJson }).data as AnyJson)
              : null
          if (!room || !data) return

          this.sawDataMessageSinceOpen = true
          const listeners = this.roomListeners.get(room)
          if (listeners && listeners.size) {
            for (const fn of listeners) {
              try {
                fn(data)
              } catch {
                // ignore
              }
            }
          }
        }
      })
    })
  }

  join(room: string) {
    const r = String(room || '').trim()
    if (!r) return
    const subKey = this.computeSubKey(r)
    if (!subKey) return
    this.roomToSubKey.set(r, subKey)
    const next = (this.subKeyCounts.get(subKey) ?? 0) + 1
    this.subKeyCounts.set(subKey, next)
    if (next === 1 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendJoinForSubKey(this.ws, subKey)
    }
  }

  leave(room: string) {
    const r = String(room || '').trim()
    if (!r) return
    const subKey = this.roomToSubKey.get(r)
    this.roomToSubKey.delete(r)
    if (!subKey) return
    const cur = this.subKeyCounts.get(subKey) ?? 0
    if (cur <= 1) {
      this.subKeyCounts.delete(subKey)
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendLeaveForSubKey(this.ws, subKey)
      }
      return
    }
    this.subKeyCounts.set(subKey, cur - 1)
  }

  destroy() {
    this.destroyed = true
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.stopHeartbeat()
    try {
      this.ws?.close()
    } catch {
      // ignore
    }
    this.ws = null
    this.roomToSubKey.clear()
    this.subKeyCounts.clear()
    this.roomListeners.clear()
    this.globalListeners.clear()
  }

  private computeSubKey(room: string): string | null {
    // Canonicalize "room-like" strings to the documented room format.
    // Join/leave always use { type: 'join'|'leave', room: '...' }.

    // Aggregated price
    const pa = room.match(/^(?:price:aggregated:|priceAggregated:)(.+)$/)
    if (pa && pa[1]) return `price:aggregated:${pa[1]}`

    // Price by token (primary pool)
    const pbt = room.match(/^(?:price-by-token:)(.+)$/)
    if (pbt && pbt[1]) return `price-by-token:${pbt[1]}`

    // Legacy aliases for price-by-token
    const legacyPbt = room.match(/^(?:price:token:|priceToken:)(.+)$/)
    if (legacyPbt && legacyPbt[1]) return `price-by-token:${legacyPbt[1]}`

    // Price across all pools for token
    const pAll = room.match(/^(?:price:)([A-Za-z0-9]{32,44})$/)
    if (pAll && pAll[1]) return `price:${pAll[1]}`

    // Token transactions
    const tx = room.match(/^(?:transaction:)(.+)$/)
    if (tx && tx[1]) return `transaction:${tx[1]}`

    // Legacy transaction aliases
    const legacyTx = room.match(/^(?:transactions:|tx:|token:tx:|tokenTx:|token:transactions:)(.+)$/)
    if (legacyTx && legacyTx[1]) return `transaction:${legacyTx[1]}`

    // As a final fallback, if the caller already passed a room-like string,
    // allow it through unchanged.
    if (/^[a-zA-Z0-9_-]+:/.test(room)) return room

    return null
  }

  private sendJoinForSubKey(ws: WebSocket, subKey: string) {
    try {
      ws.send(JSON.stringify({ type: 'join', room: subKey }))
    } catch {
      // ignore
    }
  }

  private sendLeaveForSubKey(ws: WebSocket, subKey: string) {
    try {
      ws.send(JSON.stringify({ type: 'leave', room: subKey }))
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

  private startHeartbeat() {
    // The Datastream protocol does not define app-level ping/pong messages.
    // Browsers also cannot send true WebSocket ping frames. Disable by default.
    this.stopHeartbeat()
    if (this.heartbeatMs <= 0) return
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }
}
