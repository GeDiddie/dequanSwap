type Env = {
  SOLANATRACKER_GATE_SECRET?: string
}

type TokenResponse = {
  token: string
  expiresAtMs: number
}

type TokenBucket = { tokens: number; lastMs: number }

const SESSION_TTL_MS = 2 * 60 * 1000
const SESSION_SKEW_MS = 5_000

const sessionBuckets = new Map<string, TokenBucket>()
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
  // Keep bounded to prevent unbounded growth.
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

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  // btoa is available in Workers.
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

async function sign(secret: string, data: string): Promise<string> {
  const key = await getHmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return base64UrlEncode(new Uint8Array(sig))
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const req = context.request
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 })

  const gateSecret = String(context.env.SOLANATRACKER_GATE_SECRET || '').trim()
  if (!gateSecret) {
    return new Response('Server not configured: missing SOLANATRACKER_GATE_SECRET', { status: 500 })
  }

  const nowMs = Date.now()
  const ip = getClientIp(req)

  pruneBuckets(sessionBuckets, nowMs)
  // Very small allowance: 3 requests immediately, refills at 0.2 req/sec (~12/min)
  const ok = takeToken(sessionBuckets, ip, nowMs, 3, 0.2 / 1000)
  if (!ok) return new Response('rate_limited', { status: 429 })

  const expMs = nowMs + SESSION_TTL_MS
  const expSec = Math.floor(expMs / 1000)
  const nonce = crypto.randomUUID()

  // Bind token to client IP to reduce token sharing.
  const payload = `${expSec}.${nonce}.${ip}`
  const sig = await sign(gateSecret, payload)

  const token = `v1.${expSec}.${nonce}.${sig}`
  const body: TokenResponse = { token, expiresAtMs: expMs - SESSION_SKEW_MS }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
