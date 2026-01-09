type Env = {
  SOLANATRACKER_DATASTREAM_KEY?: string
  SOLANATRACKER_GATE_SECRET?: string
}

type TokenBucket = { tokens: number; lastMs: number }

// In the Workers runtime, the server-side WebSocket from `WebSocketPair()` has an `accept()` method.
// The standard DOM `WebSocket` type doesn't include it, so we model it here for TypeScript.
type WorkerServerWebSocket = WebSocket & { accept: () => void }

const wsUpgradeBuckets = new Map<string, TokenBucket>()
const activeSocketsByIp = new Map<string, number>()
let hmacKeyPromise: Promise<CryptoKey> | null = null

function getClientIp(req: Request): string {
  const h = req.headers
  const direct = String(h.get('CF-Connecting-IP') || '').trim()
  if (direct) return direct
  const forwarded = String(h.get('X-Forwarded-For') || '').trim()
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return '0.0.0.0'
}

function pruneBuckets(map: Map<string, TokenBucket>, nowMs: number) {
  if (map.size < 5000) return
  for (const [k, b] of map) {
    if (nowMs - b.lastMs > 5 * 60 * 1000) map.delete(k)
  }
}

function takeToken(map: Map<string, TokenBucket>, key: string, nowMs: number, capacity: number, refillPerMs: number) {
  const cur = map.get(key) ?? { tokens: capacity, lastMs: nowMs }
  const elapsed = Math.max(0, nowMs - cur.lastMs)
  const refilled = Math.min(capacity, cur.tokens + elapsed * refillPerMs)
  const next: TokenBucket = { tokens: refilled, lastMs: nowMs }
  if (next.tokens < 1) {
    map.set(key, next)
    return false
  }
  next.tokens -= 1
  map.set(key, next)
  return true
}

