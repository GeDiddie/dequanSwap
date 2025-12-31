export type PaperPosition = {
  mint: string
  openedAt: number
  amountInLamports: string // bigint serialized
  tokenAmountBaseUnits: string // bigint serialized
  entryPriceProxyScaled: string // bigint serialized (lamports/baseUnits * SCALE)
  lastPriceProxyScaled?: string // bigint serialized
}

export type PaperTrade = {
  id: string
  ts: number
  side: 'buy' | 'sell'
  mint: string
  pct?: number
  solLamportsDelta: string // bigint serialized (+ for sell, - for buy)
  tokenBaseUnitsDelta: string // bigint serialized (+ for buy, - for sell)
  note?: string
}

export type PaperState = {
  solLamports: string // bigint serialized
  positions: PaperPosition[]
  trades: PaperTrade[]
}

export const PRICE_PROXY_SCALE = 1_000_000_000_000n // 1e12

export function computePriceProxyScaled(amountInLamports: bigint, amountOutBaseUnits: bigint): bigint {
  if (amountOutBaseUnits <= 0n) throw new Error('Invalid quote amountOut')
  return (amountInLamports * PRICE_PROXY_SCALE) / amountOutBaseUnits
}

export function formatPct(n: number | undefined) {
  if (n === undefined || !Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

export function loadPaperState(key = 'dequanswap.paperState'): PaperState {
  const raw = localStorage.getItem(key)
  if (!raw) return { solLamports: (1_000_000_000n).toString(), positions: [], trades: [] } // 1 SOL default
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') throw new Error('bad')
    const obj = parsed as Record<string, unknown>
    const solLamports = typeof obj.solLamports === 'string' ? obj.solLamports : (1_000_000_000n).toString()
    const positions = Array.isArray(obj.positions) ? (obj.positions as PaperPosition[]) : []
    const trades = Array.isArray(obj.trades) ? (obj.trades as PaperTrade[]) : []
    return { solLamports, positions, trades }
  } catch {
    return { solLamports: (1_000_000_000n).toString(), positions: [], trades: [] }
  }
}

export function savePaperState(state: PaperState, key = 'dequanswap.paperState') {
  localStorage.setItem(key, JSON.stringify(state))
}

export function bigintFromString(v: string): bigint {
  try {
    return BigInt(v)
  } catch {
    return 0n
  }
}

export function newTradeId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export function clampTrades(trades: PaperTrade[], keep = 50): PaperTrade[] {
  if (trades.length <= keep) return trades
  return trades.slice(0, keep)
}

export function positionPnlPct(pos: PaperPosition, currentPriceProxyScaled: bigint): number {
  const entry = bigintFromString(pos.entryPriceProxyScaled)
  if (entry <= 0n) return 0
  // pct = (current-entry)/entry * 100
  // Use number here for UI only.
  return (Number(currentPriceProxyScaled - entry) / Number(entry)) * 100
}

export function positionValueLamports(pos: PaperPosition, currentPriceProxyScaled: bigint): bigint {
  const tokens = bigintFromString(pos.tokenAmountBaseUnits)
  return (tokens * currentPriceProxyScaled) / PRICE_PROXY_SCALE
}
