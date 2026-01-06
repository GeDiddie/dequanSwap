import './App.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { BaseWalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Keypair, PublicKey, Transaction, type Commitment, type Connection } from '@solana/web3.js'
import { AnimatePresence } from 'framer-motion'
import bs58 from 'bs58'
import { TokenRow } from './components/TokenRow'
import { RadarPulse } from './components/RadarPulse'
import { HelpDot } from './components/HelpDot'
import { TierSelectionScreen } from './components/TierSelectionScreen'
import { TradingWs, TradingWsError, type TradingWsStats } from './lib/tradingWs'
import {
  getAccountMe,
  linkWalletToEmail,
  mintAccountToken,
  requestWalletChallenge,
  startEmailLogin,
  verifyEmailLogin,
  verifyWalletChallenge,
} from './lib/controlPlaneAuth'
import {
  type ProductTier,
  gatesForTier,
  loadSetting,
  loadTier,
  saveSetting,
  saveTier,
  tierDisplayName,
} from './lib/product'
import { PRICE_PROXY_SCALE, bigintFromString, computePriceProxyScaled } from './lib/priceProxy'
import { isJupiterNoRouteErrorMessage, isTokenRugged } from './lib/rug'
import {
  SOL_MINT,
  getSolBalanceLamports,
  getTokenBalanceBaseUnits,
  toLamports,
  deserializeTx,
  signTxWithKeypair,
} from './lib/solana'
import { buildArmFastModeTx, buildRevokeFastModeTx, createFastModeSessionKeypair } from './lib/fastMode'
import { clearBotWalletKeypair, loadBotWalletKeypair, saveBotWalletKeypair } from './lib/botWallet'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'

import splashVideoUrl from './media/sol sniper.mp4'

type QuoteResult = {
  type: 'quote_result'
  success: boolean
  data?: {
    amountIn: string
    amountOut: string
    minOut: string
    priceImpactBps?: number
    route?: {
      provider?: string
      hops?: number
      serializedQuote?: string
    }
  }
}

type BuildSwapTxResult = {
  type: 'build_swap_tx_result'
  success: boolean
  data?: {
    transactionBase64?: string
    swapTransaction?: string
    recentBlockhash?: string
    lastValidBlockHeight?: number
  }
}

type TradingApiTierCounts = {
  totalSockets: number
  authed: number
  authedSockets?: number
  tiers: {
    free: number
    pro: number
    elite: number
    unknown: number
  }
}

type TradingApiHealthz = {
  ok: boolean
  ts?: number
  service?: string
  version?: string
  uptimeSec?: number
  auth?: {
    required?: boolean
    methods?: {
      apiKey?: boolean
      token?: boolean
      jwt?: boolean
      cfAccess?: boolean
      walletSig?: boolean
    }
    cfAccess?: {
      required?: boolean
      issuer?: string
      audience?: string
      jwksUrl?: string
    }
    walletSig?: {
      required?: boolean
    }
    jwt?: {
      disabled?: boolean
      issuer?: string
      audience?: string
      jwksUrl?: string
    }
  }
  originAllowlist?: {
    enabled?: boolean
    allowNoOrigin?: boolean
    allowedOrigins?: string[]
  }
  rateLimit?: {
    enabled?: boolean
    rps?: number
    burst?: number
  }
  userRateLimit?: {
    enabled?: boolean
    rps?: number
    burst?: number
  }
  connections?: TradingApiTierCounts
}

type GetSubscriptionStatusResult = {
  type: 'get_subscription_status_result'
  success: boolean
  data?: {
    subscriptionWallet?: string
    currencyMint?: string
    decimals?: number
    pricing?: { pro?: number; elite?: number }
    active?: boolean
    needsRenewalSoon?: boolean
    overdue?: boolean
    dueInMs?: number
    subscription?: {
      tier: 'pro' | 'elite'
      status: string
      currentPeriodEndAt: number
      nextDueAt: number
    }
    latestPayment?: {
      id: number
      tier: 'pro' | 'elite'
      status: string
      signature?: string
      createdAt: number
      confirmedAt?: number
      errorMessage?: string
    }
  }
}

type BuildSubscriptionTxResult = {
  type: 'build_subscription_tx_result'
  success: boolean
  data?: {
    attemptId: number
    transactionBase64: string
    recentBlockhash?: string
    lastValidBlockHeight?: number
    tier: 'pro' | 'elite'
    amountBaseUnits: number
    currencyMint: string
    subscriptionWallet: string
  }
}

type SubmitSubscriptionPaymentResult = {
  type: 'submit_subscription_payment_result'
  success: boolean
  data?: { attemptId: number; signature: string }
}

type UiStep =
  | 'idle'
  | 'connecting'
  | 'quoting'
  | 'building'
  | 'signing'
  | 'sending'
  | 'confirming'
  | 'submitting'
  | 'done'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

async function confirmSignatureWithFallback(
  connection: Connection,
  signature: string,
  opts?: {
    commitment?: Commitment
    timeoutMs?: number
    pollIntervalMs?: number
  },
): Promise<'confirmed' | 'timeout' | 'not_found'> {
  const commitment = opts?.commitment || 'confirmed'
  const timeoutMs = typeof opts?.timeoutMs === 'number' ? opts.timeoutMs : 90_000
  const pollIntervalMs = typeof opts?.pollIntervalMs === 'number' ? opts.pollIntervalMs : 1500

  const withTimeout = async <T,>(p: Promise<T>, ms: number): Promise<T> => {
    let id: number | undefined
    try {
      return await Promise.race([
        p,
        new Promise<T>((_, reject) => {
          id = window.setTimeout(() => reject(new Error('timeout')), ms)
        }),
      ])
    } finally {
      if (typeof id === 'number') window.clearTimeout(id)
    }
  }

  try {
    // confirmTransaction can hang indefinitely when WS subscriptions are unhealthy.
    // Use a short leash, then fall back to polling.
    await withTimeout(connection.confirmTransaction(signature, commitment), Math.min(8000, timeoutMs))
    return 'confirmed'
  } catch (e) {
    // Fall through to polling.
    const msg = e instanceof Error ? e.message : String(e)
    const isTimeout = msg.includes('Transaction was not confirmed') || msg.includes('timeout')
    if (!isTimeout) throw e
  }

  const started = Date.now()
  let everObservedStatus = false
  while (Date.now() - started < timeoutMs) {
    const st = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true }).catch(() => null)
    const s = st?.value?.[0]
    if (s) {
      everObservedStatus = true
      if (s.err) throw new Error(`Transaction failed: ${JSON.stringify(s.err)}`)
      if (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized') return 'confirmed'
    }
    await new Promise<void>((r) => setTimeout(r, pollIntervalMs))
  }

  // If we never saw the signature in status history, treat it as dropped / never broadcast.
  return everObservedStatus ? 'timeout' : 'not_found'
}