function base64UrlDecodeToBytes(s: string): Uint8Array | null {
  const str = String(s || '').trim()
  if (!str) return null
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padLen = (4 - (b64.length % 4)) % 4
  const padded = b64 + '='.repeat(padLen)
  try {
    const bin = atob(padded)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  const b64 = btoa(bin)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  if (!hmacKeyPromise) {
    const enc = new TextEncoder().encode(secret)
    hmacKeyPromise = crypto.subtle.importKey('raw', enc, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  }
  return hmacKeyPromise
}

async function sign(secret: string, data: string): Promise<Uint8Array> {
  const key = await getHmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return new Uint8Array(sig)
}

async function verifySessionToken(opts: {
  token: string
  secret: string
  nowMs: number
  ip: string
}): Promise<boolean> {
  const { token, secret, nowMs, ip } = opts
  const parts = String(token || '').trim().split('.')
  if (parts.length !== 4) return false
  if (parts[0] !== 'v1') return false

  const expSec = Number(parts[1])
  if (!Number.isFinite(expSec) || expSec <= 0) return false
  const nonce = String(parts[2] || '').trim()
  if (!nonce) return false
  const sigB64 = String(parts[3] || '').trim()
  if (!sigB64) return false

  const expMs = expSec * 1000
  if (nowMs > expMs) return false
  // Don’t accept absurdly long-lived tokens.
  if (expMs - nowMs > 10 * 60 * 1000) return false

  const payload = `${expSec}.${nonce}.${ip}`
  const expected = await sign(secret, payload)
  const got = base64UrlDecodeToBytes(sigB64)
  if (!got) return false
  if (got.length !== expected.length) return false
  // Prefer timing-safe compare when available.
  const subtleAny = crypto.subtle as unknown as { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean }
  if (typeof subtleAny.timingSafeEqual === 'function') {
    return subtleAny.timingSafeEqual(got, expected)
  }
  // Fallback: compare base64url strings.
  return base64UrlEncode(got) === base64UrlEncode(expected)
}

function getUpstreamUrl(env: Env) {
  const key = String(env.SOLANATRACKER_DATASTREAM_KEY || '').trim()
  if (!key) return null
  return `wss://datastream.solanatracker.io/${encodeURIComponent(key)}`
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const upgrade = context.request.headers.get('Upgrade')
  if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket Upgrade', { status: 426 })
  }

  const gateSecret = String(context.env.SOLANATRACKER_GATE_SECRET || '').trim()
  if (!gateSecret) {
    return new Response('Server not configured: missing SOLANATRACKER_GATE_SECRET', { status: 500 })
  }

  // Basic origin check: only allow same-host browser clients.
  const host = String(context.request.headers.get('Host') || '').trim()
  const origin = String(context.request.headers.get('Origin') || '').trim()
  if (host && origin) {
    try {
      const ou = new URL(origin)
      if (ou.host !== host) {
        return new Response('forbidden_origin', { status: 403 })
      }
    } catch {
      return new Response('forbidden_origin', { status: 403 })
    }
  }

  const nowMs = Date.now()
  const ip = getClientIp(context.request)

  pruneBuckets(wsUpgradeBuckets, nowMs)
  // Allow small burst of upgrades per IP.
  const rlOk = takeToken(wsUpgradeBuckets, ip, nowMs, 3, 0.2 / 1000)
  if (!rlOk) return new Response('rate_limited', { status: 429 })

  const currentActive = activeSocketsByIp.get(ip) ?? 0
  if (currentActive >= 2) return new Response('too_many_connections', { status: 429 })

  const url = new URL(context.request.url)
  const token = String(url.searchParams.get('st') || '').trim()
  if (!token) {
    return new Response('missing_session_token', { status: 401 })
  }

  const valid = await verifySessionToken({ token, secret: gateSecret, nowMs, ip })
  if (!valid) return new Response('invalid_session_token', { status: 401 })

  const upstreamUrl = getUpstreamUrl(context.env)
  if (!upstreamUrl) {
    return new Response('Server not configured: missing SOLANATRACKER_DATASTREAM_KEY', { status: 500 })
  }

  // @ts-expect-error WebSocketPair is provided by the Workers runtime.
  const pair = new WebSocketPair()
  const client = pair[0] as WebSocket
  const server = pair[1] as WorkerServerWebSocket
  server.accept()

  activeSocketsByIp.set(ip, currentActive + 1)

  const upstream = new WebSocket(upstreamUrl)

  const sendDiag = (event: string, extra?: Record<string, unknown>) => {
    if (server.readyState !== WebSocket.OPEN) return
    try {
      server.send(
        JSON.stringify({
          type: 'proxy_diag',
          event,
          ...(extra || {}),
        }),
      )
    } catch {
      // ignore
    }
  }

  // Buffer client messages until the upstream socket is open.
  // Without this, early `join` messages can be dropped and the client will never receive room updates.
  const pendingToUpstream: unknown[] = []
  const flushPending = () => {
    if (upstream.readyState !== WebSocket.OPEN) return
    if (pendingToUpstream.length) {
      sendDiag('flush_pending', { count: pendingToUpstream.length })
    }
    while (pendingToUpstream.length) {
      const msg = pendingToUpstream.shift()
      try {
        upstream.send(msg as string)
      } catch {
        // ignore
      }
    }
  }

  const safeClose = (ws: WebSocket, code?: number, reason?: string) => {
    try {
      ws.close(code, reason)
    } catch {
      // ignore
    }
  }

  server.addEventListener('message', (evt) => {
    try {
      // Emit limited diagnostics (do not echo arbitrary payloads).
      // Only attempt to parse text JSON, and only include safe fields.
      try {
        const raw = typeof evt.data === 'string' ? evt.data : null
        if (raw && raw.length < 2048) {
          const parsed = JSON.parse(raw) as unknown
          if (parsed && typeof parsed === 'object') {
            const obj = parsed as Record<string, unknown>
            const t = typeof obj.type === 'string' ? obj.type : undefined
            const room = typeof obj.room === 'string' ? obj.room : undefined
            if (t || room) sendDiag('client_frame', { type: t, room })
          }
        }
      } catch {
        // ignore
      }

      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(evt.data)
      } else {
        // Bound buffer to avoid unbounded memory growth.
        if (pendingToUpstream.length < 100) {
          pendingToUpstream.push(evt.data)
        } else {
          sendDiag('client_buffer_full', { dropped: true })
        }
      }
    } catch {
      // ignore
    }
  })

  server.addEventListener('close', () => {
    safeClose(upstream)
    const cur = activeSocketsByIp.get(ip) ?? 0
    if (cur <= 1) activeSocketsByIp.delete(ip)
    else activeSocketsByIp.set(ip, cur - 1)
  })

  server.addEventListener('error', () => {
    safeClose(upstream)
    const cur = activeSocketsByIp.get(ip) ?? 0
    if (cur <= 1) activeSocketsByIp.delete(ip)
    else activeSocketsByIp.set(ip, cur - 1)
  })

  upstream.addEventListener('message', (evt) => {
    if (server.readyState !== WebSocket.OPEN) return
    try {
      // Forward upstream frame as-is, but also emit a short snippet for debugging.
      try {
        const raw = typeof evt.data === 'string' ? evt.data : null
        if (raw) {
          const snippet = raw.length > 240 ? `${raw.slice(0, 240)}…` : raw
          sendDiag('upstream_frame', { snippet })
        }
      } catch {
        // ignore
      }
      server.send(evt.data)
    } catch {
      // ignore
    }
  })

  upstream.addEventListener('open', () => {
    sendDiag('upstream_open')
    flushPending()
  })

  upstream.addEventListener('close', (evt) => {
    sendDiag('upstream_close', { code: evt.code, reason: evt.reason || '' })
    // Use an explicit close code/reason so the browser doesn't show 1005 (no status).
    safeClose(server, 1011, `upstream_close:${evt.code}${evt.reason ? `:${evt.reason}` : ''}`)
  })

  upstream.addEventListener('error', () => {
    sendDiag('upstream_error')
    safeClose(server, 1011, 'Upstream error')
  })

  return new Response(null, { status: 101, webSocket: client })
}