function shortPk(pk: string) {
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`
}

const READONLY_PUBKEY = '11111111111111111111111111111111'

type FeedToken = {
  mint: string
  name?: string
  symbol?: string
  detectedMc?: number
  mcEntry?: number
  mcCurrent?: number
  mcGrowthPct?: number
  startedAt?: number
  source: 'dequanw'
  isRugged?: boolean
  liquidityStatus?: 'active' | 'removed' | 'unknown'
  liquidityRemovedAt?: number
  liquidityRemovedSig?: string
  liquidityRemovedInstruction?: string
  liquidityRemovedReason?: string
  basePriceProxyScaled?: string
  lastPriceProxyScaled?: string
  growthPct?: number
  lastUpdatedAt?: number
  error?: string
}

function computeGrowthPct(entry: number | undefined, current: number | undefined): number | undefined {
  if (typeof entry !== 'number' || typeof current !== 'number') return undefined
  if (!Number.isFinite(entry) || !Number.isFinite(current)) return undefined
  if (entry <= 0) return undefined
  return ((current - entry) / entry) * 100
}

function bigintAbs(x: bigint): bigint {
  return x < 0n ? -x : x
}

function formatAgeShort(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  if (min < 60) return `${min}m ${String(remSec).padStart(2, '0')}s`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return `${hr}h ${String(remMin).padStart(2, '0')}m`
}

function toEpochMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value)
    if (Number.isFinite(ms)) return ms
  }
  return undefined
}

function toPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined
  if (!Number.isFinite(value)) return undefined
  if (value <= 0) return undefined
  return value
}

function formatUsd0(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '—'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
      notation: n >= 10_000 ? 'compact' : 'standard',
    }).format(n)
  } catch {
    return `$${Math.round(n).toLocaleString()}`
  }
}

function computeQuoteMcProxy(t: {
  entryMc?: number
  currentMc?: number
  basePriceProxyScaled?: string
  lastPriceProxyScaled?: string
}): number | undefined {
  const baseMc = typeof t.entryMc === 'number' && Number.isFinite(t.entryMc) && t.entryMc > 0 ? t.entryMc : t.currentMc
  if (typeof baseMc !== 'number' || !Number.isFinite(baseMc) || baseMc <= 0) return undefined

  const baseScaled = t.basePriceProxyScaled ? bigintFromString(t.basePriceProxyScaled) : undefined
  const lastScaled = t.lastPriceProxyScaled ? bigintFromString(t.lastPriceProxyScaled) : undefined
  if (typeof baseScaled !== 'bigint' || typeof lastScaled !== 'bigint') return undefined
  if (baseScaled <= 0n || lastScaled <= 0n) return undefined

  // ratio ~= last/base, kept as ratio * 1e6 for stable Number() conversion.
  const ratioTimes1e6 = (lastScaled * 1_000_000n) / baseScaled
  if (ratioTimes1e6 <= 0n) return undefined
  if (bigintAbs(ratioTimes1e6) > BigInt(Number.MAX_SAFE_INTEGER)) return undefined

  const ratio = Number(ratioTimes1e6) / 1_000_000
  if (!Number.isFinite(ratio) || ratio <= 0) return undefined

  const mc = baseMc * ratio
  if (!Number.isFinite(mc) || mc <= 0) return undefined
  return mc
}

type WatchedToken = {
  mint: string
  addedAt: number
  symbol?: string
  name?: string
  entryMc?: number
  currentMc?: number
  mcUpdatedAt?: number
  basePriceProxyScaled?: string
  lastPriceProxyScaled?: string
  basePriceProxy?: number
  lastPriceProxy?: number
  growthPct?: number
  lastUpdatedAt?: number
  error?: string
}

type HoldingToken = {
  mint: string
  boughtAt: number
  name?: string
  symbol?: string
  isRugged?: boolean
  liquidityStatus?: 'active' | 'removed' | 'unknown'
  error?: string
  buyMc?: number
  currentMc?: number

  // Quote-based price proxy (scaled bigint stored as string to avoid overflow).
  // entry* fields are the holding's baseline at buy time.
  entryPriceProxyScaled?: string
  lastPriceProxyScaled?: string
  entryPriceProxy?: number
  lastPriceProxy?: number
  proxyGrowthPct?: number
}

type SoldToken = {
  mint: string
  soldAt: number
  outcome?: 'SOLD' | 'RUGGED'
  pct?: number
  signature?: string
  buyMc?: number
  sellMc?: number
}

function parseWatchedTokens(raw: string | null): WatchedToken[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((x) => {
        if (!x || typeof x !== 'object') return null
        const r = x as Record<string, unknown>
        const mint = typeof r.mint === 'string' ? r.mint : ''
        const addedAt = typeof r.addedAt === 'number' ? r.addedAt : Date.now()
        if (!mint) return null
        const wt: WatchedToken = { mint, addedAt }
        if (typeof r.symbol === 'string') wt.symbol = r.symbol
        if (typeof r.name === 'string') wt.name = r.name
        if (typeof r.entryMc === 'number') wt.entryMc = r.entryMc
        if (typeof r.currentMc === 'number') wt.currentMc = r.currentMc
        if (typeof r.mcUpdatedAt === 'number') wt.mcUpdatedAt = r.mcUpdatedAt
        if (typeof r.basePriceProxyScaled === 'string') wt.basePriceProxyScaled = r.basePriceProxyScaled
        if (typeof r.lastPriceProxyScaled === 'string') wt.lastPriceProxyScaled = r.lastPriceProxyScaled
        if (typeof r.basePriceProxy === 'number') wt.basePriceProxy = r.basePriceProxy
        if (typeof r.lastPriceProxy === 'number') wt.lastPriceProxy = r.lastPriceProxy
        if (typeof r.growthPct === 'number') wt.growthPct = r.growthPct
        if (typeof r.lastUpdatedAt === 'number') wt.lastUpdatedAt = r.lastUpdatedAt
        return wt
      })
      .filter(Boolean) as WatchedToken[]
  } catch {
    return []
  }
}

function parseHoldings(raw: string | null): HoldingToken[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((x) => {
        if (!x || typeof x !== 'object') return null
        const r = x as Record<string, unknown>
        const mint = typeof r.mint === 'string' ? r.mint : ''
        const boughtAt = typeof r.boughtAt === 'number' ? r.boughtAt : Date.now()
        if (!mint) return null
        const h: HoldingToken = { mint, boughtAt }
        if (typeof r.name === 'string') h.name = r.name
        if (typeof r.symbol === 'string') h.symbol = r.symbol
        if (typeof r.isRugged === 'boolean') h.isRugged = r.isRugged
        if (r.liquidityStatus === 'active' || r.liquidityStatus === 'removed' || r.liquidityStatus === 'unknown') h.liquidityStatus = r.liquidityStatus
        if (typeof r.error === 'string') h.error = r.error
        if (typeof r.buyMc === 'number') h.buyMc = r.buyMc
        if (typeof r.currentMc === 'number') h.currentMc = r.currentMc

        if (typeof r.entryPriceProxyScaled === 'string') h.entryPriceProxyScaled = r.entryPriceProxyScaled
        if (typeof r.lastPriceProxyScaled === 'string') h.lastPriceProxyScaled = r.lastPriceProxyScaled
        if (typeof r.entryPriceProxy === 'number') h.entryPriceProxy = r.entryPriceProxy
        if (typeof r.lastPriceProxy === 'number') h.lastPriceProxy = r.lastPriceProxy
        if (typeof r.proxyGrowthPct === 'number') h.proxyGrowthPct = r.proxyGrowthPct
        return h
      })
      .filter(Boolean) as HoldingToken[]
  } catch {
    return []
  }
}

type SeriesPoint = { t: number; v: number }

function clampSeriesPoints(points: SeriesPoint[], maxPoints: number) {
  if (points.length <= maxPoints) return points
  return points.slice(points.length - maxPoints)
}

function seriesTrend(points: SeriesPoint[]): 'up' | 'down' | 'flat' {
  if (points.length < 2) return 'flat'
  const a = points[points.length - 2]?.v
  const b = points[points.length - 1]?.v
  if (typeof a !== 'number' || typeof b !== 'number') return 'flat'
  if (b > a) return 'up'
  if (b < a) return 'down'
  return 'flat'
}

function renderSparkline(points: SeriesPoint[], width: number, height: number): string {
  if (!points.length) return ''
  const min = Math.min(...points.map((p) => p.v))
  const max = Math.max(...points.map((p) => p.v))
  const range = Math.max(1e-9, max - min)
  const n = points.length
  return points
    .map((p, i) => {
      const x = n === 1 ? 0 : (i / (n - 1)) * (width - 1)
      const y = (1 - (p.v - min) / range) * (height - 1)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

function parseSoldTokens(raw: string | null): SoldToken[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((x) => {
        if (!x || typeof x !== 'object') return null
        const r = x as Record<string, unknown>
        const mint = typeof r.mint === 'string' ? r.mint : ''
        const soldAt = typeof r.soldAt === 'number' ? r.soldAt : Date.now()
        if (!mint) return null
        const s: SoldToken = { mint, soldAt }
        if (r.outcome === 'SOLD' || r.outcome === 'RUGGED') s.outcome = r.outcome
        if (typeof r.pct === 'number') s.pct = r.pct
        if (typeof r.signature === 'string') s.signature = r.signature
        if (typeof r.buyMc === 'number') s.buyMc = r.buyMc
        if (typeof r.sellMc === 'number') s.sellMc = r.sellMc
        return s
      })
      .filter(Boolean) as SoldToken[]
  } catch {
    return []
  }
}

// Moved to TokenRow component - kept here for potential future use
// function formatAge(ms: number) {
//   const s = Math.max(0, Math.floor(ms / 1000))
//   if (s < 60) return `${s}s`
//   const m = Math.floor(s / 60)
//   const rs = s % 60
//   if (m < 60) return `${m}m ${rs}s`
//   const h = Math.floor(m / 60)
//   const rm = m % 60
//   return `${h}h ${rm}m`
// }

type DequanwFeedResponse = {
  generatedAt: number
  limit: number
  items: Array<{
    timestamp: number | null
    tokenAddress: string | null
    tokenName: string | null
    tokenSymbol: string | null
    entryMC: number | null
    currentMC: number | null
    isRugged?: boolean | null
    liquidityStatus?: 'active' | 'removed' | 'unknown' | null
    liquidityRemovedAt?: number | null
    liquidityRemovedSig?: string | null
    liquidityRemovedInstruction?: string | null
    liquidityRemovedReason?: string | null
    poolAddress?: string | null
    ammProgramId?: string | null
  }>
}

type DequanwWatchingResponse = {
  generatedAt: number
  limit: number
  stats?: {
    total: number
    capacity: number
    evaluated: number
    pendingEvaluation: number
    observing: number
  }
  items: Array<{
    tokenAddress: string | null
    tokenName: string | null
    tokenSymbol: string | null
    detectionTime: number | null
    startTime: number | null
    entryMarketCap: number | null
    latestMarketCap: number | null
    isRugged?: boolean | null
    liquidityStatus?: 'active' | 'removed' | 'unknown' | null
    liquidityRemovedAt?: number | null
    liquidityRemovedSig?: string | null
    liquidityRemovedInstruction?: string | null
    liquidityRemovedReason?: string | null
    poolAddress?: string | null
    ammProgramId?: string | null
  }>
}

function App() {
  const { connection } = useConnection()
  const { publicKey, connected, connecting, signTransaction, signMessage } = useWallet()

  const [walletActionHint, setWalletActionHint] = useState<'' | 'connect' | 'signature'>('')
  const walletConnectingRef = useRef(false)
  const walletConnectedRef = useRef(false)

  useEffect(() => {
    walletConnectingRef.current = connecting
  }, [connecting])

  useEffect(() => {
    walletConnectedRef.current = connected
  }, [connected])

  const defaultWsUrl = import.meta.env.VITE_DEQUANW_WS_URL || 'ws://localhost:8900'
  const defaultApiKey = import.meta.env.VITE_DEQUANW_API_KEY || ''
  const defaultAuthToken = import.meta.env.VITE_DEQUANW_AUTH_TOKEN || ''
  const controlPlaneBaseUrl = String(import.meta.env.VITE_CONTROL_PLANE_URL || 'https://auth.dequan.xyz')
    .trim()
    .replace(/\/$/, '')

  const [wsUrl, setWsUrl] = useState(() => loadSetting('dequanswap.wsUrl', defaultWsUrl))
  const [apiKey, setApiKey] = useState(() => loadSetting('dequanswap.apiKey', defaultApiKey))
  const [authToken, setAuthToken] = useState(() => loadSetting('dequanswap.authToken', defaultAuthToken))

  useEffect(() => {
    // If wallet connect is stuck >5s, hint that Phantom may be open elsewhere.
    if (!connecting) return

    const t = window.setTimeout(() => {
      if (walletConnectingRef.current && !walletConnectedRef.current) {
        setWalletActionHint('connect')
      }
    }, 5000)

    return () => window.clearTimeout(t)
  }, [connecting])

  useEffect(() => {
    if (!connecting) {
      setWalletActionHint('')
    }
  }, [connecting])

  useEffect(() => {
    // Migration: older builds pointed the Trading API WS URL at the Pages origin.
    // Pages can't terminate raw WebSockets, so auto-fix to the new tunneled hostname.
    if (wsUrl === 'wss://snipe.dequan.xyz/ws' && defaultWsUrl !== wsUrl) {
      setWsUrl(defaultWsUrl)
    }
  }, [defaultWsUrl, wsUrl])

  const [tier, setTier] = useState<ProductTier>(() => loadTier())
  const gates = useMemo(() => gatesForTier(tier), [tier])

  const [subscriptionBusy, setSubscriptionBusy] = useState(false)
  const [subscriptionStatus, setSubscriptionStatus] = useState<GetSubscriptionStatusResult['data'] | null>(null)

  const [accountModalOpen, setAccountModalOpen] = useState(false)
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountError, setAccountError] = useState('')
  const [accountEmail, setAccountEmail] = useState('')
  const [accountCode, setAccountCode] = useState('')
  const [accountChallengeId, setAccountChallengeId] = useState('')
  const [accountDebugCode, setAccountDebugCode] = useState('')
  const [pendingSubscribeTier, setPendingSubscribeTier] = useState<'pro' | 'elite' | null>(null)
  const accountJwtRef = useRef<{ token: string; expiresAt: string; email: string } | null>(null)

  const [splashOpen, setSplashOpen] = useState(true)
  const [splashLeaving, setSplashLeaving] = useState(false)
  const [splashVideoFailed, setSplashVideoFailed] = useState(false)

  const [tierSelectionOpen, setTierSelectionOpen] = useState(() => {
    // Only force tier selection on first visit (or after clearing storage).
      // Users can always re-open via the header plan selector.
    return loadSetting('dequanswap.tierChosen', '0') !== '1'
  })

  const requestCloseSplash = useCallback(() => {
    setSplashLeaving((prev) => {
      if (prev) return prev
      window.setTimeout(() => setSplashOpen(false), 420)
      return true
    })
  }, [])


  useEffect(() => {
    if (!splashOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestCloseSplash()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [requestCloseSplash, splashOpen])

  const debugAdminPubkey = String(import.meta.env.VITE_DEBUG_ADMIN_PUBKEY || '').trim()
  const DEBUG_PORTAL_PASSCODE = '54691213'

  const [debugOpen, setDebugOpen] = useState(false)
  const [debugPasscode, setDebugPasscode] = useState('')
  const [debugUnlocked, setDebugUnlocked] = useState(() => {
    try {
      const raw = sessionStorage.getItem('dequanswap.debugUnlocked')
      if (!raw) return false
      const parsed = JSON.parse(raw) as { t?: number }
      const t = typeof parsed?.t === 'number' ? parsed.t : 0
      return Date.now() - t < 8 * 60 * 60 * 1000
    } catch {
      return false
    }
  })

  const [lastFeedFetchedAt, setLastFeedFetchedAt] = useState<number>(0)
  const [lastWsConnectedAt, setLastWsConnectedAt] = useState<number>(0)
  const [lastWsErrorAt, setLastWsErrorAt] = useState<number>(0)

  const [wsDiag, setWsDiag] = useState<TradingWsStats>({ messageCount: 0, lastMessageAt: 0, lastMessageType: undefined })

  const [tradingApiHealth, setTradingApiHealth] = useState<TradingApiHealthz | null>(null)

  const [tierCounts, setTierCounts] = useState<TradingApiTierCounts | null>(null)
  const [tierCountsAt, setTierCountsAt] = useState(0)
  const [tierCountsError, setTierCountsError] = useState('')
  const [tierCountsHealthzUrl, setTierCountsHealthzUrl] = useState('')

  const [solProbe, setSolProbe] = useState<
    | {
        at: number
        ms: number
        slot?: number
        blockhash?: string
        error?: string
      }
    | null
  >(null)
  const [solAutoProbe, setSolAutoProbe] = useState(false)

  const [debugTimeline, setDebugTimeline] = useState<
    Array<{
      at: number
      area: 'ws' | 'auth' | 'solana' | 'trade' | 'ui'
      level: 'info' | 'warn' | 'error'
      message: string
      detail?: string
    }>
  >([])

  const pushDebugEvent = useCallback(
    (evt: {
      area: 'ws' | 'auth' | 'solana' | 'trade' | 'ui'
      level: 'info' | 'warn' | 'error'
      message: string
      detail?: string
    }) => {
      setDebugTimeline((prev) => [{ at: Date.now(), ...evt }, ...prev].slice(0, 60))
    },
    [],
  )

  const [lastTradingApiErrorAt, setLastTradingApiErrorAt] = useState(0)
  const [lastTradingApiErrorCode, setLastTradingApiErrorCode] = useState<string>('')
  const [lastTradingApiErrorMessage, setLastTradingApiErrorMessage] = useState<string>('')

  const [tradingApiErrorLog, setTradingApiErrorLog] = useState<
    Array<{
      at: number
      code: string
      message: string
    }>
  >([])

  const recordTradingApiError = useCallback((e: unknown) => {
    const at = Date.now()
    setLastTradingApiErrorAt(at)
    if (e instanceof TradingWsError) {
      const code = e.code || ''
      const message = e.message || ''
      setLastTradingApiErrorCode(code)
      setLastTradingApiErrorMessage(message)
      setTradingApiErrorLog((prev) => [{ at, code, message }, ...prev].slice(0, 10))
      return
    }
    if (e instanceof Error) {
      setLastTradingApiErrorCode('')
      setLastTradingApiErrorMessage(e.message)
      setTradingApiErrorLog((prev) => [{ at, code: '', message: e.message }, ...prev].slice(0, 10))
      return
    }
    setLastTradingApiErrorCode('')
    const message = String(e || 'Unknown error')
    setLastTradingApiErrorMessage(message)
    setTradingApiErrorLog((prev) => [{ at, code: '', message }, ...prev].slice(0, 10))
  }, [])

  const [userRateLimitUntilMs, setUserRateLimitUntilMs] = useState(0)

  useEffect(() => {
    if (!debugOpen || !debugUnlocked) return

    const wsUrlToHealthzUrl = (raw: string): string => {
      const u = new URL(raw)
      u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:'
      u.pathname = '/healthz'
      u.search = ''
      u.hash = ''
      return u.toString()
    }

    let healthzUrl = ''
    try {
      healthzUrl = wsUrlToHealthzUrl(wsUrl)
    } catch {
      setTierCountsHealthzUrl('')
      setTierCountsError('Invalid WS URL (cannot derive /healthz)')
      return
    }

    setTierCountsHealthzUrl(healthzUrl)

    let cancelled = false
    const tick = async () => {
      try {
        const r = await fetch(healthzUrl, { method: 'GET', cache: 'no-store', credentials: 'include' })
        if (!r.ok) throw new Error(`healthz_http_${r.status}`)
        const j = (await r.json()) as TradingApiHealthz
        const c = j?.connections
        if (!c || typeof c !== 'object') throw new Error('healthz_missing_connections')
        if (cancelled) return
        setTradingApiHealth(j)
        setTierCounts(c)
        setTierCountsAt(Date.now())
        setTierCountsError('')
      } catch (e) {
        if (cancelled) return
        setTradingApiHealth(null)
        setTierCountsError(e instanceof Error ? e.message : String(e || 'healthz_error'))
      }
    }

    void tick()
    const id = window.setInterval(() => void tick(), 5000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [debugOpen, debugUnlocked, wsUrl])
  const userRateLimitBackoffMsRef = useRef(500)

  const bumpUserRateLimitBackoff = useCallback(() => {
    const now = Date.now()
    const prev = userRateLimitBackoffMsRef.current
    const next = Math.min(Math.max(prev, 250) * 2, 15_000)
    userRateLimitBackoffMsRef.current = next
    setUserRateLimitUntilMs(now + next)
  }, [])

  const isUserRateLimitedError = useCallback((e: unknown) => {
    if (!(e instanceof TradingWsError)) return false
    return e.code === 'rate_limited_user' || e.message === 'rate_limited_user'
  }, [])

  const authLabel = useMemo(() => {
    if (authToken.trim()) return 'Token'
    if (apiKey.trim()) return 'API key'
    // When nothing is configured, reflect wallet connect state so the user isn't confused.
    return connected && publicKey ? 'Wallet' : 'No auth'
  }, [apiKey, authToken, connected, publicKey])

  const wsRef = useRef<TradingWs | null>(null)
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connected'>('disconnected')
  const [wsAuthed, setWsAuthed] = useState(false)

  const [tokenMint, setTokenMint] = useState('')
  const [amountSol, setAmountSol] = useState('0.01')
  const [slippageBps, setSlippageBps] = useState(4000)

  const [snipeCardSide, setSnipeCardSide] = useState<'snipe' | 'sell'>('snipe')
  const [sellMintInput, setSellMintInput] = useState('')
  const [sellPct, setSellPct] = useState<25 | 50 | 100>(100)

  const [watchMintInput, setWatchMintInput] = useState('')
  const [watched, setWatched] = useState<WatchedToken[]>(() =>
    parseWatchedTokens(localStorage.getItem('dequanswap.watchedTokens')),
  )

  const [holdings, setHoldings] = useState<HoldingToken[]>([])
  const [soldTokens, setSoldTokens] = useState<SoldToken[]>([])

  const defaultDequanwDashBase = import.meta.env.VITE_DEQUANW_DASH_BASE || '/dequanw'
  const dequanwDashBase = defaultDequanwDashBase

  const helpVideoBase = String(import.meta.env.VITE_HELP_VIDEO_BASE_URL || '').trim().replace(/\/$/, '')
  const helpUrl = useCallback(
    (id: string) => {
      if (!helpVideoBase) return ''
      return `${helpVideoBase}/${id}`
    },
    [helpVideoBase],
  )
  const [feed, setFeed] = useState<FeedToken[]>([])
  const [feedError, setFeedError] = useState<string>('')
  const [feedSampleDebug, setFeedSampleDebug] = useState<
    | {
        rawFeedFirstItem?: unknown
        rawWatchingFirstItem?: unknown
        mappedFirstRow?: Partial<FeedToken>
      }
    | undefined
  >(undefined)

  const feedNewestStartedAt = useMemo(() => {
    let newest = 0
    for (const t of feed) {
      if (typeof t.startedAt === 'number' && t.startedAt > newest) newest = t.startedAt
    }
    return newest > 0 ? newest : null
  }, [feed])

  const feedNewestAgeMs = useMemo(() => {
    if (!feedNewestStartedAt) return null
    return Math.max(0, Date.now() - feedNewestStartedAt)
  }, [feedNewestStartedAt])

  const feedLooksStale = useMemo(() => {
    if (typeof feedNewestAgeMs !== 'number') return false
    // If the newest token is older than this, the producer is likely down.
    return feedNewestAgeMs > 15 * 60 * 1000
  }, [feedNewestAgeMs])

  // Auto-remove rugged tokens from feed after 5 seconds
  useEffect(() => {
    const ruggedTokens = feed.filter((t) => isTokenRugged(t))
    
    if (ruggedTokens.length === 0) return
    
    const timers = ruggedTokens.map(token => {
      return setTimeout(() => {
        setFeed(prev => prev.filter(t => t.mint !== token.mint))
      }, 5000)
    })
    
    return () => {
      timers.forEach(timer => clearTimeout(timer))
    }
  }, [feed])

  const [debugIncludeRugged, setDebugIncludeRugged] = useState<boolean>(() =>
    loadSetting('dequanswap.debugIncludeRugged', '0') === '1',
  )

  const [watchingOpen, setWatchingOpen] = useState(false)
  const [liveFeedOpen, setLiveFeedOpen] = useState(true)
  const [watchingAddOpen, setWatchingAddOpen] = useState(false)
  const [holdingsOpen, setHoldingsOpen] = useState(true)
  const [useQuoteMcProxyWhenStale, setUseQuoteMcProxyWhenStale] = useState<boolean>(() =>
    loadSetting('dequanswap.useQuoteMcProxyWhenStale', '1') === '1',
  )
  const [copiedMint, setCopiedMint] = useState<string>('')
  const [uiNow, setUiNow] = useState<number>(() => Date.now())

  useEffect(() => {
    saveSetting('dequanswap.useQuoteMcProxyWhenStale', useQuoteMcProxyWhenStale ? '1' : '0')
  }, [useQuoteMcProxyWhenStale])

  const holdingsMcHistoryRef = useRef<Record<string, SeriesPoint[]>>({})
  const [holdingDrawerMint, setHoldingDrawerMint] = useState<string>('')

  const watchingMcHistoryRef = useRef<Record<string, SeriesPoint[]>>({})
  const [watchDrawerMint, setWatchDrawerMint] = useState<string>('')

  useEffect(() => {
    const id = window.setInterval(() => setUiNow(Date.now()), 2000)
    return () => window.clearInterval(id)
  }, [])

  // Track a lightweight MC history per holding for sparklines (bounded).
  useEffect(() => {
    const now = Date.now()
    const history = holdingsMcHistoryRef.current
    const keep = new Set<string>()

    for (const h of holdings) {
      keep.add(h.mint)
      const mc = typeof h.currentMc === 'number' && Number.isFinite(h.currentMc) ? h.currentMc : undefined
      if (typeof mc !== 'number') continue

      const prev = history[h.mint] ?? []
      const last = prev.length ? prev[prev.length - 1] : null

      // Feed ticks ~5s; avoid adding duplicate/too-frequent points.
      if (last && now - last.t < 3500) continue
      if (last && last.v === mc) continue

      history[h.mint] = clampSeriesPoints([...prev, { t: now, v: mc }], 60)
    }

    for (const mint of Object.keys(history)) {
      if (!keep.has(mint)) delete history[mint]
    }
  }, [holdings])

  // Track a lightweight MC history per watched token for sparklines (bounded).
  useEffect(() => {
    const now = Date.now()
    const history = watchingMcHistoryRef.current
    const keep = new Set<string>()

    for (const t of watched) {
      keep.add(t.mint)
      const mc = typeof t.currentMc === 'number' && Number.isFinite(t.currentMc) ? t.currentMc : undefined
      if (typeof mc !== 'number') continue

      const prev = history[t.mint] ?? []
      const last = prev.length ? prev[prev.length - 1] : null
      if (last && now - last.t < 3500) continue
      if (last && last.v === mc) continue

      history[t.mint] = clampSeriesPoints([...prev, { t: now, v: mc }], 60)
    }

    for (const mint of Object.keys(history)) {
      if (!keep.has(mint)) delete history[mint]
    }
  }, [watched])

  const dequanwServerOk = useMemo(() => {
    const base = dequanwDashBase.trim()
    if (!base) return false
    if (feedError) return false
    if (!lastFeedFetchedAt) return false
    // Feed polls every 5s; allow some slack.
    return uiNow - lastFeedFetchedAt < 20_000
  }, [dequanwDashBase, feedError, lastFeedFetchedAt, uiNow])

  // Auto-collapse Holdings when empty, expand when populated
  useEffect(() => {
    setHoldingsOpen(holdings.length > 0)
  }, [holdings.length])

  // Auto-expand Watching when first token is added
  useEffect(() => {
    if (watched.length === 1) {
      setWatchingOpen(true)
    }
  }, [watched.length])

  const tierLabel = useMemo(() => {
    return tierDisplayName(tier)
  }, [tier])

  const dashboardSubtitle = useMemo(() => `${tierLabel} Dashboard`, [tierLabel])

  const getFeedMcSnapshot = useCallback(
    (mint: string): {
      entry?: number
      current?: number
      name?: string
      symbol?: string
      isRugged?: boolean
      liquidityStatus?: 'active' | 'removed' | 'unknown'
    } => {
      const t = feed.find((x) => x.mint === mint)
      if (!t) return {}
      const entry = typeof t.mcEntry === 'number' ? t.mcEntry : typeof t.detectedMc === 'number' ? t.detectedMc : undefined
      const current = typeof t.mcCurrent === 'number' ? t.mcCurrent : typeof t.detectedMc === 'number' ? t.detectedMc : undefined
      const name = typeof t.name === 'string' && t.name.trim() ? t.name.trim() : undefined
      const symbol = typeof t.symbol === 'string' && t.symbol.trim() ? t.symbol.trim() : undefined
      const isRugged = t.isRugged === true
      const liquidityStatus = t.liquidityStatus
      return { entry, current, name, symbol, isRugged, liquidityStatus }
    },
    [feed],
  )

  const addHolding = useCallback(
    (mint: string, meta?: Partial<HoldingToken>) => {
      const m = mint.trim()
      if (!m) return

      const snap = getFeedMcSnapshot(m)
      const buyMc = typeof snap.current === 'number' ? snap.current : snap.entry

      setHoldings((prev) => {
        const existing = prev.find((h) => h.mint === m)
        if (existing) {
          return prev.map((h) =>
            h.mint === m
              ? {
                  ...h,
                  name: h.name ?? snap.name,
                  symbol: h.symbol ?? snap.symbol,
                  isRugged: h.isRugged ?? snap.isRugged,
                  liquidityStatus: h.liquidityStatus ?? snap.liquidityStatus,
                  buyMc: h.buyMc ?? buyMc,
                  currentMc: snap.current ?? h.currentMc,

                  entryPriceProxyScaled: h.entryPriceProxyScaled ?? meta?.entryPriceProxyScaled,
                  lastPriceProxyScaled: h.lastPriceProxyScaled ?? meta?.lastPriceProxyScaled,
                  entryPriceProxy: h.entryPriceProxy ?? meta?.entryPriceProxy,
                  lastPriceProxy: h.lastPriceProxy ?? meta?.lastPriceProxy,
                  proxyGrowthPct: h.proxyGrowthPct ?? meta?.proxyGrowthPct,
                }
              : h,
          )
        }
        return [
          {
            mint: m,
            boughtAt: Date.now(),
            name: snap.name,
            symbol: snap.symbol,
            isRugged: snap.isRugged,
            liquidityStatus: snap.liquidityStatus,
            buyMc,
            currentMc: snap.current,

            entryPriceProxyScaled: meta?.entryPriceProxyScaled,
            lastPriceProxyScaled: meta?.lastPriceProxyScaled,
            entryPriceProxy: meta?.entryPriceProxy,
            lastPriceProxy: meta?.lastPriceProxy,
            proxyGrowthPct: meta?.proxyGrowthPct,
          },
          ...prev,
        ]
      })

      // Mirror dequanW bot behavior: once bought, stop monitoring it.
      setWatched((prev) => prev.filter((t) => t.mint !== m))
    },
    [getFeedMcSnapshot],
  )

  const closeHoldingDrawer = useCallback(() => setHoldingDrawerMint(''), [])
  const closeWatchDrawer = useCallback(() => setWatchDrawerMint(''), [])

  useEffect(() => {
    if (!holdingDrawerMint && !watchDrawerMint) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (holdingDrawerMint) closeHoldingDrawer()
      if (watchDrawerMint) closeWatchDrawer()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeHoldingDrawer, closeWatchDrawer, holdingDrawerMint, watchDrawerMint])

  const removeHolding = useCallback((mint: string) => {
    setHoldings((prev) => prev.filter((h) => h.mint !== mint))
  }, [])

  useEffect(() => {
    try {
      if (publicKey) {
        const wallet = publicKey.toBase58()
        localStorage.setItem(`dequanswap.holdings.${wallet}`, JSON.stringify(holdings))
      }
    } catch {
      // ignore
    }
  }, [holdings, publicKey])

  useEffect(() => {
    try {
      if (publicKey) {
        const wallet = publicKey.toBase58()
        localStorage.setItem(`dequanswap.soldTokens.${wallet}`, JSON.stringify(soldTokens))
      }
    } catch {
      // ignore
    }
  }, [publicKey, soldTokens])

  const primeWatchedFromFeed = useCallback(
    (mint: string) => {
      const f = feed.find((x) => x.mint === mint)
      if (!f) return

      const feedSymbol = typeof f.symbol === 'string' && f.symbol.trim() ? f.symbol.trim() : undefined
      const feedName = typeof f.name === 'string' && f.name.trim() ? f.name.trim() : undefined

      const feedEntry = typeof f.mcEntry === 'number' ? f.mcEntry : typeof f.detectedMc === 'number' ? f.detectedMc : undefined
      const feedCurrent =
        typeof f.mcCurrent === 'number' ? f.mcCurrent : typeof f.detectedMc === 'number' ? f.detectedMc : undefined

      if (typeof feedEntry !== 'number' && typeof feedCurrent !== 'number') return

      setWatched((prev) =>
        prev.map((w) => {
          if (w.mint !== mint) return w

          const nextEntry = w.entryMc ?? feedEntry ?? feedCurrent
          const nextCurrent = feedCurrent ?? w.currentMc
          const nextGrowth = computeGrowthPct(nextEntry, nextCurrent)

          const nextSymbol = w.symbol ?? feedSymbol
          const nextName = w.name ?? feedName

          const mcChanged = nextEntry !== w.entryMc || nextCurrent !== w.currentMc

          const changed =
            nextEntry !== w.entryMc ||
            nextCurrent !== w.currentMc ||
            nextGrowth !== w.growthPct ||
            nextSymbol !== w.symbol ||
            nextName !== w.name
          if (!changed) return w

          return {
            ...w,
            symbol: nextSymbol,
            name: nextName,
            entryMc: nextEntry,
            currentMc: nextCurrent,
            mcUpdatedAt: mcChanged ? Date.now() : w.mcUpdatedAt,
            growthPct: nextGrowth ?? w.growthPct,
            lastUpdatedAt: Date.now(),
          }
        }),
      )
    },
    [feed],
  )

  useEffect(() => {
    saveSetting('dequanswap.debugIncludeRugged', debugIncludeRugged ? '1' : '0')
  }, [debugIncludeRugged])
  const [isNewTokenFound, setIsNewTokenFound] = useState(false)
  const [hasCriticalSignal, setHasCriticalSignal] = useState(false)
  const prevFeedLengthRef = useRef(0)

  const [growthTriggerPct] = useState(() => {
    const raw = loadSetting('dequanswap.growthTriggerPct', '20')
    const n = Number(raw)
    return Number.isFinite(n) ? n : 20
  })
  const [, setTriggeredCount] = useState(0)
  const triggeredSetRef = useRef<Set<string>>(new Set())
  const [fastModeCapSol, setFastModeCapSol] = useState('0.25')
  const [fastModeStatus, setFastModeStatus] = useState<'disarmed' | 'arming' | 'armed' | 'revoking'>('disarmed')
  const [fastModeError, setFastModeError] = useState<string>('')
  const [fastModeSessionPubkey, setFastModeSessionPubkey] = useState<string>('')
  const [fastModeExpiresAtMs, setFastModeExpiresAtMs] = useState<number>(0)
  const fastModeSessionRef = useRef<Keypair | null>(null)
  const [useDelegateFastModeBuys, setUseDelegateFastModeBuys] = useState(false)

  const botWalletRef = useRef<Keypair | null>(null)
  const [botWalletPubkey, setBotWalletPubkey] = useState<string>('')
  const [botWalletError, setBotWalletError] = useState<string>('')
  const [useBotWalletForTrades, setUseBotWalletForTrades] = useState(false)
  const [botWalletSolLamports, setBotWalletSolLamports] = useState<number | null>(null)

  const [step, setStep] = useState<UiStep>('idle')
  const [error, setError] = useState<string>('')
  const [snipePrompt, setSnipePrompt] = useState<string>('')
  const [txSig, setTxSig] = useState<string>('')
  const [sellStep, setSellStep] = useState<UiStep>('idle')
  const [sellMintInFlight, setSellMintInFlight] = useState<string>('')
  const [sellSig, setSellSig] = useState<string>('')
  const [sellError, setSellError] = useState<string>('')
  const [bgTx, setBgTx] = useState<
    | {
        sig: string
        startedAt: number
        finishedAt?: number
        status: 'confirming' | 'confirmed' | 'timeout' | 'not_found' | 'failed'
        error?: string
      }
    | null
  >(null)

  const uiErrorMeta = useMemo(() => {
    if (!error) return { text: '', title: '' }

    // Beginner-friendly: Jupiter returning no route almost always means token is rugged.
    if (isJupiterNoRouteErrorMessage(error)) {
      return { text: 'Rugged', title: error }
    }

    if (error === 'WebSocket connection error') {
      return { text: `Trading API WebSocket error (dequanW @ ${wsUrl}): could not connect`, title: error }
    }
    if (error === 'WebSocket not connected') {
      return { text: `Trading API WebSocket error (dequanW @ ${wsUrl}): not connected`, title: error }
    }

    // Production uses wallet-signature auth; never show JWT-specific internal phrasing.
    if (error.includes('Wallet signature auth is required')) {
      return { text: 'Signature needed in wallet', title: error }
    }
    if (error.startsWith('WebSocket')) {
      return { text: `Trading API WebSocket error (dequanW @ ${wsUrl}): ${error}`, title: error }
    }

    return { text: error, title: '' }
  }, [error, wsUrl])

  const uiError = uiErrorMeta.text
  const uiErrorTitle = uiErrorMeta.title

  const [solBalanceLamports, setSolBalanceLamports] = useState<number | null>(null)
  const [tokenBalance, setTokenBalance] = useState<{ amount: bigint; decimals: number } | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [balanceError, setBalanceError] = useState('')

  const walletUnlockOk = useMemo(() => {
    if (!connected || !publicKey) return false
    if (!debugAdminPubkey) return false
    return publicKey.toBase58() === debugAdminPubkey
  }, [connected, debugAdminPubkey, publicKey])

  useEffect(() => {
    const kp = loadBotWalletKeypair()
    if (kp) {
      botWalletRef.current = kp
      setBotWalletPubkey(kp.publicKey.toBase58())
    }
  }, [])

  const activeLiveKeypair = useMemo(() => {
    if (!gates.allowFastMode) return null
    if (!useBotWalletForTrades) return null
    return botWalletRef.current
  }, [gates.allowFastMode, useBotWalletForTrades])

  const activeTraderPubkey = useMemo(() => {
    return activeLiveKeypair ? activeLiveKeypair.publicKey : publicKey
  }, [activeLiveKeypair, publicKey])

  const enableFastMode = useCallback(async () => {
    setFastModeError('')
    if (!gates.allowFastMode) return setFastModeError('Fast Mode is locked on this tier')
    if (!publicKey) return setFastModeError('Connect wallet first')
    if (!signTransaction) return setFastModeError('Wallet does not support transaction signing')
    if (fastModeStatus !== 'disarmed') return

    const cap = Number(fastModeCapSol)
    if (!Number.isFinite(cap) || cap <= 0) return setFastModeError('Enter a valid Fast Mode cap (SOL)')

    try {
      setFastModeStatus('arming')
      const sessionKeypair = createFastModeSessionKeypair()
      fastModeSessionRef.current = sessionKeypair
      setFastModeSessionPubkey(sessionKeypair.publicKey.toBase58())

      const capLamports = toLamports(cap)
      const feeTopupLamports = toLamports(0.002)
      const { tx } = await buildArmFastModeTx({
        connection,
        owner: publicKey,
        delegate: sessionKeypair.publicKey,
        capLamports,
        feeTopupLamports,
      })

      const signedTx = await signTransaction(tx)
      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      })
      const status = await confirmSignatureWithFallback(connection, signature, { commitment: 'confirmed' })
      if (status === 'timeout') {
        throw new Error(
          `Transaction was not confirmed in 90.00 seconds. It is unknown if it succeeded or failed. Check signature ${signature} using the Solana Explorer or CLI tools.`,
        )
      }

      const now = Date.now()
      const expires = now + 30 * 60 * 1000
      setFastModeExpiresAtMs(expires)
      setFastModeStatus('armed')
    } catch (e) {
      fastModeSessionRef.current = null
      setFastModeSessionPubkey('')
      setFastModeExpiresAtMs(0)
      setFastModeStatus('disarmed')
      setFastModeError(e instanceof Error ? e.message : 'Failed to enable Fast Mode')
    }
  }, [connection, fastModeCapSol, fastModeStatus, gates.allowFastMode, publicKey, signTransaction])

  const revokeFastMode = useCallback(async () => {
    setFastModeError('')
    if (!publicKey) return setFastModeError('Connect wallet first')
    if (!signTransaction) return setFastModeError('Wallet does not support transaction signing')
    if (fastModeStatus !== 'armed') return

    try {
      setFastModeStatus('revoking')
      const { tx } = await buildRevokeFastModeTx({ connection, owner: publicKey })

      const signedTx = await signTransaction(tx)
      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      })
      const status = await confirmSignatureWithFallback(connection, signature, { commitment: 'confirmed' })
      if (status === 'timeout') {
        throw new Error(
          `Transaction was not confirmed in 90.00 seconds. It is unknown if it succeeded or failed. Check signature ${signature} using the Solana Explorer or CLI tools.`,
        )
      }
    } catch (e) {
      setFastModeError(e instanceof Error ? e.message : 'Failed to revoke Fast Mode')
    } finally {
      fastModeSessionRef.current = null
      setFastModeSessionPubkey('')
      setFastModeExpiresAtMs(0)
      setFastModeStatus('disarmed')
      setUseDelegateFastModeBuys(false)
    }
  }, [connection, fastModeStatus, publicKey, signTransaction])

  useEffect(() => {
    if (fastModeStatus !== 'armed' || !fastModeExpiresAtMs) return
    const id = window.setInterval(() => {
      if (Date.now() >= fastModeExpiresAtMs) {
        // Soft-expire: stop treating the session as armed. Delegate may still be active until revoked on-chain.
        fastModeSessionRef.current = null
        setFastModeSessionPubkey('')
        setFastModeExpiresAtMs(0)
        setFastModeStatus('disarmed')
        setFastModeError('Fast Mode expired (delegate may still be active until revoked)')
        setUseDelegateFastModeBuys(false)
      }
    }, 500)
    return () => window.clearInterval(id)
  }, [fastModeExpiresAtMs, fastModeStatus])

  useEffect(() => saveSetting('dequanswap.wsUrl', wsUrl), [wsUrl])
  useEffect(() => saveSetting('dequanswap.apiKey', apiKey), [apiKey])
  useEffect(() => saveSetting('dequanswap.authToken', authToken), [authToken])
  useEffect(() => saveSetting('dequanswap.dequanwDashBase', dequanwDashBase), [dequanwDashBase])
  useEffect(() => saveTier(tier), [tier])
  useEffect(() => saveSetting('dequanswap.growthTriggerPct', String(growthTriggerPct)), [growthTriggerPct])

  useEffect(() => {
    localStorage.setItem('dequanswap.watchedTokens', JSON.stringify(watched))
  }, [watched])

  const refreshBalances = useCallback(async () => {
    const owner = activeTraderPubkey
    if (!owner) {
      setSolBalanceLamports(null)
      setTokenBalance(null)
      setBalanceLoading(false)
      setBalanceError('')
      return
    }
    setBalanceLoading(true)
    setBalanceError('')

    try {
      const [solLamports, tok] = await Promise.all([
        getSolBalanceLamports(connection, owner),
        (async () => {
          try {
            if (!tokenMint.trim()) return null
            const mint = new PublicKey(tokenMint.trim())
            return await getTokenBalanceBaseUnits(connection, owner, mint)
          } catch {
            return null
          }
        })(),
      ])

      setSolBalanceLamports(solLamports)
      setTokenBalance(tok)
    } catch (e) {
      setSolBalanceLamports(null)
      setTokenBalance(null)
      setBalanceError(e instanceof Error ? e.message : 'Failed to fetch balances')
    } finally {
      setBalanceLoading(false)
    }
  }, [activeTraderPubkey, connection, tokenMint])

  useEffect(() => {
    void refreshBalances()
  }, [refreshBalances])

  useEffect(() => {
    // If the wallet disconnects, drop the WS connection.
    if (connected) return

    wsRef.current?.close()
    setWsStatus('disconnected')
    setWsAuthed(false)
  }, [connected])

  const refreshBotWalletBalance = useCallback(async () => {
    const kp = botWalletRef.current
    if (!kp) {
      setBotWalletSolLamports(null)
      return
    }
    const bal = await getSolBalanceLamports(connection, kp.publicKey)
    setBotWalletSolLamports(bal)
  }, [connection, pushDebugEvent])

  useEffect(() => {
    void refreshBotWalletBalance()
  }, [refreshBotWalletBalance, botWalletPubkey])

  useEffect(() => {
    // Load wallet-specific holdings when wallet connects or changes
    if (publicKey) {
      const wallet = publicKey.toBase58()
      try {
        const stored = localStorage.getItem(`dequanswap.holdings.${wallet}`)
        const parsed = parseHoldings(stored)
        setHoldings(parsed)
      } catch {
        setHoldings([])
      }
    } else {
      setHoldings([])
    }
  }, [publicKey])

  useEffect(() => {
    // Load wallet-specific sold tokens when wallet connects or changes
    if (publicKey) {
      const wallet = publicKey.toBase58()
      try {
        const stored = localStorage.getItem(`dequanswap.soldTokens.${wallet}`)
        const parsed = parseSoldTokens(stored)
        setSoldTokens(parsed)
      } catch {
        setSoldTokens([])
      }
    } else {
      setSoldTokens([])
    }
  }, [publicKey])

  const connectTradingApi = useCallback(async () => {
    setError('')
    setTxSig('')
    setStep('connecting')

    pushDebugEvent({ area: 'ws', level: 'info', message: 'Trading WS connect requested', detail: wsUrl })

    const walletSigAvailable = Boolean(publicKey && signMessage)
    if (!walletSigAvailable) {
      wsRef.current?.close()
      wsRef.current = null
      setWsStatus('disconnected')
      setStep('idle')
      setError('Signature needed in wallet')
      return
    }

    try {
      wsRef.current?.close()
      const ws = new TradingWs({
        url: wsUrl,
        wallet: walletSigAvailable ? publicKey!.toBase58() : undefined,
        signMessage: walletSigAvailable ? signMessage! : undefined,
        apiKey: apiKey.trim() || undefined,
        authToken: authToken.trim() || undefined,
      })
      wsRef.current = ws
      await ws.connect()
      setTradingApiHealth(null)
      setWsStatus('connected')
      setWsAuthed(ws.isAuthed)
      setLastWsConnectedAt(Date.now())
      pushDebugEvent({ area: 'ws', level: 'info', message: 'Trading WS connected', detail: wsUrl })
      setStep('idle')
    } catch (e) {
      recordTradingApiError(e)
      setWsStatus('disconnected')
      setWsAuthed(false)
      setLastWsErrorAt(Date.now())
      pushDebugEvent({
        area: 'ws',
        level: 'error',
        message: 'Trading WS connect failed',
        detail: e instanceof Error ? e.message : String(e || 'connect failed'),
      })
      setStep('idle')
      if (e instanceof Error && e.message === 'WebSocket connection error') {
        const healthzHint = (() => {
          try {
            const u = new URL(wsUrl)
            u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:'
            u.pathname = '/healthz'
            u.search = ''
            u.hash = ''
            return u.toString()
          } catch {
            return ''
          }
        })()

        setError(
          healthzHint
            ? `Could not connect. If Cloudflare Access is enabled, open ${healthzHint} in a new tab, complete Access login, then retry.`
            : 'Could not connect. If Cloudflare Access is enabled, complete Access login for the WS hostname and retry.',
        )
      } else {
        setError(e instanceof Error ? e.message : 'Failed to connect Trading API')
      }
    }
  }, [apiKey, authToken, publicKey, signMessage, pushDebugEvent, recordTradingApiError, wsUrl])

  // Do not auto-connect on mount.
  // We connect on-demand (quotes/snipe) or via the Debug Portal button.

  const validateMint = useCallback(() => {
    const mintStr = tokenMint.trim()
    if (!mintStr) throw new Error('Token mint is required')
    return new PublicKey(mintStr)
  }, [tokenMint])

  const ensureWs = useCallback(async () => {
    const walletSigAvailable = Boolean(publicKey && signMessage)
    const desiredWallet = walletSigAvailable ? publicKey!.toBase58() : undefined
    const desiredApiKey = apiKey.trim() || undefined
    const desiredAuthToken = authToken.trim() || undefined
    const desiredAuthKey = [desiredApiKey || '', desiredAuthToken || '', desiredWallet || ''].join('|')

    // If auth settings changed (e.g. JWT minted after initial connect), force a reconnect.
    // Otherwise we can end up with an open-but-unauthenticated socket and get "Unauthorized" on snipe.
    if (wsRef.current && wsRef.current.isOpen) {
      const authMismatch = wsRef.current.authKey !== desiredAuthKey
      const shouldRequireAuthed = Boolean(desiredWallet || desiredApiKey || desiredAuthToken)
      const notAuthedButRequired = shouldRequireAuthed && !wsRef.current.isAuthed

      if (authMismatch || notAuthedButRequired) {
        wsRef.current.close()
        wsRef.current = null
        setWsStatus('disconnected')
        setWsAuthed(false)
      }
    }

    if (!wsRef.current) {
      wsRef.current = new TradingWs({
        url: wsUrl,
        wallet: desiredWallet,
        signMessage: walletSigAvailable ? signMessage! : undefined,
        apiKey: desiredApiKey,
        authToken: desiredAuthToken,
      })
    }

    if (!walletSigAvailable && !desiredApiKey && !desiredAuthToken) {
      // Ensure we don't keep an open-but-unauthenticated socket around.
      wsRef.current.close()
      wsRef.current = null
      setWsStatus('disconnected')
      setWsAuthed(false)
      throw new Error('Signature needed in wallet')
    }

    if (!wsRef.current.isOpen) {
      try {
        await wsRef.current.connect()
        setWsStatus('connected')
        setWsAuthed(wsRef.current.isAuthed)
        setLastWsConnectedAt(Date.now())
      } catch (e) {
        recordTradingApiError(e)
        setWsStatus('disconnected')
        setWsAuthed(false)
        setLastWsErrorAt(Date.now())
        throw e
      }
    }

    return wsRef.current
  }, [apiKey, authToken, publicKey, recordTradingApiError, signMessage, wsUrl])

  const autoAuthedWalletRef = useRef<string>('')
  const autoAuthInFlightRef = useRef(false)

  useEffect(() => {
    // Force wallet-signature auth immediately after connecting.
    // This makes Phantom show the signature prompt right away (instead of waiting for a later action like Snipe).
    if (!connected || !publicKey || !signMessage) {
      autoAuthedWalletRef.current = ''
      autoAuthInFlightRef.current = false
      return
    }

    const wallet = publicKey.toBase58()
    if (autoAuthInFlightRef.current) return
    if (autoAuthedWalletRef.current === wallet) return
    if (wsRef.current?.isOpen && wsRef.current?.isAuthed) {
      autoAuthedWalletRef.current = wallet
      return
    }

    autoAuthInFlightRef.current = true
    void (async () => {
      setWalletActionHint('signature')
      try {
        await ensureWs()
        autoAuthedWalletRef.current = wallet
        setWsAuthed(wsRef.current?.isAuthed ?? false)
      } catch (e) {
        recordTradingApiError(e)
        // Don't spam retries; user can retry later via actions that call ensureWs() (e.g. Snipe).
        setError(e instanceof Error ? e.message : 'Failed to authenticate wallet')
      } finally {
        setWalletActionHint('')
        autoAuthInFlightRef.current = false
      }
    })()
  }, [connected, ensureWs, publicKey, recordTradingApiError, signMessage])

  const retryWalletAuth = useCallback(() => {
    if (!connected || !publicKey || !signMessage) {
      setError('Connect wallet')
      return
    }
    if (autoAuthInFlightRef.current) return

    // Clear the one-time guard so we will attempt auth again.
    autoAuthedWalletRef.current = ''
    autoAuthInFlightRef.current = true

    void (async () => {
      setWalletActionHint('signature')
      try {
        await ensureWs()
        autoAuthedWalletRef.current = publicKey.toBase58()
        setWsAuthed(wsRef.current?.isAuthed ?? false)
      } catch (e) {
        recordTradingApiError(e)
        setWsAuthed(false)
        setError(e instanceof Error ? e.message : 'Failed to authenticate wallet')
      } finally {
        setWalletActionHint('')
        autoAuthInFlightRef.current = false
      }
    })()
  }, [connected, ensureWs, publicKey, recordTradingApiError, signMessage])

  const quoteWatchedMint = useCallback(
    async (mint: string) => {
      if (Date.now() < userRateLimitUntilMs) return

      const quoteUserPubkey = publicKey?.toBase58() || READONLY_PUBKEY

      let ws: TradingWs
      try {
        ws = await ensureWs()
      } catch {
        return
      }

      const amountInLamports = toLamports(Number(amountSol))
      if (amountInLamports <= 0) return

      try {
        const quote = await ws.request<QuoteResult>(
          {
            type: 'quote',
            params: {
              userPubkey: quoteUserPubkey,
              inputMint: SOL_MINT,
              outputMint: mint,
              amountIn: amountInLamports.toString(),
              slippageBps: clamp(slippageBps, 0, 50_000),
            },
          },
          (m): m is QuoteResult => m.type === 'quote_result',
          12_000,
        )

        if (!quote.success || !quote.data?.amountOut || !quote.data?.amountIn) throw new Error('Quote failed')

        const amountOutBaseUnits = BigInt(quote.data.amountOut)
        const amountIn = BigInt(quote.data.amountIn)
        const priceProxyScaled = computePriceProxyScaled(amountIn, amountOutBaseUnits)

        // Best-effort numeric proxy for UI display.
        const proxyNum =
          bigintAbs(priceProxyScaled) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(priceProxyScaled) / Number(PRICE_PROXY_SCALE) : undefined

        setWatched((prev) =>
          prev.map((x) => {
            if (x.mint !== mint) return x
            const baseScaled = x.basePriceProxyScaled ? bigintFromString(x.basePriceProxyScaled) : priceProxyScaled

            // Avoid Number() overflow (Infinity/NaN) for illiquid tokens.
            // Compute percent growth using bigint math, clamped to a sane range.
            let growthPct: number | undefined
            if (baseScaled > 0n) {
              const delta = priceProxyScaled - baseScaled
              const pctTimes100 = (delta * 10000n) / baseScaled // percent * 100
              const maxPctTimes100 = 100_000_000n // 1,000,000.00%
              const clamped =
                pctTimes100 > maxPctTimes100 ? maxPctTimes100 : pctTimes100 < -maxPctTimes100 ? -maxPctTimes100 : pctTimes100
              growthPct = Number(clamped) / 100
            }

            return {
              ...x,
              error: undefined,
              basePriceProxyScaled: x.basePriceProxyScaled ?? baseScaled.toString(),
              lastPriceProxyScaled: priceProxyScaled.toString(),
              // Keep legacy numeric fields best-effort; avoid storing Infinity.
              basePriceProxy:
                bigintAbs(baseScaled) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(baseScaled) / Number(PRICE_PROXY_SCALE) : x.basePriceProxy,
              lastPriceProxy:
                bigintAbs(priceProxyScaled) <= BigInt(Number.MAX_SAFE_INTEGER)
                  ? Number(priceProxyScaled) / Number(PRICE_PROXY_SCALE)
                  : x.lastPriceProxy,
              growthPct: typeof growthPct === 'number' && Number.isFinite(growthPct) ? growthPct : x.growthPct ?? 0,
              lastUpdatedAt: Date.now(),
            }
          }),
        )

        // Mirror quote-proxy updates into Holdings too (Phase 1 requirement).
        setHoldings((prev) =>
          prev.map((h) => {
            if (h.mint !== mint) return h
            const entryScaled = h.entryPriceProxyScaled ? bigintFromString(h.entryPriceProxyScaled) : priceProxyScaled

            let growthPct: number | undefined
            if (entryScaled > 0n) {
              const delta = priceProxyScaled - entryScaled
              const pctTimes100 = (delta * 10000n) / entryScaled
              const maxPctTimes100 = 100_000_000n
              const clamped =
                pctTimes100 > maxPctTimes100 ? maxPctTimes100 : pctTimes100 < -maxPctTimes100 ? -maxPctTimes100 : pctTimes100
              growthPct = Number(clamped) / 100
            }

            const entryNum =
              bigintAbs(entryScaled) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(entryScaled) / Number(PRICE_PROXY_SCALE) : h.entryPriceProxy

            const changed =
              h.lastPriceProxyScaled !== priceProxyScaled.toString() ||
              h.entryPriceProxyScaled !== (h.entryPriceProxyScaled ?? entryScaled.toString()) ||
              h.proxyGrowthPct !== (typeof growthPct === 'number' && Number.isFinite(growthPct) ? growthPct : h.proxyGrowthPct)
            if (!changed) return h

            return {
              ...h,
              entryPriceProxyScaled: h.entryPriceProxyScaled ?? entryScaled.toString(),
              lastPriceProxyScaled: priceProxyScaled.toString(),
              entryPriceProxy: h.entryPriceProxy ?? entryNum,
              lastPriceProxy: proxyNum ?? h.lastPriceProxy,
              proxyGrowthPct: typeof growthPct === 'number' && Number.isFinite(growthPct) ? growthPct : h.proxyGrowthPct,
            }
          }),
        )
      } catch (e) {
        recordTradingApiError(e)
        if (isUserRateLimitedError(e)) {
          bumpUserRateLimitBackoff()
          return
        }
        const msg = e instanceof Error ? e.message : 'Quote failed'
        setWatched((prev) => prev.map((x) => (x.mint === mint ? { ...x, error: msg, lastUpdatedAt: Date.now() } : x)))
      }
    },
    [amountSol, bumpUserRateLimitBackoff, ensureWs, isUserRateLimitedError, publicKey, recordTradingApiError, slippageBps, userRateLimitUntilMs],
  )

  const addWatchedToken = useCallback(() => {
    setError('')
    const mintStr = watchMintInput.trim()
    if (!mintStr) return
    try {
      // validate
      void new PublicKey(mintStr)
    } catch {
      setError('Invalid token mint')
      return
    }

    setWatched((prev) => {
      if (prev.find((t) => t.mint === mintStr)) return prev
      if (prev.length >= gates.maxWatchedTokens) {
        setError(`Watchlist limit reached for tier (${gates.maxWatchedTokens})`)
        return prev
      }
      return [{ mint: mintStr, addedAt: Date.now(), growthPct: 0, lastUpdatedAt: Date.now() }, ...prev]
    })
    setWatchMintInput('')

    // Prime MC/Growth immediately from current feed snapshot (if present).
    primeWatchedFromFeed(mintStr)

    // Prime Growth immediately. We retry because the state update may land after the first tick.
    window.setTimeout(() => void quoteWatchedMint(mintStr), 150)
    window.setTimeout(() => void quoteWatchedMint(mintStr), 650)
    window.setTimeout(() => void quoteWatchedMint(mintStr), 1500)
  }, [gates.maxWatchedTokens, primeWatchedFromFeed, quoteWatchedMint, watchMintInput])

  const watchMint = useCallback(
    (mintStr: string) => {
      setError('')
      const m = mintStr.trim()
      if (!m) return
      try {
        void new PublicKey(m)
      } catch {
        setError('Invalid token mint')
        return
      }

      const wasEmpty = watched.length === 0

      setWatched((prev) => {
        if (prev.find((t) => t.mint === m)) return prev
        if (prev.length >= gates.maxWatchedTokens) {
          setError(`Watchlist limit reached for tier (${gates.maxWatchedTokens})`)
          return prev
        }
        return [{ mint: m, addedAt: Date.now(), growthPct: 0, lastUpdatedAt: Date.now() }, ...prev]
      })

      // Remove from feed once added to watching (mirror buy -> holdings behavior)
      setFeed((prev) => prev.filter((t) => t.mint !== m))

      // Auto-expand watching section if it was empty
      if (wasEmpty) {
        setWatchingOpen(true)
      }

      // Prime MC/Growth immediately from current feed snapshot (if present).
      primeWatchedFromFeed(m)

      // Prime Growth immediately. We retry because the state update may land after the first tick.
      window.setTimeout(() => void quoteWatchedMint(m), 150)
      window.setTimeout(() => void quoteWatchedMint(m), 650)
      window.setTimeout(() => void quoteWatchedMint(m), 1500)
    },
    [gates.maxWatchedTokens, primeWatchedFromFeed, quoteWatchedMint, watched.length],
  )

  useEffect(() => {
    if (!feed.length) return
    // Keep the manual watchlist synced with dequanW MC data whenever it exists in the current feed snapshot.
    setWatched((prev) =>
      prev.map((w) => {
        const f = feed.find((x) => x.mint === w.mint)
        if (!f) return w

        const feedSymbol = typeof f.symbol === 'string' && f.symbol.trim() ? f.symbol.trim() : undefined
        const feedName = typeof f.name === 'string' && f.name.trim() ? f.name.trim() : undefined

        const feedEntry = typeof f.mcEntry === 'number' ? f.mcEntry : typeof f.detectedMc === 'number' ? f.detectedMc : undefined
        const feedCurrent =
          typeof f.mcCurrent === 'number' ? f.mcCurrent : typeof f.detectedMc === 'number' ? f.detectedMc : undefined
        if (typeof feedEntry !== 'number' && typeof feedCurrent !== 'number') return w

        const nextEntry = w.entryMc ?? feedEntry ?? feedCurrent
        const nextCurrent = feedCurrent ?? w.currentMc
        const nextGrowth = computeGrowthPct(nextEntry, nextCurrent)

        const nextSymbol = w.symbol ?? feedSymbol
        const nextName = w.name ?? feedName

        const mcChanged = nextEntry !== w.entryMc || nextCurrent !== w.currentMc

        const changed =
          nextEntry !== w.entryMc ||
          nextCurrent !== w.currentMc ||
          nextGrowth !== w.growthPct ||
          nextSymbol !== w.symbol ||
          nextName !== w.name
        if (!changed) return w

        return {
          ...w,
          symbol: nextSymbol,
          name: nextName,
          entryMc: nextEntry,
          currentMc: nextCurrent,
          mcUpdatedAt: mcChanged ? Date.now() : w.mcUpdatedAt,
          growthPct: nextGrowth ?? w.growthPct,
          lastUpdatedAt: Date.now(),
        }
      }),
    )
  }, [feed])

  useEffect(() => {
    if (!feed.length) return
    setHoldings((prev) =>
      prev.map((h) => {
        const snap = getFeedMcSnapshot(h.mint)
        const nextCurrent = snap.current ?? h.currentMc
        const nextName = h.name ?? snap.name
        const nextSymbol = h.symbol ?? snap.symbol
        const nextIsRugged = h.isRugged ?? snap.isRugged
        const nextLiquidityStatus = h.liquidityStatus ?? snap.liquidityStatus

        const changed =
          nextCurrent !== h.currentMc ||
          nextName !== h.name ||
          nextSymbol !== h.symbol ||
          nextIsRugged !== h.isRugged ||
          nextLiquidityStatus !== h.liquidityStatus
        if (!changed) return h

        return {
          ...h,
          currentMc: nextCurrent,
          name: nextName,
          symbol: nextSymbol,
          isRugged: nextIsRugged,
          liquidityStatus: nextLiquidityStatus,
        }
      }),
    )
  }, [feed, getFeedMcSnapshot])

  const fetchDequanwFeed = useCallback(async () => {
    setFeedError('')
    const base = dequanwDashBase.trim().replace(/\/$/, '')
    if (!base) return

    const headers: Record<string, string> = {}
    if (apiKey.trim()) headers['x-api-key'] = apiKey.trim()

    const includeRugged = debugIncludeRugged ? '&includeRugged=1' : ''
    const feedUrl = `${base}/feed?limit=30${includeRugged}`
    const watchingUrl = `${base}/watching?limit=30${includeRugged}`

    let feedJson: DequanwFeedResponse
    let watchingJson: DequanwWatchingResponse
    try {
      const [feedRes, watchingRes] = await Promise.all([
        fetch(feedUrl, { cache: 'no-store', headers }),
        fetch(watchingUrl, { cache: 'no-store', headers }),
      ])

      if (!feedRes.ok) throw new Error(`Feed HTTP ${feedRes.status}`)
      if (!watchingRes.ok) throw new Error(`Watching HTTP ${watchingRes.status}`)

      feedJson = (await feedRes.json()) as DequanwFeedResponse
      watchingJson = (await watchingRes.json()) as DequanwWatchingResponse
    } catch (e) {
      setFeedError(e instanceof Error ? e.message : 'Feed fetch failed')
      return
    }

    // Tiny sample for the Debug Portal (passcode-gated UI).
    setFeedSampleDebug({
      rawFeedFirstItem: feedJson.items?.[0] ?? undefined,
      rawWatchingFirstItem: watchingJson.items?.[0] ?? undefined,
    })

    setLastFeedFetchedAt(Date.now())

    const out: FeedToken[] = []
    const pushRow = (mint: string, meta: Partial<FeedToken>) => {
      if (!mint) return
      if (out.find((x) => x.mint === mint)) return
      out.push({ mint, source: 'dequanw', ...meta })
    }

    // Currently Watching
    for (const r of watchingJson.items || []) {
      const mint = r.tokenAddress || ''
      const startedAt = toEpochMs(r.startTime ?? r.detectionTime)
      const mcEntry = toPositiveNumber(r.entryMarketCap)
      const mcCurrent = toPositiveNumber(r.latestMarketCap)
      const detectedMc = mcCurrent ?? mcEntry
      const isRugged = r.isRugged === true || r.liquidityStatus === 'removed'
      pushRow(mint, {
        name: r.tokenName || undefined,
        symbol: r.tokenSymbol || undefined,
        startedAt,
        detectedMc,
        mcEntry,
        mcCurrent,
        mcGrowthPct: computeGrowthPct(mcEntry, mcCurrent),
        isRugged,
        liquidityStatus: r.liquidityStatus ?? (isRugged ? 'removed' : 'active'),
        liquidityRemovedAt: toEpochMs(r.liquidityRemovedAt),
        liquidityRemovedSig: r.liquidityRemovedSig ?? undefined,
        liquidityRemovedInstruction: r.liquidityRemovedInstruction ?? undefined,
        liquidityRemovedReason: r.liquidityRemovedReason ?? undefined,
      })
    }

    // Recent Evaluations
    for (const e of feedJson.items || []) {
      const mint = e.tokenAddress || ''
      const mcEntry = toPositiveNumber(e.entryMC)
      const mcCurrent = toPositiveNumber(e.currentMC)
      const detectedMc = mcCurrent ?? mcEntry
      const isRugged = e.isRugged === true || e.liquidityStatus === 'removed'
      pushRow(mint, {
        name: e.tokenName || undefined,
        symbol: e.tokenSymbol || undefined,
        startedAt: toEpochMs(e.timestamp),
        detectedMc,
        mcEntry,
        mcCurrent,
        mcGrowthPct: computeGrowthPct(mcEntry, mcCurrent),
        isRugged,
        liquidityStatus: e.liquidityStatus ?? (isRugged ? 'removed' : 'active'),
        liquidityRemovedAt: toEpochMs(e.liquidityRemovedAt),
        liquidityRemovedSig: e.liquidityRemovedSig ?? undefined,
        liquidityRemovedInstruction: e.liquidityRemovedInstruction ?? undefined,
        liquidityRemovedReason: e.liquidityRemovedReason ?? undefined,
      })
    }

    setFeedSampleDebug((prev) => {
      const first = out[0]
      if (!first) return prev
      return {
        ...(prev || {}),
        mappedFirstRow: {
          mint: first.mint,
          symbol: first.symbol,
          name: first.name,
          startedAt: first.startedAt,
          mcEntry: first.mcEntry,
          mcCurrent: first.mcCurrent,
          detectedMc: first.detectedMc,
          mcGrowthPct: first.mcGrowthPct,
        },
      }
    })

    // Keep newest/active up top
    out.sort((a, b) => {
      const aa = a.startedAt ?? 0
      const bb = b.startedAt ?? 0
      return bb - aa
    })

    const filtered = debugIncludeRugged ? out : out.filter((t) => !t.isRugged)
    setFeed(filtered.slice(0, 30))
  }, [apiKey, dequanwDashBase, debugIncludeRugged])

  const removeWatchedToken = useCallback((mint: string) => {
    setWatched((prev) => prev.filter((t) => t.mint !== mint))
  }, [])

  const pollQuotes = useCallback(async () => {
    if (Date.now() < userRateLimitUntilMs) return
    const watchedMints = watched.slice(0, gates.maxWatchedTokens).map((x) => x.mint)
    const holdingMints = holdings.slice(0, 12).map((h) => h.mint)
    const mints = Array.from(new Set([...watchedMints, ...holdingMints]))
    if (!mints.length) return

    // Sequential polling keeps traffic predictable.
    for (const mint of mints) {
      await quoteWatchedMint(mint)
    }
  }, [gates.maxWatchedTokens, holdings, quoteWatchedMint, watched, userRateLimitUntilMs])

  useEffect(() => {
    // Count unique trigger hits per session.
    if (!Number.isFinite(growthTriggerPct)) return
    for (const t of watched) {
      if (t.growthPct === undefined) continue
      if (t.growthPct < growthTriggerPct) continue
      if (triggeredSetRef.current.has(t.mint)) continue
      triggeredSetRef.current.add(t.mint)
      setTriggeredCount((c) => c + 1)
    }
  }, [growthTriggerPct, watched])

  useEffect(() => {
    const id = setInterval(() => {
      void pollQuotes()
    }, gates.quotePollMs)
    return () => clearInterval(id)
  }, [gates.quotePollMs, pollQuotes])

  // Detect new tokens and critical signals
  useEffect(() => {
    if (feed.length > prevFeedLengthRef.current) {
      setIsNewTokenFound(true)
      setTimeout(() => setIsNewTokenFound(false), 100)
      
      // Check if any new token has critical signal (>50% growth)
      const hasCritical = feed
        .slice(0, feed.length - prevFeedLengthRef.current)
        .some((t) => (t.mcGrowthPct ?? 0) > 50)
      if (hasCritical) {
        setHasCriticalSignal(true)
        setTimeout(() => setHasCriticalSignal(false), 2000)
      }
    }
    prevFeedLengthRef.current = feed.length
  }, [feed])

  useEffect(() => {
    void fetchDequanwFeed()
    const id = setInterval(() => {
      void fetchDequanwFeed()
    }, 5000)
    return () => clearInterval(id)
  }, [fetchDequanwFeed])

  const clearSnipeForm = useCallback(() => {
    setError('')
    setSnipePrompt('')
    setTxSig('')
    setTokenMint('')
    setAmountSol('0.01')
    setSlippageBps(4000)
  }, [])

  const buy = useCallback(async () => {
    setError('')
    setSnipePrompt('')
    setTxSig('')

    if (!gates.allowLiveTrading) {
      return setError(`Live trading is locked on this plan — upgrade to snipe (current plan: ${tierDisplayName(tier)})`)
    }

    if (Date.now() < userRateLimitUntilMs) {
      return setError('Rate limited — backing off briefly')
    }
    const walletSigAvailable = Boolean(publicKey && connected && signMessage)

    // Production Trading API requires wallet-signature auth.
    if (!walletSigAvailable) {
      return setError('Signature needed in wallet')
    }

    const botKp = activeLiveKeypair
    const sessionKp =
      fastModeStatus === 'armed' && useDelegateFastModeBuys && !useBotWalletForTrades
        ? fastModeSessionRef.current
        : null
    const traderPk = botKp ? botKp.publicKey : sessionKp ? sessionKp.publicKey : publicKey

    if (!traderPk) return setError('Connect wallet (or enable Bot Wallet)')
    if (!botKp && !sessionKp && !signTransaction) return setError('Wallet does not support transaction signing')

    try {
      const mint = validateMint()
      const sol = Number(amountSol)
      if (!Number.isFinite(sol) || sol <= 0) throw new Error('Enter a valid SOL amount')

      const lamports = toLamports(sol)

      // Only show this prompt when the user explicitly presses Snipe.
      setStep('connecting')
      if (walletSigAvailable) setSnipePrompt('Signature needed in wallet')

      const runWs = async <T,>(fn: (ws: TradingWs) => Promise<T>): Promise<T> => {
        let ws = await ensureWs()
        try {
          return await fn(ws)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e || '')
          const retryable = msg === 'WebSocket not connected' || msg === 'WebSocket connection error'
          if (!retryable) throw e

          // One-time reconnect+retry: handles dropped sockets / initial connect race.
          try {
            wsRef.current?.close()
          } catch {
            // ignore
          }
          wsRef.current = null
          setWsStatus('disconnected')
          ws = await ensureWs()
          return await fn(ws)
        }
      }

      setSnipePrompt('')

      const ownerPk = sessionKp ? publicKey : null
      if (sessionKp && !ownerPk) throw new Error('Connect wallet (owner) for delegate Fast Mode')
      const ownerOutAta = ownerPk
        ? getAssociatedTokenAddressSync(mint, ownerPk, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
        : null

      setStep('quoting')
      const quote = await runWs((ws) =>
        ws.request<QuoteResult>(
          {
            type: 'quote',
            params: {
              userPubkey: traderPk.toBase58(),
              inputMint: SOL_MINT,
              outputMint: mint.toBase58(),
              amountIn: lamports.toString(),
              slippageBps: clamp(slippageBps, 0, 50_000),
            },
          },
          (m): m is QuoteResult => m.type === 'quote_result',
        ),
      )

      if (!quote.success || !quote.data?.route) throw new Error('Quote failed')

      // Phase 1: capture a quote-based entry proxy for holdings (best-effort).
      let entryPriceProxyScaled: bigint | null = null
      try {
        if (quote.data?.amountIn && quote.data?.amountOut) {
          entryPriceProxyScaled = computePriceProxyScaled(BigInt(quote.data.amountIn), BigInt(quote.data.amountOut))
        }
      } catch {
        entryPriceProxyScaled = null
      }

      const serializedQuote = quote.data.route.serializedQuote
      if (!serializedQuote) {
        throw new Error('Quote missing route.serializedQuote (server must include it for build_swap_tx)')
      }

      setStep('building')
      const built = await runWs((ws) =>
        ws.request<BuildSwapTxResult>(
          {
            type: 'build_swap_tx',
            params: {
              userPubkey: traderPk.toBase58(),
              quote: {
                provider: 'jupiter',
                serializedQuote,
              },
              ...(sessionKp
                ? {
                    wrapAndUnwrapSol: false,
                    asLegacyTransaction: true,
                    destinationTokenAccount: ownerOutAta!.toBase58(),
                  }
                : {}),
            },
          },
          (m): m is BuildSwapTxResult => m.type === 'build_swap_tx_result',
        ),
      )

      if (!built.success || !built.data) throw new Error('Failed to build transaction')
      const txBase64 = built.data.transactionBase64 || built.data.swapTransaction
      if (!txBase64) throw new Error('build_swap_tx_result missing transactionBase64')

      setStep('signing')
      const unsignedTx = deserializeTx(txBase64)

      const confirmInBackground = (signature: string, mintBase58: string, entryProxyScaled: bigint | null) => {
        setBgTx({ sig: signature, startedAt: Date.now(), status: 'confirming' })
        pushDebugEvent({ area: 'trade', level: 'info', message: 'Tx submitted (bg confirm)', detail: signature })
        void (async () => {
          try {
            const status = await confirmSignatureWithFallback(connection, signature, {
              commitment: 'confirmed',
              timeoutMs: 30_000,
              pollIntervalMs: 1000,
            })

            if (status === 'not_found') {
              setBgTx((prev) =>
                prev && prev.sig === signature
                  ? { ...prev, status: 'not_found', finishedAt: Date.now(), error: 'Signature not found on chain (dropped?)' }
                  : prev,
              )
              pushDebugEvent({ area: 'trade', level: 'warn', message: 'Bg confirm not found', detail: signature })
              return
            }

            if (status === 'timeout') {
              setBgTx((prev) =>
                prev && prev.sig === signature ? { ...prev, status: 'timeout', finishedAt: Date.now() } : prev,
              )
              pushDebugEvent({ area: 'trade', level: 'warn', message: 'Bg confirm timed out', detail: signature })
              return
            }

            setBgTx((prev) =>
              prev && prev.sig === signature ? { ...prev, status: 'confirmed', finishedAt: Date.now() } : prev,
            )
            pushDebugEvent({ area: 'trade', level: 'info', message: 'Bg confirm confirmed', detail: signature })

            const entryNum =
              entryProxyScaled && bigintAbs(entryProxyScaled) <= BigInt(Number.MAX_SAFE_INTEGER)
                ? Number(entryProxyScaled) / Number(PRICE_PROXY_SCALE)
                : undefined

            addHolding(mintBase58, {
              entryPriceProxyScaled: entryProxyScaled ? entryProxyScaled.toString() : undefined,
              lastPriceProxyScaled: entryProxyScaled ? entryProxyScaled.toString() : undefined,
              entryPriceProxy: entryNum,
              lastPriceProxy: entryNum,
              proxyGrowthPct: 0,
            })
            await refreshBalances()
            await refreshBotWalletBalance()
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Buy confirmation failed'
            setBgTx((prev) =>
              prev && prev.sig === signature ? { ...prev, status: 'failed', finishedAt: Date.now(), error: msg } : prev,
            )
            pushDebugEvent({ area: 'trade', level: 'error', message: 'Bg confirm failed', detail: msg })
            recordTradingApiError(e)
            setError(msg)
          }
        })()
      }

      if (sessionKp) {
        if (!(unsignedTx instanceof Transaction)) {
          throw new Error('Delegate Fast Mode requires legacy transaction (asLegacyTransaction)')
        }

        const jupTx = unsignedTx
        const computeBudgetProgram = new PublicKey('ComputeBudget111111111111111111111111111111')
        const computeIxs: typeof jupTx.instructions = []
        const restIxs: typeof jupTx.instructions = []
        for (const ix of jupTx.instructions) {
          if (ix.programId.equals(computeBudgetProgram)) computeIxs.push(ix)
          else restIxs.push(ix)
        }

        const ownerWsolAta = getAssociatedTokenAddressSync(
          NATIVE_MINT,
          ownerPk!,
          false,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        )
        const sessionWsolAta = getAssociatedTokenAddressSync(
          NATIVE_MINT,
          sessionKp.publicKey,
          false,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        )

        const combined = new Transaction()
        combined.feePayer = sessionKp.publicKey

        for (const ix of computeIxs) combined.add(ix)

        combined.add(
          createAssociatedTokenAccountIdempotentInstruction(
            sessionKp.publicKey,
            ownerOutAta!,
            ownerPk!,
            mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        )

        combined.add(createTransferInstruction(ownerWsolAta, sessionWsolAta, sessionKp.publicKey, lamports, [], TOKEN_PROGRAM_ID))
        for (const ix of restIxs) combined.add(ix)

        const { blockhash } = await connection.getLatestBlockhash('confirmed')
        combined.recentBlockhash = blockhash

        const signed = signTxWithKeypair(combined, sessionKp)
        setStep('submitting')
        const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 })
        setTxSig(signature)

        // UX: treat signature receipt as immediate success, confirm asynchronously.
        setStep('idle')
        confirmInBackground(signature, mint.toBase58(), entryPriceProxyScaled)
        return
      }

      const signedTx = botKp ? signTxWithKeypair(unsignedTx, botKp) : await signTransaction!(unsignedTx)

      setStep('submitting')
      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      })
      setTxSig(signature)

      // UX: treat signature receipt as immediate success, confirm asynchronously.
      setStep('idle')
      confirmInBackground(signature, mint.toBase58(), entryPriceProxyScaled)
    } catch (e) {
      setSnipePrompt('')
      recordTradingApiError(e)
      if (isUserRateLimitedError(e)) {
        bumpUserRateLimitBackoff()
        setStep('idle')
        setSnipePrompt('')
        setError('Rate limited — retrying soon')
        return
      }
      setStep('idle')
      setError(e instanceof Error ? e.message : 'Buy failed')
    }
  }, [
    activeLiveKeypair,
    addHolding,
    amountSol,
    bumpUserRateLimitBackoff,
    connection,
    connected,
    ensureWs,
    fastModeStatus,
    gates.allowLiveTrading,
    isUserRateLimitedError,
    publicKey,
    recordTradingApiError,
    refreshBalances,
    refreshBotWalletBalance,
    signTransaction,
    signMessage,
    slippageBps,
    tier,
    tokenMint,
    userRateLimitUntilMs,
    useBotWalletForTrades,
    useDelegateFastModeBuys,
    validateMint,
  ])

  const sell = useCallback(
    async (mint: string, pct: number = 100) => {
      setSellError('')
      setSellSig('')
      setSellMintInFlight(mint)

      if (!gates.allowLiveTrading) {
        setSellMintInFlight('')
        return setSellError(`Live trading is locked on this plan (current plan: ${tierDisplayName(tier)})`)
      }

      if (Date.now() < userRateLimitUntilMs) {
        setSellMintInFlight('')
        return setSellError('Rate limited — backing off briefly')
      }

      const walletSigAvailable = Boolean(publicKey && connected && signMessage)
      if (!walletSigAvailable) {
        setSellMintInFlight('')
        return setSellError('Signature needed in wallet')
      }

      const botKp = activeLiveKeypair
      const traderPk = botKp ? botKp.publicKey : publicKey

      if (!traderPk) {
        setSellMintInFlight('')
        return setSellError('Connect wallet (or enable Bot Wallet)')
      }
      if (!botKp && !signTransaction) {
        setSellMintInFlight('')
        return setSellError('Wallet does not support transaction signing')
      }

      try {
        const tokenMintPk = new PublicKey(mint)

        const pctClamped = Math.max(1, Math.min(100, Math.floor(Number(pct) || 100)))

        const holdingSnap = holdings.find((h) => h.mint === mint) || null
        if (holdingSnap && isTokenRugged(holdingSnap)) {
          setSoldTokens((prev) => [
            {
              mint,
              soldAt: Date.now(),
              pct: 100,
              outcome: 'RUGGED',
              buyMc: holdingSnap.buyMc,
              sellMc: 0,
            },
            ...prev,
          ])
          removeHolding(mint)
          await refreshBalances().catch(() => {})
          await refreshBotWalletBalance().catch(() => {})
          setSellStep('idle')
          setSellMintInFlight('')
          setSellError('Token marked RUGGED — recorded as complete loss')
          return
        }

        // Get token balance to sell 100%
        const tokenBalanceInfo = await getTokenBalanceBaseUnits(connection, traderPk, tokenMintPk)
        if (!tokenBalanceInfo || tokenBalanceInfo.amount <= 0n) {
          throw new Error('No token balance to sell')
        }
        const tokenBalance = tokenBalanceInfo.amount
        const amountIn = (tokenBalance * BigInt(pctClamped)) / 100n
        if (amountIn <= 0n) {
          throw new Error('Sell amount is too small')
        }

        setSellStep('quoting')
        pushDebugEvent({ area: 'trade', level: 'info', message: 'Sell: quoting', detail: mint })
        const runWs = async <T,>(fn: (ws: TradingWs) => Promise<T>): Promise<T> => {
          let ws = await ensureWs()
          try {
            return await fn(ws)
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e || '')
            const retryable = msg === 'WebSocket not connected' || msg === 'WebSocket connection error'
            if (!retryable) throw e
            try {
              wsRef.current?.close()
            } catch {
              // ignore
            }
            wsRef.current = null
            setWsStatus('disconnected')
            ws = await ensureWs()
            return await fn(ws)
          }
        }

        const quote = await runWs((ws) =>
          ws.request<QuoteResult>(
            {
              type: 'quote',
              params: {
                userPubkey: traderPk.toBase58(),
                inputMint: mint,
                outputMint: SOL_MINT,
                amountIn: amountIn.toString(),
                slippageBps: clamp(slippageBps, 0, 50_000),
              },
            },
            (m): m is QuoteResult => m.type === 'quote_result',
          ),
        )

        if (!quote.success || !quote.data?.route) throw new Error('Quote failed')

        const serializedQuote = quote.data.route.serializedQuote
        if (!serializedQuote) {
          throw new Error('Quote missing route.serializedQuote (server must include it for build_swap_tx)')
        }

        setSellStep('building')
        pushDebugEvent({ area: 'trade', level: 'info', message: 'Sell: building tx', detail: mint })
        const built = await runWs((ws) =>
          ws.request<BuildSwapTxResult>(
            {
              type: 'build_swap_tx',
              params: {
                userPubkey: traderPk.toBase58(),
                quote: {
                  provider: 'jupiter',
                  serializedQuote,
                },
              },
            },
            (m): m is BuildSwapTxResult => m.type === 'build_swap_tx_result',
          ),
        )

        if (!built.success || !built.data) throw new Error('Failed to build transaction')
        const txBase64 = built.data.transactionBase64 || built.data.swapTransaction
        if (!txBase64) throw new Error('build_swap_tx_result missing transactionBase64')

        setSellStep('signing')
        pushDebugEvent({ area: 'trade', level: 'info', message: 'Sell: signing', detail: mint })
        const unsignedTx = deserializeTx(txBase64)

        let signedTx
        if (botKp) {
          signedTx = signTxWithKeypair(unsignedTx, botKp)
        } else {
          const signed = await signTransaction!(unsignedTx)
          signedTx = signed
        }

        setSellStep('sending')
        pushDebugEvent({ area: 'trade', level: 'info', message: 'Sell: sending raw tx', detail: mint })
        const sig = await connection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        })
        setSellSig(sig)
        pushDebugEvent({ area: 'trade', level: 'info', message: 'Sell tx sent', detail: sig })

        setSellStep('confirming')
        const status = await confirmSignatureWithFallback(connection, sig, {
          commitment: 'confirmed',
          timeoutMs: 60_000,
          pollIntervalMs: 1000,
        })

        if (status === 'not_found') {
          setSellStep('idle')
          setSellMintInFlight('')
          setSellError('Sell signature not found on chain (dropped?) — try again')
          pushDebugEvent({ area: 'trade', level: 'warn', message: 'Sell not found on chain', detail: sig })
          return
        }

        if (status === 'timeout') {
          setSellStep('idle')
          setSellMintInFlight('')
          setSellError('Sell transaction timed out (check signature in explorer)')
          pushDebugEvent({ area: 'trade', level: 'warn', message: 'Sell timed out', detail: sig })
          return
        }

        pushDebugEvent({ area: 'trade', level: 'info', message: 'Sell confirmed', detail: sig })
        setSoldTokens((prev) => [
          {
            mint,
            soldAt: Date.now(),
            pct: pctClamped,
            outcome: 'SOLD',
            signature: sig,
            buyMc: holdingSnap?.buyMc,
            sellMc: holdingSnap?.currentMc,
          },
          ...prev,
        ])
        if (pctClamped >= 100) {
          removeHolding(mint)
        }
        await refreshBalances()
        await refreshBotWalletBalance()
        setSellStep('idle')
        setSellMintInFlight('')
      } catch (e) {
        if (isUserRateLimitedError(e)) {
          bumpUserRateLimitBackoff()
          setSellStep('idle')
          setSellMintInFlight('')
          setSellError('Rate limited — retrying soon')
          return
        }
        recordTradingApiError(e)
        setSellStep('idle')
        setSellMintInFlight('')
        let msg = e instanceof Error ? e.message : 'Sell failed'
        if (isJupiterNoRouteErrorMessage(msg)) {
          msg = 'Token is RUGGED — no route/liquidity to sell'
        }
        setSellError(msg)
        pushDebugEvent({ area: 'trade', level: 'error', message: 'Sell failed', detail: e instanceof Error ? e.message : String(e) })
      }
    },
    [
      activeLiveKeypair,
      bumpUserRateLimitBackoff,
      connection,
      connected,
      ensureWs,
      gates.allowLiveTrading,
      isUserRateLimitedError,
      holdings,
      publicKey,
      pushDebugEvent,
      recordTradingApiError,
      refreshBalances,
      refreshBotWalletBalance,
      removeHolding,
      setSoldTokens,
      signMessage,
      signTransaction,
      slippageBps,
      tier,
      userRateLimitUntilMs,
    ],
  )

  const canOpenDebug = debugUnlocked

  const solanaRpcEndpoint = useMemo(() => {
    const c = connection as unknown as { rpcEndpoint?: unknown }
    return typeof c.rpcEndpoint === 'string' && c.rpcEndpoint.trim() ? c.rpcEndpoint.trim() : '—'
  }, [connection])

  const solanaWsEndpoint = useMemo(() => {
    const envWs = String(import.meta.env.VITE_SOLANA_WS_URL || '').trim()
    if (envWs) return envWs
    if (solanaRpcEndpoint.includes('/solana-rpc')) return 'wss://api.mainnet-beta.solana.com/'
    if (solanaRpcEndpoint === '—') return '—'
    return solanaRpcEndpoint.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://')
  }, [solanaRpcEndpoint])

  const copyDiagnostics = useCallback(async () => {
    try {
      const sig = sellSig || txSig || bgTx?.sig || ''
      let sigStatus: unknown = null
      if (sig) {
        sigStatus = await connection
          .getSignatureStatuses([sig], { searchTransactionHistory: true })
          .then((r) => r.value?.[0] ?? null)
          .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }))
      }

      const payload = {
        at: new Date().toISOString(),
        wallet: {
          connected,
          publicKey: publicKey?.toBase58() || null,
          hasSignMessage: Boolean(signMessage),
          hasSignTransaction: Boolean(signTransaction),
        },
        mode: { tier, gates },
        sell: {
          mintInFlight: sellMintInFlight || null,
          step: sellStep,
          signature: sellSig || null,
          error: sellError || null,
        },
        solana: { rpcEndpoint: solanaRpcEndpoint, wsEndpoint: solanaWsEndpoint },
        tradingApi: {
          wsUrl,
          wsStatus,
          wsAuthed,
          wsDiag,
          lastWsConnectedAt,
          lastWsErrorAt,
          lastTradingApiErrorAt,
          lastTradingApiErrorCode,
          lastTradingApiErrorMessage,
          tradingApiErrorLog,
        },
        tx: { txSig, bgTx, sigStatus },
        ui: { step, error, snipePrompt },
        timeline: debugTimeline,
      }

      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      pushDebugEvent({ area: 'ui', level: 'info', message: 'Copied diagnostics to clipboard' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to copy diagnostics'
      pushDebugEvent({ area: 'ui', level: 'error', message: 'Copy diagnostics failed', detail: msg })
    }
  }, [
    bgTx,
    connected,
    connection,
    debugTimeline,
    error,
    gates,
    lastTradingApiErrorAt,
    lastTradingApiErrorCode,
    lastTradingApiErrorMessage,
    lastWsConnectedAt,
    lastWsErrorAt,
    publicKey,
    pushDebugEvent,
    sellError,
    sellMintInFlight,
    sellSig,
    sellStep,
    signMessage,
    signTransaction,
    snipePrompt,
    solanaRpcEndpoint,
    solanaWsEndpoint,
    step,
    tier,
    tradingApiErrorLog,
    txSig,
    wsAuthed,
    wsDiag,
    wsStatus,
    wsUrl,
  ])

  const runSolProbe = useCallback(async () => {
    const started = performance.now()
    try {
      const [slot, bh] = await Promise.all([connection.getSlot('processed'), connection.getLatestBlockhash('processed')])
      pushDebugEvent({
        area: 'solana',
        level: 'info',
        message: `RPC probe OK (${Math.max(0, Math.round(performance.now() - started))}ms)`,
        detail: `slot=${slot} blockhash=${bh.blockhash}`,
      })
      setSolProbe({
        at: Date.now(),
        ms: Math.max(0, Math.round(performance.now() - started)),
        slot,
        blockhash: bh.blockhash,
      })
    } catch (e) {
      pushDebugEvent({
        area: 'solana',
        level: 'warn',
        message: `RPC probe failed (${Math.max(0, Math.round(performance.now() - started))}ms)`,
        detail: e instanceof Error ? e.message : String(e || 'RPC probe failed'),
      })
      setSolProbe({
        at: Date.now(),
        ms: Math.max(0, Math.round(performance.now() - started)),
        error: e instanceof Error ? e.message : String(e || 'RPC probe failed'),
      })
    }
  }, [connection])

  useEffect(() => {
    if (!debugOpen || !canOpenDebug) return
    const id = window.setInterval(() => {
      const stats = wsRef.current?.getStats?.()
      if (stats) setWsDiag(stats)
    }, 600)
    return () => window.clearInterval(id)
  }, [canOpenDebug, debugOpen])

  useEffect(() => {
    if (!debugOpen || !canOpenDebug) return
    if (!solAutoProbe) return
    void runSolProbe()
    const id = window.setInterval(() => void runSolProbe(), 30_000)
    return () => window.clearInterval(id)
  }, [canOpenDebug, debugOpen, runSolProbe, solAutoProbe])

  const openDebug = () => setDebugOpen(true)
  const closeDebug = () => {
    setDebugOpen(false)
    setDebugPasscode('')
  }

  const debugEasterEggRef = useRef<{ n: number; last: number }>({ n: 0, last: 0 })
  const onBrandEasterEggClick = () => {
    const now = Date.now()
    const windowMs = 1400
    const requiredClicks = 7

    const prev = debugEasterEggRef.current
    const within = now - prev.last <= windowMs
    const n = within ? prev.n + 1 : 1
    debugEasterEggRef.current = { n, last: now }

    if (n >= requiredClicks) {
      debugEasterEggRef.current = { n: 0, last: 0 }
      openDebug()
    }
  }

  const submitDebugPasscode = () => {
    const code = debugPasscode.trim()
    if (code !== DEBUG_PORTAL_PASSCODE) return
    setDebugUnlocked(true)
    try {
      sessionStorage.setItem('dequanswap.debugUnlocked', JSON.stringify({ t: Date.now() }))
    } catch {
      // ignore
    }
  }

  const formatTs = (t: number) => {
    if (!t) return '—'
    const d = new Date(t)
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
  }

  const handleSelectTier = useCallback((nextTier: ProductTier) => {
    setTier(nextTier)
    saveTier(nextTier)
    saveSetting('dequanswap.tierChosen', '1')
    setTierSelectionOpen(false)
  }, [])

  const openTierSelection = useCallback(() => {
    setTierSelectionOpen(true)
  }, [])

  const refreshSubscriptionStatus = useCallback(async () => {
    try {
      const ws = await ensureWs()
      const res = await ws.request<GetSubscriptionStatusResult>(
        { type: 'get_subscription_status' },
        (m): m is GetSubscriptionStatusResult => m.type === 'get_subscription_status_result',
        15_000,
      )
      if (res.success) {
        setSubscriptionStatus(res.data || null)
        // If server indicates an active paid plan, keep the client plan aligned.
        const activeTier = res.data?.active ? res.data?.subscription?.tier : undefined
        if (activeTier === 'pro' || activeTier === 'elite') {
          setTier(activeTier)
          saveTier(activeTier)
          saveSetting('dequanswap.tierChosen', '1')
        }
      }
    } catch {
      // ignore (UI will still function; subscription UI just won't show status)
    }
  }, [ensureWs])

  useEffect(() => {
    if (wsStatus !== 'connected') return
    void refreshSubscriptionStatus()
  }, [refreshSubscriptionStatus, wsStatus])

  useEffect(() => {
    if (wsStatus !== 'connected') return
    const id = window.setInterval(() => {
      void refreshSubscriptionStatus()
    }, 60_000)
    return () => window.clearInterval(id)
  }, [refreshSubscriptionStatus, wsStatus])

  const subscribeToTier = useCallback(
    async (target: 'pro' | 'elite') => {
      if (!connected || !publicKey) throw new Error('Connect your wallet to subscribe')
      if (!signTransaction) throw new Error('Wallet does not support transaction signing')

      // Paid tiers require an email account (for renewal reminders).
      // This is wallet-first: we only prompt during upgrade.
      if (!signMessage) throw new Error('Wallet does not support message signing')

      setSubscriptionBusy(true)
      try {
        const wallet = publicKey.toBase58()

        const ensureControlPlaneWalletSession = async () => {
          const ch = await requestWalletChallenge(controlPlaneBaseUrl, wallet)
          setWalletActionHint('signature')
          const sigBytes = await signMessage(new TextEncoder().encode(ch.message))
          const signature = bs58.encode(sigBytes)
          await verifyWalletChallenge(controlPlaneBaseUrl, { challengeId: ch.challengeId, wallet, signature })
          setWalletActionHint('')
        }

        const ensureAccountJwt = async (): Promise<string | null> => {
          // Reuse cached token if still valid-ish.
          const cached = accountJwtRef.current
          if (cached && cached.token && cached.expiresAt) {
            const exp = Date.parse(cached.expiresAt)
            if (Number.isFinite(exp) && exp - Date.now() > 30_000) return cached.token
          }

          await ensureControlPlaneWalletSession()

          let me
          try {
            me = await getAccountMe(controlPlaneBaseUrl)
          } catch (e) {
            // If Control Plane is unreachable/misconfigured, surface the error.
            throw e
          }

          if (!me.account) {
            setPendingSubscribeTier(target)
            setAccountModalOpen(true)
            return null
          }

          // Ensure the wallet<->email mapping exists for reminder delivery.
          await linkWalletToEmail(controlPlaneBaseUrl)
          const tok = await mintAccountToken(controlPlaneBaseUrl, { wallet })
          accountJwtRef.current = { token: tok.token, expiresAt: tok.expiresAt, email: tok.email }
          return tok.token
        }

        const accountJwt = await ensureAccountJwt()
        if (!accountJwt) return

        const ws = await ensureWs()

        const built = await ws.request<BuildSubscriptionTxResult>(
          { type: 'build_subscription_tx', params: { tier: target, accountJwt } },
          (m): m is BuildSubscriptionTxResult => m.type === 'build_subscription_tx_result',
          20_000,
        )
        if (!built.success || !built.data?.transactionBase64) throw new Error('Failed to build subscription transaction')

        const unsignedTx = deserializeTx(built.data.transactionBase64)
        const signed = await signTransaction(unsignedTx)
        const signedTxBase64 = signed.serialize().toString('base64')

        const submitted = await ws.request<SubmitSubscriptionPaymentResult>(
          {
            type: 'submit_subscription_payment',
            params: { attemptId: built.data.attemptId, tier: target, signedTxBase64, accountJwt },
          },
          (m): m is SubmitSubscriptionPaymentResult => m.type === 'submit_subscription_payment_result',
          20_000,
        )
        if (!submitted.success || !submitted.data?.signature) throw new Error('Subscription payment submit failed')

        // Optimistic: switch UI tier immediately. Server will enforce real gates.
        setTier(target)
        saveTier(target)
        saveSetting('dequanswap.tierChosen', '1')
        setTierSelectionOpen(false)

        // Refresh status shortly after (server confirms in background).
        window.setTimeout(() => {
          void refreshSubscriptionStatus()
        }, 2500)
      } finally {
        setSubscriptionBusy(false)
      }
    },
    [connected, controlPlaneBaseUrl, ensureWs, publicKey, refreshSubscriptionStatus, signMessage, signTransaction],
  )

  const closeAccountModal = useCallback(() => {
    setAccountModalOpen(false)
    setAccountBusy(false)
    setAccountError('')
    setAccountEmail('')
    setAccountCode('')
    setAccountChallengeId('')
    setAccountDebugCode('')
    setPendingSubscribeTier(null)
  }, [])

  const beginAccountEmail = useCallback(async () => {
    setAccountError('')
    setAccountBusy(true)
    try {
      const resp = await startEmailLogin(controlPlaneBaseUrl, accountEmail)
      setAccountChallengeId(resp.challengeId)
      setAccountDebugCode(resp.debugCode || '')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Email start failed'
      setAccountError(msg)
    } finally {
      setAccountBusy(false)
    }
  }, [accountEmail, controlPlaneBaseUrl])

  const verifyAccountEmailCode = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setAccountError('Connect a wallet that supports message signing')
      return
    }
    const wallet = publicKey.toBase58()

    setAccountError('')
    setAccountBusy(true)
    try {
      // Ensure wallet session cookie exists.
      const ch = await requestWalletChallenge(controlPlaneBaseUrl, wallet)
      const sigBytes = await signMessage(new TextEncoder().encode(ch.message))
      const signature = bs58.encode(sigBytes)
      await verifyWalletChallenge(controlPlaneBaseUrl, { challengeId: ch.challengeId, wallet, signature })

      await verifyEmailLogin(controlPlaneBaseUrl, { challengeId: accountChallengeId, code: accountCode })

      await linkWalletToEmail(controlPlaneBaseUrl)
      const tok = await mintAccountToken(controlPlaneBaseUrl, { wallet })
      accountJwtRef.current = { token: tok.token, expiresAt: tok.expiresAt, email: tok.email }

      const pending = pendingSubscribeTier
      closeAccountModal()
      if (pending) {
        // Continue upgrade after account verification.
        void subscribeToTier(pending)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Email verify failed'
      setAccountError(msg)
    } finally {
      setAccountBusy(false)
    }
  }, [accountChallengeId, accountCode, closeAccountModal, controlPlaneBaseUrl, pendingSubscribeTier, publicKey, signMessage, subscribeToTier])

  return (
    <div className="app">
      {splashOpen ? (
        <div
          className={splashLeaving ? 'splashOverlay splashOverlayLeaving' : 'splashOverlay'}
          role="dialog"
          aria-modal="true"
          aria-label="Loading"
          onClick={() => requestCloseSplash()}
        >
          <div className="splashCard" onClick={(e) => e.stopPropagation()}>
            <div className="splashTaglineTop">FIRST IN</div>
            {!splashVideoFailed ? (
              <video
                className="splashMedia"
                autoPlay
                muted
                playsInline
                loop={false}
                preload="auto"
                onError={() => setSplashVideoFailed(true)}
                onEnded={() => requestCloseSplash()}
              >
                <source src={splashVideoUrl} type="video/mp4" />
              </video>
            ) : (
              <div className="splashMedia splashMediaFallback">Initializing…</div>
            )}
            <div className="splashTaglineBottom">FAST OUT</div>
          </div>
        </div>
      ) : null}

      {!splashOpen && accountModalOpen ? (
        <div className="accountOverlay" role="dialog" aria-modal="true" aria-label="Account required" onClick={closeAccountModal}>
          <div className="accountCard" onClick={(e) => e.stopPropagation()}>
            <div className="accountTitle">Account required for paid plan</div>
            <div className="accountNote">
              Scout is wallet-only. To subscribe to Sniper/Apex we need an email so we can send renewal reminders.
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <label>Email</label>
              <input
                value={accountEmail}
                onChange={(e) => setAccountEmail(e.target.value)}
                placeholder="you@domain.com"
                autoComplete="email"
                spellCheck={false}
              />
            </div>

            <div className="ctaRow">
              <button type="button" className="secondary" onClick={closeAccountModal} disabled={accountBusy}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={beginAccountEmail} disabled={accountBusy || !accountEmail.trim()}>
                Send code
              </button>
            </div>

            {accountChallengeId ? (
              <>
                <div className="row" style={{ marginTop: 12 }}>
                  <label>Verification code</label>
                  <input
                    value={accountCode}
                    onChange={(e) => setAccountCode(e.target.value)}
                    placeholder="6-digit code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    spellCheck={false}
                  />
                  {accountDebugCode ? (
                    <div className="note">Dev code: <span className="mono">{accountDebugCode}</span></div>
                  ) : null}
                </div>

                <div className="ctaRow">
                  <button
                    type="button"
                    className="primary"
                    onClick={verifyAccountEmailCode}
                    disabled={accountBusy || !accountCode.trim()}
                  >
                    Verify & continue
                  </button>
                </div>
              </>
            ) : null}

            {accountError ? <div className="note" style={{ color: 'rgba(248,81,73,0.95)' }}>{accountError}</div> : null}
          </div>
        </div>
      ) : null}

      {!splashOpen && tierSelectionOpen ? (
        <TierSelectionScreen onSelectTier={handleSelectTier} onSubscribeTier={subscribeToTier} busy={subscriptionBusy} />
      ) : null}

      {!splashOpen && !tierSelectionOpen ? (
        <>
          {holdingDrawerMint ? (
            <div
              className="holdingDrawerOverlay"
              role="dialog"
              aria-modal="true"
              aria-label="Holding details"
              onClick={closeHoldingDrawer}
            >
              <div className="holdingDrawer" onClick={(e) => e.stopPropagation()}>
                {(() => {
                  const h = holdings.find((x) => x.mint === holdingDrawerMint)
                  const series = holdingsMcHistoryRef.current[holdingDrawerMint] ?? []
                  const points = renderSparkline(series, 560, 160)
                  const pnl = h ? computeGrowthPct(h.buyMc, h.currentMc) : undefined
                  const tokenLabel = h ? ((h.symbol || h.name || '').trim() || shortPk(h.mint)) : shortPk(holdingDrawerMint)

                  return (
                    <>
                      <div className="holdingDrawerHead">
                        <div className="holdingDrawerTitle">
                          {tokenLabel}
                          <span className="holdingDrawerMint mono" title={holdingDrawerMint}>
                            {shortPk(holdingDrawerMint)}
                          </span>
                        </div>
                        <div className="holdingDrawerActions">
                          <button
                            type="button"
                            className="secondary"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(holdingDrawerMint)
                                setCopiedMint(holdingDrawerMint)
                                setTimeout(() => setCopiedMint(''), 2000)
                              } catch {
                                // ignore
                              }
                            }}
                          >
                            {copiedMint === holdingDrawerMint ? 'Copied' : 'Copy mint'}
                          </button>
                          <button type="button" className="secondary" onClick={closeHoldingDrawer}>
                            Close
                          </button>
                        </div>
                      </div>

                      <div className="holdingDrawerChart">
                        {points ? (
                          <svg width="100%" height="160" viewBox="0 0 560 160" preserveAspectRatio="none">
                            <polyline
                              points={points}
                              fill="none"
                              stroke="rgba(45,226,230,0.9)"
                              strokeWidth="2"
                              strokeLinejoin="round"
                              strokeLinecap="round"
                            />
                          </svg>
                        ) : (
                          <div className="holdingDrawerEmpty">No chart data yet.</div>
                        )}
                      </div>

                      {h ? (
                        <div className="holdingDrawerGrid">
                          <div className="holdingDrawerStat">
                            <div className="k">Buy time</div>
                            <div className="v mono">{formatTs(h.boughtAt)}</div>
                          </div>
                          <div className="holdingDrawerStat">
                            <div className="k">Buy MC</div>
                            <div className="v mono">{formatUsd0(h.buyMc)}</div>
                          </div>
                          <div className="holdingDrawerStat">
                            <div className="k">Current MC</div>
                            <div className="v mono">{formatUsd0(h.currentMc)}</div>
                          </div>
                          <div className="holdingDrawerStat">
                            <div className="k">PnL</div>
                            <div
                              className={
                                typeof pnl === 'number' && pnl > 0
                                  ? 'v mono pos'
                                  : typeof pnl === 'number' && pnl < 0
                                    ? 'v mono neg'
                                    : 'v mono'
                              }
                            >
                              {typeof pnl === 'number' && Number.isFinite(pnl) ? `${pnl.toFixed(2)}%` : '—'}
                            </div>
                          </div>
                          <div className="holdingDrawerStat">
                            <div className="k">Quote proxy</div>
                            <div className="v mono">
                              {typeof h.proxyGrowthPct === 'number' && Number.isFinite(h.proxyGrowthPct)
                                ? `${h.proxyGrowthPct.toFixed(2)}%`
                                : '—'}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </>
                  )
                })()}
              </div>
            </div>
          ) : null}

          {watchDrawerMint ? (
            <div
              className="holdingDrawerOverlay"
              role="dialog"
              aria-modal="true"
              aria-label="Watched token details"
              onClick={closeWatchDrawer}
            >
              <div className="holdingDrawer" onClick={(e) => e.stopPropagation()}>
                {(() => {
                  const t = watched.find((x) => x.mint === watchDrawerMint)
                  const series = watchingMcHistoryRef.current[watchDrawerMint] ?? []
                  const points = renderSparkline(series, 560, 160)
                  const mcGrowth = t ? computeGrowthPct(t.entryMc, t.currentMc) : undefined
                  const quoteGrowth = t && typeof t.growthPct === 'number' ? t.growthPct : undefined
                  const tokenLabel = t ? ((t.symbol || t.name || '').trim() || shortPk(t.mint)) : shortPk(watchDrawerMint)
                  const addedAt = typeof t?.addedAt === 'number' ? t.addedAt : null
                  const mcAgeMs = typeof t?.mcUpdatedAt === 'number' ? Date.now() - t!.mcUpdatedAt! : null
                  const quoteMcProxy = t ? computeQuoteMcProxy(t) : undefined

                  return (
                    <>
                      <div className="holdingDrawerHead">
                        <div className="holdingDrawerTitle">
                          {tokenLabel}
                          <span className="holdingDrawerMint mono" title={watchDrawerMint}>
                            {shortPk(watchDrawerMint)}
                          </span>
                        </div>
                        <div className="holdingDrawerActions">
                          <button
                            type="button"
                            className="secondary"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(watchDrawerMint)
                                setCopiedMint(watchDrawerMint)
                                setTimeout(() => setCopiedMint(''), 2000)
                              } catch {
                                // ignore
                              }
                            }}
                          >
                            {copiedMint === watchDrawerMint ? 'Copied' : 'Copy mint'}
                          </button>
                          <button type="button" className="secondary" onClick={closeWatchDrawer}>
                            Close
                          </button>
                        </div>
                      </div>

                      <div className="holdingDrawerChart">
                        {points ? (
                          <svg width="100%" height="160" viewBox="0 0 560 160" preserveAspectRatio="none">
                            <polyline
                              points={points}
                              fill="none"
                              stroke="rgba(45,226,230,0.9)"
                              strokeWidth="2"
                              strokeLinejoin="round"
                              strokeLinecap="round"
                            />
                          </svg>
                        ) : (
                          <div className="holdingDrawerEmpty">No chart data yet.</div>
                        )}
                      </div>

                      <div className="holdingDrawerGrid">
                        <div className="holdingDrawerStat">
                          <div className="k">Watch age</div>
                          <div className="v mono">{addedAt ? formatAgeShort(Date.now() - addedAt) : '—'}</div>
                        </div>
                        <div className="holdingDrawerStat">
                          <div className="k">MC updated</div>
                          <div className="v mono" title="Market cap updates only when dequanW provides an MC snapshot for this mint">
                            {typeof mcAgeMs === 'number' ? `${formatAgeShort(mcAgeMs)} ago` : '—'}
                          </div>
                        </div>
                        <div className="holdingDrawerStat">
                          <div className="k">Entry MC</div>
                          <div className="v mono">{formatUsd0(t?.entryMc)}</div>
                        </div>
                        <div className="holdingDrawerStat">
                          <div className="k">Current MC (feed)</div>
                          <div className="v mono">{formatUsd0(t?.currentMc)}</div>
                        </div>
                        <div className="holdingDrawerStat">
                          <div className="k">MC proxy (quote)</div>
                          <div
                            className="v mono"
                            title="Approx MC computed from quote proxy ratio (not from dequanW / DEXTools). Use as a direction signal only."
                          >
                            {typeof quoteMcProxy === 'number' && Number.isFinite(quoteMcProxy) ? `≈${formatUsd0(quoteMcProxy)}` : '—'}
                          </div>
                        </div>
                        <div className="holdingDrawerStat">
                          <div className="k">MC growth</div>
                          <div className={typeof mcGrowth === 'number' && mcGrowth > 0 ? 'v mono pos' : typeof mcGrowth === 'number' && mcGrowth < 0 ? 'v mono neg' : 'v mono'}>
                            {typeof mcGrowth === 'number' && Number.isFinite(mcGrowth) ? `${mcGrowth.toFixed(2)}%` : '—'}
                          </div>
                        </div>
                        <div className="holdingDrawerStat">
                          <div className="k">Quote growth</div>
                          <div className={typeof quoteGrowth === 'number' && quoteGrowth > 0 ? 'v mono pos' : typeof quoteGrowth === 'number' && quoteGrowth < 0 ? 'v mono neg' : 'v mono'}>
                            {typeof quoteGrowth === 'number' && Number.isFinite(quoteGrowth) ? `${quoteGrowth.toFixed(2)}%` : '—'}
                          </div>
                        </div>
                      </div>
                    </>
                  )
                })()}
              </div>
            </div>
          ) : null}

          {walletActionHint ? (
        <div className="toast toastWarn" role="status" aria-live="polite">
          <div className="toastTitle">
            {walletActionHint === 'connect' ? 'Wallet still connecting…' : 'Waiting for wallet approval…'}
          </div>
          <div className="toastBody">
            {walletActionHint === 'connect'
              ? 'Your wallet might be open in another tab or window (e.g. Phantom side panel). Look for a pending connection request and approve it.'
              : 'Your wallet might be waiting for a signature/approval in another tab or window (e.g. Phantom side panel). Look for a pending prompt and approve it.'}
          </div>
          <div className="toastActions">
            <button className="toastBtn" type="button" onClick={() => setWalletActionHint('')}
              >Dismiss</button>
          </div>
        </div>
      ) : null}

      <header className="topbar">
        <div className="brandBlock" onClick={onBrandEasterEggClick}>
          <div className="brand">dequanSnipe</div>
          <div className="brandSub">{dashboardSubtitle}</div>
        </div>
        <div className="actions">
          <div className="walletBlock">
            <div className={connected ? 'walletGlow walletGlowOk' : 'walletGlow walletGlowBad'}>
              <BaseWalletMultiButton
                className="walletBtn"
                labels={{
                  'change-wallet': 'Change wallet',
                  connecting: 'Connecting ...',
                  'copy-address': 'Copy address',
                  copied: 'Copied',
                  disconnect: 'Disconnect',
                  'has-wallet': 'Connect Wallet',
                  'no-wallet': 'Connect Wallet',
                }}
              />
            </div>
          </div>
        </div>
      </header>

      <div className="tabs">
        <div className="tabsLeft">
          <div className="engineBlock">
            <RadarPulse isNewTokenFound={isNewTokenFound} isCriticalSignal={hasCriticalSignal} />
            <div className="engineStatus">
              <span className={dequanwServerOk ? 'dot dotOk' : 'dot dotBad'} />
              <div className="enginePowered">powered by dequan</div>
            </div>
          </div>
          <div className="tierControls">
            <select
              className="select"
              value={tier}
              onChange={(e) => {
                const nextTier = e.target.value as ProductTier
                // Only allow selecting paid tiers if subscription is active.
                const activePaidTier = subscriptionStatus?.active ? subscriptionStatus?.subscription?.tier : undefined
                const canUsePaid = nextTier === 'free' || activePaidTier === nextTier || activePaidTier === 'elite'
                if (!canUsePaid) {
                  openTierSelection()
                  return
                }
                setTier(nextTier)
                saveTier(nextTier)
                saveSetting('dequanswap.tierChosen', '1')
              }}
              aria-label="Plan"
            >
              {(['free', 'pro', 'elite'] as const).map((t) => (
                <option key={t} value={t}>
                  {tierDisplayName(t)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="tabsRight">
          <div
            className="walletAuthPills"
            title={apiKey.trim() || authToken.trim() ? 'Legacy auth' : connected && publicKey ? 'Wallet auth' : 'No auth'}
          >
            <span
              className={`healthPill ${(connected && publicKey) || apiKey.trim() || authToken.trim() ? 'ok' : 'warn'}`}
            >
              {authLabel}
            </span>
            {connected && publicKey && signMessage && !wsAuthed ? (
              <button
                type="button"
                className="healthPill warn"
                onClick={retryWalletAuth}
                disabled={walletActionHint === 'signature'}
                title="If you dismissed Phantom's signature prompt, click to try again"
              >
                Retry wallet auth
              </button>
            ) : null}
            {Date.now() < userRateLimitUntilMs ? <span className="healthPill warn">Backoff</span> : null}
            {subscriptionStatus?.active && subscriptionStatus?.overdue ? (
              <span className="healthPill warn" title="Subscription payment is overdue">
                Renew overdue
              </span>
            ) : null}
            {subscriptionStatus?.active && !subscriptionStatus?.overdue && subscriptionStatus?.needsRenewalSoon ? (
              <span className="healthPill warn" title="Subscription renewal coming up soon">
                Renew soon
              </span>
            ) : null}
          </div>
        </div>
      </div>

        <main id="minimalist-view" className="minimalistView">
          {/* LEFT 65%: WATCHING (TOP) + LIVE FEED (BOTTOM) */}
          <div className="leftRail">
            <section className="panel" style={{ flex: '0 0 auto', overflow: 'visible' }}>
              <div
                className="panelHead panelHeadClickable"
                role="button"
                tabIndex={0}
                aria-expanded={holdingsOpen}
                onClick={() => setHoldingsOpen((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setHoldingsOpen((v) => !v)
                  }
                }}
              >
                <div className="panelHeadTop">
                  <div className="panelTitle">
                    Holdings
                    <HelpDot href={helpUrl('holdings-realtime-chart')} title="Holdings real-time chart" />
                    <HelpDot href={helpUrl('holdings-buy-mc-time')} title="Holdings buy MC + buy time" />
                  </div>
                  <div className="panelChevron">{holdingsOpen ? '▾' : '▸'}</div>
                </div>
                <div className="panelHint">Tracked buys + PnL%</div>
              </div>

              {holdingsOpen ? (
                <>
                  <div style={{ paddingRight: '4px' }}>
                    {sellError ? (
                      <div className="error" style={{ marginBottom: '10px' }}>
                        Sell: {sellError}
                      </div>
                    ) : null}
                    {sellSig ? (
                      <div className="note" style={{ marginBottom: '10px' }}>
                        <a
                          href={`https://solscan.io/tx/${sellSig}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--accent)', textDecoration: 'underline' }}
                        >
                          View sell on Solscan
                        </a>
                      </div>
                    ) : null}

                    <div className="watchHeaderRow watchHeaderRowHoldings">
                      <div className="watchHeaderCell watchHeaderCellLeft">Token</div>
                      <div className="watchHeaderCell watchHeaderCellCenter">Buy Age</div>
                      <div className="watchHeaderCell watchHeaderCellCenter">Buy MC</div>
                      <div className="watchHeaderCell watchHeaderCellCenter">Current MC</div>
                      <div className="watchHeaderCell watchHeaderCellCenter">Chart</div>
                      <div className="watchHeaderCell watchHeaderCellCenter">PnL%</div>
                      <div className="watchHeaderCell watchHeaderCellRight">Actions</div>
                    </div>

                    {holdings.length ? (
                      holdings.map((h) => {
                        const pnl = computeGrowthPct(h.buyMc, h.currentMc)
                        const isHot = typeof pnl === 'number' && Number.isFinite(pnl) && pnl >= growthTriggerPct
                        const buyAgeMs = Date.now() - (typeof h.boughtAt === 'number' ? h.boughtAt : Date.now())
                        const sellingThis = sellMintInFlight === h.mint && sellStep !== 'idle'
                        const tokenLabel = (h.symbol || h.name || '').trim() || shortPk(h.mint)
                        const rugged = isTokenRugged(h)
                        const series = holdingsMcHistoryRef.current[h.mint] ?? []
                        const points = renderSparkline(series, 92, 26)
                        const trend = seriesTrend(series)
                        return (
                          <div key={h.mint} className={isHot ? 'watchRow watchRowHoldings watchRowHot' : 'watchRow watchRowHoldings'}>
                            <div className="watchRowHeat" />
                            <div className="watchCell watchCellLeft" style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                              <span
                                className="watchTokenFlip"
                                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, cursor: 'pointer' }}
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(h.mint)
                                    setCopiedMint(h.mint)
                                    setTimeout(() => setCopiedMint(''), 2000)
                                  } catch {
                                    // ignore
                                  }
                                }}
                                title={`${h.mint} (click to copy)`}
                              >
                                <span className="watchTokenSymbol">{tokenLabel}</span>
                                <span className="watchTokenAddr mono">{shortPk(h.mint)}</span>
                              </span>
                              {copiedMint === h.mint ? (
                                <span
                                  className="tokenRowBadge"
                                  style={{
                                    background: 'rgba(0, 255, 163, 0.15)',
                                    borderColor: 'rgba(0, 255, 163, 0.35)',
                                    color: 'var(--neon-green)',
                                    fontSize: '10px',
                                    padding: '2px 6px',
                                  }}
                                >
                                  Copied
                                </span>
                              ) : null}
                              <span
                                className={
                                  rugged
                                    ? 'tokenRowBadge tokenRowBadgeRugged'
                                    : isHot
                                      ? 'tokenRowBadge tokenRowBadgeHot'
                                      : 'tokenRowBadge tokenRowBadgeTrack'
                                }
                              >
                                {rugged ? 'RUGGED' : isHot ? 'HOT' : 'HOLD'}
                              </span>
                            </div>
                            <div className="watchCell watchCellCenter mono" data-label="Buy Age" title={formatTs(h.boughtAt)}>
                              {formatAgeShort(buyAgeMs)}
                            </div>
                            <div className="watchCell watchCellCenter mono" data-label="Buy MC">{formatUsd0(h.buyMc)}</div>
                            <div className="watchCell watchCellCenter mono" data-label="Current MC">{formatUsd0(h.currentMc)}</div>
                            <div className="watchCell watchCellCenter" data-label="Chart">
                              <button
                                type="button"
                                className="sparklineBtn"
                                onClick={() => {
                                  setWatchDrawerMint('')
                                  setHoldingDrawerMint(h.mint)
                                }}
                                title="Open chart"
                              >
                                {points ? (
                                  <svg width="92" height="26" viewBox="0 0 92 26" preserveAspectRatio="none">
                                    <polyline
                                      points={points}
                                      fill="none"
                                      stroke={
                                        trend === 'up'
                                          ? 'rgba(0,255,163,0.9)'
                                          : trend === 'down'
                                            ? 'rgba(248,81,73,0.9)'
                                            : 'rgba(234,242,255,0.6)'
                                      }
                                      strokeWidth="2"
                                      strokeLinejoin="round"
                                      strokeLinecap="round"
                                    />
                                  </svg>
                                ) : (
                                  <span className="sparklineEmpty">—</span>
                                )}
                              </button>
                            </div>
                            <div
                              className={
                                typeof pnl === 'number' && pnl > 0
                                  ? 'watchCell watchCellCenter mono pos'
                                  : typeof pnl === 'number' && pnl < 0
                                    ? 'watchCell watchCellCenter mono neg'
                                    : 'watchCell watchCellCenter mono'
                              }
                              data-label="PnL%"
                            >
                              {typeof pnl === 'number' && Number.isFinite(pnl) ? `${pnl.toFixed(2)}%` : '—'}
                            </div>
                            <div className="watchActions">
                              <button
                                className="ghost"
                                onClick={async () => {
                                  if (rugged) {
                                    setSoldTokens((prev) => [
                                      {
                                        mint: h.mint,
                                        soldAt: Date.now(),
                                        pct: 100,
                                        outcome: 'RUGGED',
                                        buyMc: h.buyMc,
                                        sellMc: 0,
                                      },
                                      ...prev,
                                    ])
                                    removeHolding(h.mint)
                                    await refreshBalances().catch(() => {})
                                    await refreshBotWalletBalance().catch(() => {})
                                    setSellError('Token marked RUGGED — recorded as complete loss')
                                    setSnipeCardSide('sell')
                                    return
                                  }

                                  setSnipeCardSide('sell')
                                  setSellMintInput(h.mint)
                                  setSellPct(100)
                                  const panel = document.getElementById('snipe-panel')
                                  panel?.classList.add('animate-glitch-pulse')
                                  setTimeout(() => panel?.classList.remove('animate-glitch-pulse'), 500)
                                }}
                                disabled={step !== 'idle' || sellStep !== 'idle'}
                              >
                                {sellingThis ? `${sellStep}…` : 'Sell'}
                              </button>
                              <button className="ghost" onClick={() => removeHolding(h.mint)}>
                                Remove
                              </button>
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <div style={{ padding: '10px 4px', color: 'var(--muted)', fontSize: '12px' }}>No holdings yet.</div>
                    )}
                  </div>
                </>
              ) : null}
            </section>

            <section className="panel" style={{ flex: '0 0 auto', overflow: 'visible' }}>
              <div
                className="panelHead panelHeadClickable"
                role="button"
                tabIndex={0}
                aria-expanded={watchingOpen}
                onClick={() => setWatchingOpen((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setWatchingOpen((v) => !v)
                  }
                }}
              >
                <div className="panelHeadTop">
                  <div className="panelTitle">
                    Watching
                    <HelpDot href={helpUrl('watchlist-growth-proxy')} title="Growth% from quote proxy" />
                  </div>
                  <div className="panelChevron">{watchingOpen ? '▾' : '▸'}</div>
                </div>
                <div className="panelHint">Track tokens from Live Feed or add your own</div>
              </div>

              {watchingOpen ? (
                <>
                  <div
                    className="subPanelHead"
                    role="button"
                    tabIndex={0}
                    aria-expanded={watchingAddOpen}
                    onClick={() => setWatchingAddOpen((v) => !v)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setWatchingAddOpen((v) => !v)
                      }
                    }}
                  >
                    <div className="subPanelTitle">ADD TOKEN BY ADDRESS</div>
                    <div className="panelChevron">{watchingAddOpen ? '▾' : '▸'}</div>
                  </div>

                  {watchingAddOpen ? (
                    <div className="row" style={{ marginTop: '10px' }}>
                      <label>Token mint</label>
                      <div className="inline">
                        <input
                          value={watchMintInput}
                          onChange={(e) => setWatchMintInput(e.target.value)}
                          placeholder="Paste token mint…"
                          spellCheck={false}
                          autoCapitalize="none"
                          autoCorrect="off"
                        />
                        <button className="primary" onClick={addWatchedToken} disabled={step !== 'idle'}>
                          Watch
                        </button>
                      </div>
                      <div className="note">
                        Tier limit: {watched.length}/{gates.maxWatchedTokens}
                      </div>
                    </div>
                  ) : null}

                  <div
                    className="note"
                    style={{
                      marginTop: '8px',
                      marginBottom: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      userSelect: 'none',
                    }}
                    title="Uses the quote proxy ratio to approximate market cap when the feed stops emitting MC for a mint"
                  >
                    <input
                      type="checkbox"
                      checked={useQuoteMcProxyWhenStale}
                      onChange={(e) => setUseQuoteMcProxyWhenStale(e.target.checked)}
                      aria-label="Show quote-based MC proxy when feed MC is stale"
                    />
                    <span>Show quote-based MC proxy when feed MC is stale</span>
                  </div>

                  <div style={{ paddingRight: '4px' }}>
                    <div className="watchHeaderRow watchHeaderRowWatching">
                      <div className="watchHeaderCell watchHeaderCellLeft">Token</div>
                      <div className="watchHeaderCell watchHeaderCellCenter">Age</div>
                      <div className="watchHeaderCell watchHeaderCellCenter">Entry MC</div>
                      <div
                        className="watchHeaderCell watchHeaderCellCenter"
                        title="Market cap updates only when dequanW provides an MC snapshot for this mint"
                      >
                        Current MC (feed)
                      </div>
                      <div className="watchHeaderCell watchHeaderCellCenter">Chart</div>
                      <div className="watchHeaderCell watchHeaderCellCenter">Growth</div>
                      <div className="watchHeaderCell watchHeaderCellRight">Actions</div>
                    </div>

                    {watched.length ? (
                      watched.map((t) => {
                        const mcGrowth = computeGrowthPct(t.entryMc, t.currentMc)
                        const growth = typeof mcGrowth === 'number' ? mcGrowth : typeof t.growthPct === 'number' ? t.growthPct : 0
                        const isHot = Number.isFinite(growth) && growth >= growthTriggerPct
                        const ruggedLabel = isTokenRugged({ error: t.error ?? null, isRugged: (t as any).isRugged ?? null, liquidityStatus: (t as any).liquidityStatus ?? null }) ? 'RUGGED' : ''
                        const ageMs = Date.now() - (typeof t.addedAt === 'number' ? t.addedAt : Date.now())
                        const tokenLabel = (t.symbol || t.name || '').trim() || shortPk(t.mint)
                        const mcAgeMs = typeof t.mcUpdatedAt === 'number' ? Date.now() - t.mcUpdatedAt : null
                        const mcIsStale = typeof mcAgeMs === 'number' && mcAgeMs > 60_000
                        const quoteMcProxy = mcIsStale && useQuoteMcProxyWhenStale ? computeQuoteMcProxy(t) : undefined
                        const showQuoteProxy = typeof quoteMcProxy === 'number' && Number.isFinite(quoteMcProxy) && quoteMcProxy > 0
                        const series = watchingMcHistoryRef.current[t.mint] ?? []
                        const points = renderSparkline(series, 92, 26)
                        const trend = seriesTrend(series)
                        return (
                          <div key={t.mint} className={isHot ? 'watchRow watchRowWatching watchRowHot' : 'watchRow watchRowWatching'}>
                            <div className="watchRowHeat" />
                            <div className="watchCell watchCellLeft" style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                              <span
                                className="watchTokenFlip"
                                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, cursor: 'pointer' }}
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(t.mint)
                                    setCopiedMint(t.mint)
                                    setTimeout(() => setCopiedMint(''), 2000)
                                  } catch {
                                    // Fallback: ignore if clipboard API fails
                                  }
                                }}
                                title={`${t.mint} (click to copy)`}
                              >
                                <span className="watchTokenSymbol">
                                  {tokenLabel}
                                </span>
                                <span className="watchTokenAddr mono">{shortPk(t.mint)}</span>
                              </span>
                              {copiedMint === t.mint ? (
                                <span
                                  className="tokenRowBadge"
                                  style={{
                                    background: 'rgba(0, 255, 163, 0.15)',
                                    borderColor: 'rgba(0, 255, 163, 0.35)',
                                    color: 'var(--neon-green)',
                                    fontSize: '10px',
                                    padding: '2px 6px',
                                  }}
                                >
                                  Copied!
                                </span>
                              ) : null}
                              <span className={isHot ? 'tokenRowBadge tokenRowBadgeHot' : 'tokenRowBadge tokenRowBadgeTrack'}>
                                {isHot ? 'HOT' : 'TRACK'}
                              </span>
                              {t.error ? (
                                <span
                                  className={
                                    ruggedLabel
                                      ? 'tokenRowBadge tokenRowBadgeRugged'
                                      : 'tokenRowBadge tokenRowBadgeWarm'
                                  }
                                  title={t.error}
                                >
                                  {ruggedLabel || 'ISSUE'}
                                </span>
                              ) : null}
                            </div>
                            <div className="watchCell watchCellCenter mono" data-label="Age">{formatAgeShort(ageMs)}</div>
                            <div className="watchCell watchCellCenter mono" data-label="Entry MC">{formatUsd0(t.entryMc)}</div>
                            <div
                              className="watchCell watchCellCenter mono"
                              data-label="Current MC (feed)"
                              title={
                                showQuoteProxy
                                  ? `Feed MC looks stale (last snapshot ${formatAgeShort(mcAgeMs!)} ago). Showing quote-based MC proxy instead.\n\nLast feed MC: ${formatUsd0(t.currentMc)}\nQuote MC proxy: ≈${formatUsd0(quoteMcProxy)}`
                                  : mcIsStale
                                    ? `MC looks stale (last snapshot ${formatAgeShort(mcAgeMs!)} ago). MC only updates when this mint appears in the dequanW feed snapshot.`
                                    : 'MC updates only when this mint appears in the dequanW feed snapshot.'
                              }
                              style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }}
                            >
                              <span>{showQuoteProxy ? `≈${formatUsd0(quoteMcProxy)}` : formatUsd0(t.currentMc)}</span>
                              {showQuoteProxy ? (
                                <span className="tokenRowBadge tokenRowBadgeProxy">PROXY</span>
                              ) : mcIsStale ? (
                                <span className="tokenRowBadge tokenRowBadgeWarm">STALE</span>
                              ) : null}
                            </div>
                            <div className="watchCell watchCellCenter" data-label="Chart">
                              <button
                                type="button"
                                className="sparklineBtn"
                                onClick={() => {
                                  setHoldingDrawerMint('')
                                  setWatchDrawerMint(t.mint)
                                }}
                                title="Open chart (MC points update ~5s when snapshots are available)"
                              >
                                {points ? (
                                  <svg width="92" height="26" viewBox="0 0 92 26" preserveAspectRatio="none">
                                    <polyline
                                      points={points}
                                      fill="none"
                                      stroke={
                                        trend === 'up'
                                          ? 'rgba(0,255,163,0.9)'
                                          : trend === 'down'
                                            ? 'rgba(248,81,73,0.9)'
                                            : 'rgba(234,242,255,0.6)'
                                      }
                                      strokeWidth="2"
                                      strokeLinejoin="round"
                                      strokeLinecap="round"
                                    />
                                  </svg>
                                ) : (
                                  <span className="sparklineEmpty">—</span>
                                )}
                              </button>
                            </div>
                            <div
                              className={
                                typeof growth === 'number' && growth > 0
                                  ? 'watchCell watchCellCenter mono pos'
                                  : typeof growth === 'number' && growth < 0
                                    ? 'watchCell watchCellCenter mono neg'
                                    : 'watchCell watchCellCenter mono'
                              }
                              data-label="Growth"
                            >
                              {Number.isFinite(growth) ? `${growth.toFixed(2)}%` : '—'}
                            </div>
                            <div className="watchActions">
                              <button
                                className="ghost"
                                onClick={() => {
                                  if (ruggedLabel) {
                                    const confirmed = window.confirm(
                                      `This token appears to be rugged (no liquidity route found).\n\nAre you sure you want to continue?\n\nMint: ${t.mint}`
                                    )
                                    if (!confirmed) return
                                  }
                                  setTokenMint(t.mint)
                                  const panel = document.getElementById('snipe-panel')
                                  panel?.classList.add('animate-glitch-pulse')
                                  setTimeout(() => panel?.classList.remove('animate-glitch-pulse'), 500)
                                  void buy()
                                }}
                                disabled={step !== 'idle'}
                              >
                                Snipe
                              </button>
                              <button className="ghost" onClick={() => removeWatchedToken(t.mint)}>
                                Remove
                              </button>
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <div style={{ padding: '10px 4px', color: 'var(--muted)', fontSize: '12px' }}>No watched tokens yet.</div>
                    )}
                  </div>
                </>
              ) : null}
            </section>

            <section
              className="panel"
              style={{ flex: '0 0 auto', overflow: 'visible', display: 'flex', flexDirection: 'column' }}
            >
              <div
                className="panelHead panelHeadClickable"
                role="button"
                tabIndex={0}
                aria-expanded={liveFeedOpen}
                onClick={() => setLiveFeedOpen((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setLiveFeedOpen((v) => !v)
                  }
                }}
              >
                <div className="panelHeadTop">
                  <div className="panelTitle" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    Live Feed
                    <span
                      aria-label={feedError ? 'Feed error' : 'Feed healthy'}
                      title={feedError ? 'Feed error' : 'Feed healthy'}
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '999px',
                        background: feedError ? 'rgba(248,81,73,0.95)' : 'rgba(46,208,110,0.95)',
                        boxShadow: feedError ? '0 0 10px rgba(248,81,73,0.35)' : '0 0 10px rgba(46,208,110,0.25)',
                        flex: '0 0 auto',
                      }}
                    />
                  </div>
                  <div className="panelChevron">{liveFeedOpen ? '▾' : '▸'}</div>
                </div>
                <div className="panelHint">Auto-refreshing kinetic stream from dequanW</div>
                {feedLooksStale && !feedError ? (
                  <div className="panelHint" style={{ color: 'var(--warn)', marginTop: '2px' }}>
                    Feed looks stale (newest token {typeof feedNewestAgeMs === 'number' ? formatAgeShort(feedNewestAgeMs) : '—'} ago)
                  </div>
                ) : null}
              </div>

              {liveFeedOpen ? (
                <>
                  {/* THE STREAM CONTAINER */}
                  <div style={{ paddingRight: '4px', position: 'relative' }}>
                    <div className="scanning-line" />

                    <div className="feedHeaderRow">
                      <div className="feedHeaderCell">Token</div>
                      <div className="feedHeaderCell">Market Cap</div>
                      <div className="feedHeaderCell">MC Δ</div>
                      <div className="feedHeaderCell" style={{ textAlign: 'right' }}>Actions</div>
                    </div>

                    <AnimatePresence mode="popLayout">
                      {feed.slice(0, 20).map((t) => (
                        <TokenRow
                          key={t.mint}
                          token={t}
                          onLoad={(mint) => {
                            setTokenMint(mint)
                            void refreshBalances()
                          }}
                          onWatch={watchMint}
                          onSnipe={(mint) => {
                            setTokenMint(mint)
                            // Trigger snipe panel pulse
                            const panel = document.getElementById('snipe-panel')
                            panel?.classList.add('animate-glitch-pulse')
                            setTimeout(() => panel?.classList.remove('animate-glitch-pulse'), 500)
                            void buy()
                          }}
                          disabled={step !== 'idle'}
                        />
                      ))}
                    </AnimatePresence>

                    {/* EMPTY STATE */}
                    {!feed.length ? (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          height: '300px',
                          opacity: 0.6,
                        }}
                      >
                        <div
                          className="radar-sweep"
                          style={{
                            width: '60px',
                            height: '60px',
                            borderRadius: '50%',
                            border: '2px solid var(--neon-green)',
                            marginBottom: '16px',
                          }}
                        />
                        <div style={{ fontSize: '14px', color: 'var(--muted)' }}>Scanning for Signals...</div>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </section>
          </div>

          {/* RIGHT 35%: THE COMMAND CENTER (Fixed Sidebar) */}
          <aside className="commandCenter">
            {/* SNIPE PANEL */}
            <section id="snipe-panel" className="panel">
              <div className={`flipCard ${snipeCardSide === 'sell' ? 'isFlipped' : ''}`}>
                <div className="flipCardInner">
                  <div className="flipCardFace flipCardFront">
                    <div className="panelHead">
                      <div className="panelTitle">
                        <button
                          type="button"
                          className="panelTitleButton panelHeadClickable"
                          onClick={() => setSnipeCardSide('sell')}
                          title="Flip to Sell"
                          aria-label="Flip to Sell"
                        >
                          Snipe
                        </button>
                        <HelpDot href={helpUrl('submitted-vs-confirmed')} title="Submitted vs confirmed" />
                        <HelpDot href={helpUrl('real-solana-ws-confirm')} title="Real Solana WS confirmations" />
                      </div>
                      <div className="panelHint">Quick execution</div>
                    </div>

                    <div className="row">
                      <label>Token Mint</label>
                      <input
                        value={tokenMint}
                        onChange={(e) => setTokenMint(e.target.value)}
                        placeholder="Token mint address…"
                        spellCheck={false}
                        autoCapitalize="none"
                        autoCorrect="off"
                      />
                    </div>

                    <div className="row">
                      <label>Amount (SOL)</label>
                      <div className="inline">
                        <input
                          value={amountSol}
                          onChange={(e) => setAmountSol(e.target.value)}
                          inputMode="decimal"
                          placeholder="0.01"
                        />
                        <div className="quick">
                          <button className={amountSol === '0.01' ? 'pillBtn pillBtnActive' : 'pillBtn'} onClick={() => setAmountSol('0.01')}>
                            0.01
                          </button>
                          <button className={amountSol === '0.05' ? 'pillBtn pillBtnActive' : 'pillBtn'} onClick={() => setAmountSol('0.05')}>
                            0.05
                          </button>
                          <button className={amountSol === '0.1' ? 'pillBtn pillBtnActive' : 'pillBtn'} onClick={() => setAmountSol('0.1')}>
                            0.1
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="row">
                      <label>Slippage (bps)</label>
                      <div className="inline">
                        <input
                          value={String(slippageBps)}
                          onChange={(e) => setSlippageBps(Number(e.target.value))}
                          inputMode="numeric"
                          placeholder="4000"
                        />
                      </div>
                    </div>

                    {gates.allowLiveTrading ? (
                      <div className="row" style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                        <div className="note" style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                          Fee breakdown ({(() => {
                            const bps = gates.tradeFeeBps ?? 100
                            return `${(bps / 100).toFixed(2)}% protocol fee`
                          })()})
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '2px' }}>
                          <span className="muted">Trade amount</span>
                          <span className="mono">{amountSol} SOL</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '2px' }}>
                          <span className="muted">Fee ({(() => {
                            const bps = gates.tradeFeeBps ?? 100
                            return `${(bps / 100).toFixed(2)}%`
                          })()})</span>
                          <span className="mono">{(() => {
                            const amt = Number(amountSol || 0)
                            const bps = gates.tradeFeeBps ?? 100
                            const feeRate = bps / 10000
                            return Number.isFinite(amt) && amt > 0 ? (amt * feeRate).toFixed(6) : '0.000000'
                          })()} SOL</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 600, paddingTop: '4px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                          <span>Total required</span>
                          <span className="mono">{(() => {
                            const amt = Number(amountSol || 0)
                            const bps = gates.tradeFeeBps ?? 100
                            const feeRate = bps / 10000
                            return Number.isFinite(amt) && amt > 0 ? (amt * (1 + feeRate)).toFixed(6) : '0.000000'
                          })()} SOL</span>
                        </div>
                      </div>
                    ) : null}

                    <div className="ctaRow">
                      <button className="primary" onClick={buy} disabled={step !== 'idle'} style={{ flex: 1 }}>
                        {step === 'idle' ? 'Snipe' : step === 'done' ? 'Done' : `${step}…`}
                      </button>
                      <button className="secondary" onClick={clearSnipeForm} disabled={step !== 'idle'} type="button">
                        Clear
                      </button>
                    </div>

                    {snipePrompt && step === 'connecting' ? (
                      <div className="note" style={{ marginTop: '10px', color: 'var(--muted)' }}>
                        {snipePrompt}
                      </div>
                    ) : null}

                    {uiError ? (
                      <div className="error" title={uiErrorTitle || undefined}>
                        {uiError}
                      </div>
                    ) : null}
                    {txSig ? (
                      <div className="note">
                        <a
                          href={`https://solscan.io/tx/${txSig}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--accent)', textDecoration: 'underline' }}
                        >
                          View on Solscan
                        </a>
                      </div>
                    ) : null}

                    {bgTx && bgTx.sig === txSig ? (
                      <div className="note" style={{ color: 'var(--muted)' }}>
                        {bgTx.status === 'confirming'
                          ? `Submitted (sig received) — confirming in background…`
                          : bgTx.status === 'confirmed'
                            ? 'Confirmed'
                            : bgTx.status === 'not_found'
                              ? 'Signature not found on chain — likely dropped (retry)'
                              : bgTx.status === 'timeout'
                                ? 'Still confirming — check Solscan'
                                : bgTx.error
                                  ? `Confirmation failed: ${bgTx.error}`
                                  : 'Confirmation failed'}
                      </div>
                    ) : null}

                    <div className="statusCompact">
                      <div className="statusLine">
                        <span className="muted">SOL Balance</span>
                        <span className="mono">
                          {!connected
                            ? 'Connect wallet'
                            : balanceLoading
                              ? '…'
                              : solBalanceLamports !== null
                                ? (Number(solBalanceLamports) / 1e9).toFixed(4)
                                : balanceError
                                  ? 'RPC error'
                                  : '—'}
                        </span>
                      </div>
                      <div className="statusLine">
                        <span className="muted">Token Balance</span>
                        <span className="mono">
                          {!connected
                            ? '—'
                            : balanceLoading
                              ? '…'
                              : tokenBalance !== null
                                ? (Number(tokenBalance.amount) / Math.pow(10, tokenBalance.decimals)).toFixed(4)
                                : balanceError
                                  ? 'RPC error'
                                  : '—'}
                        </span>
                      </div>
                    </div>

                    {connected && balanceError ? (
                      <div className="note" style={{ color: 'var(--muted)' }}>
                        Balance fetch issue: {balanceError}
                      </div>
                    ) : null}
                  </div>

                  <div className="flipCardFace flipCardBack">
                    <div className="panelHead">
                      <div className="panelTitle">Sell</div>
                      <div className="panelHint">
                        <button
                          className="pillBtn"
                          onClick={() => {
                            setSnipeCardSide('snipe')
                          }}
                          type="button"
                        >
                          Return to Snipe
                        </button>
                      </div>
                    </div>

                    <div className="row">
                      <label>Token Mint</label>
                      <input
                        value={sellMintInput}
                        onChange={(e) => setSellMintInput(e.target.value.trim())}
                        placeholder="Token mint address…"
                        spellCheck={false}
                        autoCapitalize="none"
                        autoCorrect="off"
                      />
                    </div>

                    <div className="row">
                      <label>Sell %</label>
                      <div className="inline">
                        <div className="quick">
                          <button className={sellPct === 25 ? 'pillBtn pillBtnActive' : 'pillBtn'} onClick={() => setSellPct(25)} type="button">
                            25%
                          </button>
                          <button className={sellPct === 50 ? 'pillBtn pillBtnActive' : 'pillBtn'} onClick={() => setSellPct(50)} type="button">
                            50%
                          </button>
                          <button className={sellPct === 100 ? 'pillBtn pillBtnActive' : 'pillBtn'} onClick={() => setSellPct(100)} type="button">
                            100%
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="ctaRow">
                      <button
                        className="primary danger"
                        onClick={() => sell(sellMintInput, sellPct)}
                        disabled={!sellMintInput || sellStep !== 'idle'}
                        style={{ flex: 1 }}
                      >
                        {sellStep === 'idle' ? 'Sell' : `Selling… (${sellStep})`}
                      </button>
                      <button
                        onClick={() => {
                          setSellMintInput('')
                          setSellPct(100)
                        }}
                        disabled={sellStep !== 'idle'}
                        type="button"
                      >
                        Clear
                      </button>
                    </div>

                    {sellError ? (
                      <div className="error">
                        {sellError}
                      </div>
                    ) : null}

                    {sellSig ? (
                      <div className="note">
                        <a
                          href={`https://solscan.io/tx/${sellSig}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--accent)', textDecoration: 'underline' }}
                        >
                          View sell on Solscan
                        </a>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            {snipeCardSide === 'sell' ? (
              <section className="panel">
                <div className="panelHead">
                  <div className="panelTitle">Sold Tokens</div>
                  <div className="panelHint">
                    <button className="pillBtn" disabled={soldTokens.length === 0} onClick={() => setSoldTokens([])} type="button">
                      Clear all
                    </button>
                  </div>
                </div>
                <div className="panelBody" style={{ paddingTop: 0 }}>
                  {soldTokens.length === 0 ? (
                    <div className="note" style={{ color: 'var(--text-muted)' }}>
                      No sold tokens yet.
                    </div>
                  ) : (
                    <div className="tableWrap" style={{ marginTop: 10 }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Mint</th>
                                <th>%</th>
                            <th>When</th>
                            <th>Sig</th>
                          </tr>
                        </thead>
                        <tbody>
                          {soldTokens.map((t) => (
                            <tr key={`${t.mint}-${t.soldAt}`}>
                              <td className="mono" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {t.mint}
                              </td>
                                  <td className="mono">{typeof t.pct === 'number' ? `${Math.max(1, Math.min(100, Math.floor(t.pct)))}%` : '—'}</td>
                              <td className="mono">{new Date(t.soldAt).toLocaleString()}</td>
                              <td className="mono" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {t.signature ? (
                                  <a
                                    href={`https://solscan.io/tx/${t.signature}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: 'var(--accent)', textDecoration: 'underline' }}
                                  >
                                    {t.signature}
                                  </a>
                                ) : t.outcome === 'RUGGED' ? (
                                  <span className="tokenRowBadge tokenRowBadgeRugged">RUGGED</span>
                                ) : (
                                  ''
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {gates.allowFastMode ? (
              <section className="panel">
                <div className="panelHead">
                  <div className="panelTitle">
                    Fast Mode
                    <HelpDot href={helpUrl('capped-fast-mode')} title="Fast Mode is capped risk" />
                  </div>
                  <div className="panelHint">Pro/Elite: arm a capped WSOL session</div>
                </div>

                <div className="row">
                  <label>Cap (SOL)</label>
                  <input
                    value={fastModeCapSol}
                    onChange={(e) => setFastModeCapSol(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.25"
                    disabled={fastModeStatus !== 'disarmed'}
                  />
                </div>

                <div className="statusCompact">
                  <div className="statusLine">
                    <span className="muted">Status</span>
                    <span className="mono">{fastModeStatus.toUpperCase()}</span>
                  </div>
                  <div className="statusLine">
                    <span className="muted">Session</span>
                    <span className="mono">
                      {fastModeSessionPubkey ? `${fastModeSessionPubkey.slice(0, 4)}…${fastModeSessionPubkey.slice(-4)}` : '—'}
                    </span>
                  </div>
                  <div className="statusLine">
                    <span className="muted">Expires</span>
                    <span className="mono">{fastModeExpiresAtMs ? new Date(fastModeExpiresAtMs).toLocaleTimeString() : '—'}</span>
                  </div>
                </div>

                <div className="row" style={{ alignItems: 'center', gap: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: fastModeStatus === 'armed' ? 'pointer' : 'not-allowed' }}>
                    <input
                      type="checkbox"
                      checked={useDelegateFastModeBuys}
                      onChange={(e) => setUseDelegateFastModeBuys(e.target.checked)}
                      disabled={fastModeStatus !== 'armed' || useBotWalletForTrades}
                    />
                    <span>Use Delegate Fast Buys (experimental)</span>
                  </label>
                </div>

                <div className="ctaRow">
                  {fastModeStatus === 'disarmed' ? (
                    <button
                      className="primary"
                      onClick={enableFastMode}
                      disabled={!connected || !gates.allowLiveTrading}
                      style={{ flex: 1 }}
                    >
                      Enable Fast Mode
                    </button>
                  ) : (
                    <button className="primary" onClick={revokeFastMode} disabled={fastModeStatus !== 'armed'} style={{ flex: 1 }}>
                      Revoke Fast Mode
                    </button>
                  )}
                </div>

                <div className="note" style={{ color: 'var(--muted)' }}>
                  Arms WSOL delegate allowance + tops up the session key for fees. If enabled, BUYs execute via the session key (no Phantom popup).
                </div>

                {fastModeError ? <div className="error">{fastModeError}</div> : null}

                <div style={{ height: '12px' }} />

                <div className="panelHead" style={{ paddingTop: 0 }}>
                  <div className="panelTitle" style={{ fontSize: '12px' }}>Bot Wallet (No-Popup)</div>
                  <div className="panelHint">Self-custody wallet stored locally</div>
                </div>

                {!botWalletPubkey ? (
                  <div className="ctaRow">
                    <button
                      className="primary"
                      style={{ flex: 1 }}
                      onClick={() => {
                        setBotWalletError('')
                        const ok = window.confirm(
                          'This will create a new local bot wallet and store its secret key in your browser localStorage. Only fund small amounts. Continue?'
                        )
                        if (!ok) return
                        try {
                          const kp = Keypair.generate()
                          botWalletRef.current = kp
                          saveBotWalletKeypair(kp)
                          setBotWalletPubkey(kp.publicKey.toBase58())
                          setUseBotWalletForTrades(true)
                          void refreshBotWalletBalance()
                        } catch (e) {
                          setBotWalletError(e instanceof Error ? e.message : 'Failed to create bot wallet')
                        }
                      }}
                      disabled={!gates.allowLiveTrading}
                    >
                      Create Bot Wallet
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="statusCompact">
                      <div className="statusLine">
                        <span className="muted">Address</span>
                        <span className="mono">{`${botWalletPubkey.slice(0, 4)}…${botWalletPubkey.slice(-4)}`}</span>
                      </div>
                      <div className="statusLine">
                        <span className="muted">SOL</span>
                        <span className="mono">{botWalletSolLamports !== null ? (Number(botWalletSolLamports) / 1e9).toFixed(4) : '—'}</span>
                      </div>
                    </div>

                    <div className="row" style={{ marginTop: '8px' }}>
                      <label>Use for trades</label>
                      <div className="inline">
                        <button
                          className={useBotWalletForTrades ? 'pillBtn pillBtnActive' : 'pillBtn'}
                          onClick={() => setUseBotWalletForTrades(true)}
                          disabled={!gates.allowLiveTrading}
                        >
                          ON
                        </button>
                        <button
                          className={!useBotWalletForTrades ? 'pillBtn pillBtnActive' : 'pillBtn'}
                          onClick={() => setUseBotWalletForTrades(false)}
                        >
                          OFF
                        </button>
                        <button className="pillBtn" onClick={() => void refreshBotWalletBalance()}>
                          Refresh
                        </button>
                      </div>
                    </div>

                    <div className="note" style={{ color: 'var(--muted)' }}>
                      Fund this wallet by sending SOL to the address above. When ON, buys/sells are signed locally (no Phantom popup).
                    </div>

                    <div className="ctaRow">
                      <button
                        className="primary"
                        style={{ flex: 1, background: 'rgba(248,81,73,0.15)', borderColor: 'rgba(248,81,73,0.35)' }}
                        onClick={() => {
                          const ok = window.confirm('Remove bot wallet from this browser? Funds remain on-chain but you may lose access if not backed up.')
                          if (!ok) return
                          botWalletRef.current = null
                          clearBotWalletKeypair()
                          setBotWalletPubkey('')
                          setUseBotWalletForTrades(false)
                          setBotWalletSolLamports(null)
                        }}
                      >
                        Remove Bot Wallet
                      </button>
                    </div>
                  </>
                )}

                {botWalletError ? <div className="error">{botWalletError}</div> : null}
              </section>
            ) : null}
          </aside>
      </main>

      {debugOpen ? (
        <div className="debugBackdrop" role="dialog" aria-modal="true">
          <div className="debugModal">
            <div className="debugHead">
              <div>
                <div className="debugTitle">Debug Portal</div>
                <div className="debugHint">Owner-only diagnostics (client-side gate)</div>
              </div>
              <button className="debugClose" onClick={closeDebug}>
                Close
              </button>
            </div>

            {!canOpenDebug ? (
              <div className="debugLocked">
                <div className="note" style={{ marginBottom: '10px' }}>
                  Enter passcode to unlock.
                  {debugAdminPubkey ? (
                    <>
                      {' '}(Wallet check: <span className="mono">{walletUnlockOk ? 'OK' : 'not connected'}</span>)
                    </>
                  ) : (
                    <>
                      {' '}(Optional: set <span className="mono">VITE_DEBUG_ADMIN_PUBKEY</span> to show a wallet-owner check.)
                    </>
                  )}
                </div>
                <div className="row">
                  <label>Passcode</label>
                  <div className="inline">
                    <input
                      value={debugPasscode}
                      onChange={(e) => setDebugPasscode(e.target.value)}
                      inputMode="numeric"
                      placeholder="8 digits"
                      type="password"
                    />
                    <button className="primary" onClick={submitDebugPasscode}>
                      Unlock
                    </button>
                  </div>
                  <div className="note">Passcode is required (wallet never unlocks by itself).</div>
                </div>
              </div>
            ) : (
              <>
                <div className="debugGrid">
                  <div className="debugCard">
                    <div className="debugCardTitle">Trading API</div>
                    <div className="debugPills">
                      <span className={`healthPill ${wsStatus === 'connected' ? 'ok' : 'bad'}`}>WS {wsStatus}</span>
                      <span className={`healthPill ${uiError ? 'warn' : 'ok'}`}>Err {uiError ? 'yes' : 'no'}</span>
                      <span className={`healthPill ${Date.now() < userRateLimitUntilMs ? 'warn' : 'ok'}`}>
                        User RL {Date.now() < userRateLimitUntilMs ? 'active' : 'ok'}
                      </span>
                    </div>
                    <div className="debugKv"><span>WS URL</span><span className="mono">{wsUrl}</span></div>
                    <div className="debugKv"><span>Last connect</span><span className="mono">{formatTs(lastWsConnectedAt)}</span></div>
                    <div className="debugKv"><span>Last error</span><span className="mono">{formatTs(lastWsErrorAt)}</span></div>
                    <div className="debugKv"><span>Msgs received</span><span className="mono">{wsDiag.messageCount}</span></div>
                    <div className="debugKv"><span>Last msg</span><span className="mono">{formatTs(wsDiag.lastMessageAt)}</span></div>
                    <div className="debugKv"><span>Last msg type</span><span className="mono">{wsDiag.lastMessageType || '—'}</span></div>
                    <div className="debugKv"><span>Last API error</span><span className="mono">{formatTs(lastTradingApiErrorAt)}</span></div>
                    <div className="debugKv"><span>Last API code</span><span className="mono">{lastTradingApiErrorCode || '—'}</span></div>
                    <div className="debugKv"><span>Last API msg</span><span className="mono">{lastTradingApiErrorMessage || '—'}</span></div>
                    <div className="debugKv"><span>User backoff until</span><span className="mono">{formatTs(userRateLimitUntilMs)}</span></div>
                    {uiError ? (
                      <div className="error" style={{ marginTop: '10px' }} title={uiErrorTitle || undefined}>
                        {uiError}
                      </div>
                    ) : null}

                    <div style={{ marginTop: '10px' }}>
                      <div className="debugCardTitle" style={{ marginBottom: '6px' }}>
                        Recent errors (last 10)
                      </div>
                      {tradingApiErrorLog.length ? (
                        <div
                          style={{
                            maxHeight: 150,
                            overflow: 'auto',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 10,
                            padding: 8,
                            background: 'rgba(0,0,0,0.20)',
                          }}
                        >
                          {tradingApiErrorLog.map((x) => (
                            <div
                              key={`${x.at}-${x.code}-${x.message}`}
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '155px 120px 1fr',
                                gap: 10,
                                padding: '6px 0',
                                borderTop: '1px solid rgba(255,255,255,0.06)',
                              }}
                            >
                              <span className="mono" style={{ color: 'rgba(255,255,255,0.75)' }}>
                                {formatTs(x.at)}
                              </span>
                              <span className="mono" style={{ color: 'rgba(255,255,255,0.70)' }}>
                                {x.code || '—'}
                              </span>
                              <span className="mono" style={{ color: 'rgba(255,255,255,0.85)' }}>
                                {x.message}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="note">No recent errors.</div>
                      )}
                      <div className="ctaRow" style={{ marginTop: '8px' }}>
                        <button className="secondary" onClick={() => setTradingApiErrorLog([])}>
                          Clear error log
                        </button>
                      </div>
                    </div>
                    <div className="ctaRow" style={{ marginTop: '10px' }}>
                      <button className="primary" onClick={connectTradingApi} disabled={step !== 'idle'}>
                        Connect
                      </button>
                      <button
                        className="secondary"
                        onClick={() => {
                          wsRef.current?.close()
                          setWsStatus('disconnected')
                        }}
                        disabled={step !== 'idle'}
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>

                  <div className="debugCard">
                    <div className="debugCardTitle">Trading API health (/healthz)</div>
                    <div className="debugKv"><span>Health URL</span><span className="mono">{tierCountsHealthzUrl || '—'}</span></div>
                    <div className="debugKv"><span>Last fetch</span><span className="mono">{formatTs(tierCountsAt)}</span></div>

                    <div className="debugCardTitle" style={{ marginTop: 10, marginBottom: 6 }}>
                      Auth requirements
                    </div>
                    <div className="debugKv"><span>Auth required</span><span className="mono">{tradingApiHealth?.auth?.required ? 'yes' : 'no/unknown'}</span></div>
                    <div className="debugKv"><span>Cloudflare Access</span><span className="mono">{tradingApiHealth?.auth?.cfAccess?.required ? 'required' : tradingApiHealth?.auth?.methods?.cfAccess ? 'enabled' : 'off/unknown'}</span></div>
                    <div className="debugKv"><span>Wallet signature</span><span className="mono">{tradingApiHealth?.auth?.walletSig?.required ? 'required' : 'optional/unknown'}</span></div>
                    <div className="debugKv"><span>Legacy JWT</span><span className="mono">{tradingApiHealth?.auth?.jwt?.disabled ? 'disabled' : 'enabled/unknown'}</span></div>
                    <div className="debugKv"><span>Allowed origins</span><span className="mono">{tradingApiHealth?.originAllowlist?.allowedOrigins?.length ?? '—'}</span></div>

                    <div className="debugCardTitle" style={{ marginTop: 10, marginBottom: 6 }}>
                      Connections (best-effort)
                    </div>
                    <div className="debugKv"><span>Total sockets</span><span className="mono">{tierCounts ? tierCounts.totalSockets : '—'}</span></div>
                    <div className="debugKv"><span>Authed users</span><span className="mono">{tierCounts ? tierCounts.authed : '—'}</span></div>
                    <div className="debugKv"><span>Authed sockets</span><span className="mono">{tierCounts?.authedSockets ?? '—'}</span></div>
                    <div className="debugKv"><span>Scout</span><span className="mono">{tierCounts ? tierCounts.tiers.free : '—'}</span></div>
                    <div className="debugKv"><span>Sniper</span><span className="mono">{tierCounts ? tierCounts.tiers.pro : '—'}</span></div>
                    <div className="debugKv"><span>Apex</span><span className="mono">{tierCounts ? tierCounts.tiers.elite : '—'}</span></div>

                    {tierCountsError ? (
                      <div className="error" style={{ marginTop: '10px' }}>
                        {tierCountsError}
                        {tierCountsError === 'healthz_http_302' ? (
                          <div className="note" style={{ marginTop: 8 }}>
                            Access login is likely required for the WS hostname. Open the Health URL in a new tab and complete Cloudflare Access login.
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="note" style={{ marginTop: '8px' }}>
                      Health is fetched with credentials so Cloudflare Access session cookies can be used.
                    </div>
                  </div>

                  <div className="debugCard">
                    <div className="debugCardTitle">Auth</div>
                    <div className="debugPills">
                      <span className={`healthPill ${(connected && publicKey) ? 'ok' : 'warn'}`}>Wallet {(connected && publicKey) ? 'on' : 'off'}</span>
                      <span className={`healthPill ${signMessage ? 'ok' : 'warn'}`}>signMessage {signMessage ? 'ok' : 'no'}</span>
                      <span className={`healthPill ${(apiKey.trim() || authToken.trim()) ? 'warn' : 'ok'}`}>Legacy {(apiKey.trim() || authToken.trim()) ? 'on' : 'off'}</span>
                    </div>

                    <div className="debugKv"><span>Auth label</span><span className="mono">{authLabel}</span></div>
                    <div className="debugKv"><span>Tier (client)</span><span className="mono">{tier}</span></div>
                    <div className="debugKv"><span>Gates</span><span className="mono">{JSON.stringify(gates)}</span></div>
                  </div>

                  <div className="debugCard">
                    <div className="debugCardTitle">Feed</div>
                    <div className="debugPills">
                      <span className={`healthPill ${feedError ? 'warn' : 'ok'}`}>HTTP {feedError ? 'warn' : 'ok'}</span>
                      <span className={`healthPill ${feed.length ? 'ok' : 'warn'}`}>Items {feed.length}</span>
                    </div>
                    <div className="debugKv"><span>Dash base</span><span className="mono">{dequanwDashBase}</span></div>
                    <div className="debugKv"><span>Last fetch</span><span className="mono">{formatTs(lastFeedFetchedAt)}</span></div>
                    <div className="row" style={{ alignItems: 'center', gap: '10px', marginTop: '10px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={debugIncludeRugged}
                          onChange={(e) => setDebugIncludeRugged(e.target.checked)}
                        />
                        <span>Include rugged tokens (debug)</span>
                      </label>
                      <button className="secondary" onClick={() => void fetchDequanwFeed()}>
                        Refresh
                      </button>
                    </div>
                    <div className="debugKv">
                      <span>MC sample</span>
                      <span
                        className="mono"
                        style={{ maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {feedSampleDebug?.mappedFirstRow ? JSON.stringify(feedSampleDebug.mappedFirstRow) : '—'}
                      </span>
                    </div>
                    <div className="debugKv">
                      <span>Raw /feed[0]</span>
                      <span
                        className="mono"
                        style={{ maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {feedSampleDebug?.rawFeedFirstItem ? JSON.stringify(feedSampleDebug.rawFeedFirstItem) : '—'}
                      </span>
                    </div>
                    <div className="debugKv">
                      <span>Raw /watching[0]</span>
                      <span
                        className="mono"
                        style={{ maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {feedSampleDebug?.rawWatchingFirstItem ? JSON.stringify(feedSampleDebug.rawWatchingFirstItem) : '—'}
                      </span>
                    </div>
                    {feedError ? <div className="error" style={{ marginTop: '10px' }}>Feed: {feedError}</div> : null}
                  </div>

                  <div className="debugCard">
                    <div className="debugCardTitle">Solana</div>
                    <div className="debugPills">
                      <span className={`healthPill ${solProbe?.error ? 'warn' : 'ok'}`}>RPC {solProbe?.error ? 'warn' : 'ok'}</span>
                      <span className={`healthPill ${solanaWsEndpoint !== '—' ? 'ok' : 'warn'}`}>WS {solanaWsEndpoint !== '—' ? 'set' : 'off'}</span>
                    </div>
                    <div className="debugKv"><span>RPC endpoint</span><span className="mono">{solanaRpcEndpoint}</span></div>
                    <div className="debugKv"><span>WS endpoint</span><span className="mono">{solanaWsEndpoint}</span></div>
                    <div className="debugKv"><span>Last probe</span><span className="mono">{solProbe?.at ? formatTs(solProbe.at) : '—'}</span></div>
                    <div className="debugKv"><span>Probe ms</span><span className="mono">{solProbe ? `${solProbe.ms}ms` : '—'}</span></div>
                    <div className="debugKv"><span>Slot</span><span className="mono">{typeof solProbe?.slot === 'number' ? solProbe.slot : '—'}</span></div>
                    <div className="debugKv"><span>Blockhash</span><span className="mono">{solProbe?.blockhash ? `${solProbe.blockhash.slice(0, 8)}…` : '—'}</span></div>
                    <div className="debugKv"><span>Probe error</span><span className="mono">{solProbe?.error || '—'}</span></div>
                    <div className="row" style={{ alignItems: 'center', gap: '10px', marginTop: '10px' }}>
                      <button className="secondary" onClick={() => void runSolProbe()}>Probe now</button>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={solAutoProbe} onChange={(e) => setSolAutoProbe(e.target.checked)} />
                        <span>Auto probe (30s)</span>
                      </label>
                    </div>
                  </div>

                  <div className="debugCard">
                    <div className="debugCardTitle">Trading / Positions</div>
                    <div className="debugPills">
                      <span className={`healthPill ${watched.length ? 'ok' : 'warn'}`}>Watch {watched.length}</span>
                      <span className={`healthPill ${holdings.length ? 'ok' : 'warn'}`}>Hold {holdings.length}</span>
                      <span
                        className={`healthPill ${bgTx ? (bgTx.status === 'confirmed' ? 'ok' : bgTx.status === 'confirming' ? 'warn' : 'bad') : 'ok'}`}
                      >
                        Tx {bgTx ? bgTx.status : '—'}
                      </span>
                    </div>

                    <div className="debugKv"><span>Quote poll</span><span className="mono">{gates.quotePollMs}ms</span></div>
                    <div className="debugKv"><span>Max watched</span><span className="mono">{gates.maxWatchedTokens}</span></div>
                    <div className="debugKv"><span>Last tx sig</span><span className="mono">{txSig ? `${txSig.slice(0, 10)}…` : '—'}</span></div>
                    <div className="debugKv"><span>BG tx started</span><span className="mono">{bgTx?.startedAt ? formatTs(bgTx.startedAt) : '—'}</span></div>
                    <div className="debugKv"><span>BG tx finished</span><span className="mono">{bgTx?.finishedAt ? formatTs(bgTx.finishedAt) : '—'}</span></div>
                    <div className="debugKv"><span>BG tx latency</span><span className="mono">{bgTx?.finishedAt ? `${Math.max(0, Math.round((bgTx.finishedAt - bgTx.startedAt) / 1000))}s` : '—'}</span></div>
                    <div className="debugKv"><span>BG tx error</span><span className="mono">{bgTx?.error || '—'}</span></div>
                    <div className="ctaRow" style={{ marginTop: '10px' }}>
                      <button className="secondary" onClick={() => void copyDiagnostics()}>
                        Copy diagnostics
                      </button>
                    </div>
                  </div>

                  <div className="debugCard">
                    <div className="debugCardTitle">Timeline</div>
                    <div className="debugPills">
                      <span className={`healthPill ${debugTimeline.length ? 'ok' : 'warn'}`}>Events {debugTimeline.length}</span>
                      <button className="secondary" onClick={() => setDebugTimeline([])} style={{ marginLeft: 'auto' }}>
                        Clear
                      </button>
                    </div>

                    <div
                      style={{
                        maxHeight: 220,
                        overflow: 'auto',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 10,
                        padding: 8,
                        background: 'rgba(0,0,0,0.20)',
                      }}
                    >
                      {debugTimeline.length ? (
                        debugTimeline.map((x) => (
                          <div
                            key={`${x.at}-${x.area}-${x.message}`}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '150px 70px 70px 1fr',
                              gap: 10,
                              padding: '6px 0',
                              borderTop: '1px solid rgba(255,255,255,0.06)',
                            }}
                            title={x.detail || undefined}
                          >
                            <span className="mono" style={{ color: 'rgba(255,255,255,0.75)' }}>
                              {formatTs(x.at)}
                            </span>
                            <span className="mono" style={{ color: 'rgba(255,255,255,0.70)' }}>
                              {x.area}
                            </span>
                            <span
                              className={`healthPill ${x.level === 'error' ? 'bad' : x.level === 'warn' ? 'warn' : 'ok'}`}
                              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '2px 6px' }}
                            >
                              {x.level}
                            </span>
                            <span className="mono" style={{ color: 'rgba(255,255,255,0.88)' }}>
                              {x.message}
                              {x.detail ? ` — ${x.detail}` : ''}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="note">No events yet.</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="debugCard" style={{ marginTop: '12px' }}>
                  <div className="debugCardTitle">Connection Settings</div>
                  <div className="row">
                    <label>Trading API WS URL</label>
                    <input value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} spellCheck={false} />
                  </div>
                  <div className="row">
                    <label>API key (dev only)</label>
                    <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} spellCheck={false} />
                  </div>
                  <div className="row">
                    <label>Auth token (legacy)</label>
                    <input value={authToken} onChange={(e) => setAuthToken(e.target.value)} spellCheck={false} />
                  </div>
                  <div className="note">
                    Debug portal is client-side gated. For real security, enforce backend origin/IP/auth and use a wallet allowlist.
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
        </>
      ) : null}
    </div>
  )
}

export default App
