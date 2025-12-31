import './App.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { PublicKey } from '@solana/web3.js'
import { TradingWs } from './lib/tradingWs'
import {
  type ProductTier,
  type TradeMode,
  gatesForTier,
  loadSetting,
  loadTier,
  loadTradeMode,
  saveSetting,
  saveTier,
  saveTradeMode,
} from './lib/product'
import {
  PRICE_PROXY_SCALE,
  bigintFromString,
  clampTrades,
  computePriceProxyScaled,
  loadPaperState,
  newTradeId,
  positionPnlPct,
  positionValueLamports,
  savePaperState,
  type PaperPosition,
  type PaperState,
  type PaperTrade,
} from './lib/paperTrading'
import {
  SOL_MINT,
  baseUnitsToUi,
  getSolBalanceLamports,
  getTokenBalanceBaseUnits,
  toLamports,
  deserializeTx,
  formatSol,
} from './lib/solana'

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

type UiStep =
  | 'idle'
  | 'connecting'
  | 'quoting'
  | 'building'
  | 'signing'
  | 'submitting'
  | 'confirming'
  | 'done'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
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
  startedAt?: number
  source: 'dequanw'
  basePriceProxyScaled?: string
  lastPriceProxyScaled?: string
  growthPct?: number
  lastUpdatedAt?: number
  error?: string
}

type WatchedToken = {
  mint: string
  addedAt: number
  basePriceProxyScaled?: string
  lastPriceProxyScaled?: string
  basePriceProxy?: number
  lastPriceProxy?: number
  growthPct?: number
  lastUpdatedAt?: number
  error?: string
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

function formatAge(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return `${m}m ${rs}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h ${rm}m`
}

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
  }>
}

function App() {
  const { connection } = useConnection()
  const { publicKey, connected, signTransaction } = useWallet()

  const defaultWsUrl = import.meta.env.VITE_DEQUANW_WS_URL || 'ws://localhost:8900'
  const defaultApiKey = import.meta.env.VITE_DEQUANW_API_KEY || ''
  const defaultAuthToken = import.meta.env.VITE_DEQUANW_AUTH_TOKEN || ''

  const [wsUrl, setWsUrl] = useState(() => loadSetting('dequanswap.wsUrl', defaultWsUrl))
  const [apiKey, setApiKey] = useState(() => loadSetting('dequanswap.apiKey', defaultApiKey))
  const [authToken, setAuthToken] = useState(() => loadSetting('dequanswap.authToken', defaultAuthToken))

  const [tier, setTier] = useState<ProductTier>(() => loadTier())
  const [tradeMode, setTradeMode] = useState<TradeMode>(() => loadTradeMode())
  const gates = useMemo(() => gatesForTier(tier), [tier])

  const [uiMode, setUiMode] = useState<'minimalist' | 'advanced'>(() => {
    const raw = loadSetting('dequanswap.uiMode', 'minimalist')
    return raw === 'advanced' ? 'advanced' : 'minimalist'
  })

  const wsRef = useRef<TradingWs | null>(null)
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connected'>('disconnected')

  const [tokenMint, setTokenMint] = useState('')
  const [amountSol, setAmountSol] = useState('0.01')
  const [slippageBps, setSlippageBps] = useState(4000)

  const [watchMintInput, setWatchMintInput] = useState('')
  const [watched, setWatched] = useState<WatchedToken[]>(() =>
    parseWatchedTokens(localStorage.getItem('dequanswap.watchedTokens')),
  )

  const defaultDequanwDashBase = import.meta.env.VITE_DEQUANW_DASH_BASE || '/dequanw'
  const dequanwDashBase = defaultDequanwDashBase
  const [feed, setFeed] = useState<FeedToken[]>([])
  const [feedError, setFeedError] = useState<string>('')

  const [growthTriggerPct, setGrowthTriggerPct] = useState(() => {
    const raw = loadSetting('dequanswap.growthTriggerPct', '20')
    const n = Number(raw)
    return Number.isFinite(n) ? n : 20
  })
  const [triggeredCount, setTriggeredCount] = useState(0)
  const triggeredSetRef = useRef<Set<string>>(new Set())

  const [paper, setPaper] = useState<PaperState>(() => loadPaperState())

  const [step, setStep] = useState<UiStep>('idle')
  const [error, setError] = useState<string>('')
  const [txSig, setTxSig] = useState<string>('')

  const [solBalanceLamports, setSolBalanceLamports] = useState<number | null>(null)
  const [tokenBalance, setTokenBalance] = useState<{ amount: bigint; decimals: number } | null>(null)

  const canTrade = connected && publicKey && !!signTransaction

  useEffect(() => saveSetting('dequanswap.wsUrl', wsUrl), [wsUrl])
  useEffect(() => saveSetting('dequanswap.apiKey', apiKey), [apiKey])
  useEffect(() => saveSetting('dequanswap.authToken', authToken), [authToken])
  useEffect(() => saveSetting('dequanswap.dequanwDashBase', dequanwDashBase), [dequanwDashBase])
  useEffect(() => saveTier(tier), [tier])
  useEffect(() => saveTradeMode(tradeMode), [tradeMode])
  useEffect(() => saveSetting('dequanswap.uiMode', uiMode), [uiMode])
  useEffect(() => saveSetting('dequanswap.growthTriggerPct', String(growthTriggerPct)), [growthTriggerPct])

  useEffect(() => {
    savePaperState(paper)
  }, [paper])

  useEffect(() => {
    // Hard gate: free tier cannot be in live mode.
    if (!gates.allowLiveTrading && tradeMode === 'live') {
      setTradeMode('paper')
    }
  }, [gates.allowLiveTrading, tradeMode])

  useEffect(() => {
    localStorage.setItem('dequanswap.watchedTokens', JSON.stringify(watched))
  }, [watched])

  const refreshBalances = useCallback(async () => {
    if (!publicKey) {
      setSolBalanceLamports(null)
      setTokenBalance(null)
      return
    }

    const [solLamports, tok] = await Promise.all([
      getSolBalanceLamports(connection, publicKey),
      (async () => {
        try {
          if (!tokenMint.trim()) return null
          const mint = new PublicKey(tokenMint.trim())
          return await getTokenBalanceBaseUnits(connection, publicKey, mint)
        } catch {
          return null
        }
      })(),
    ])

    setSolBalanceLamports(solLamports)
    setTokenBalance(tok)
  }, [connection, publicKey, tokenMint])

  useEffect(() => {
    void refreshBalances()
  }, [refreshBalances])

  const connectTradingApi = useCallback(async () => {
    setError('')
    setTxSig('')
    setStep('connecting')

    try {
      wsRef.current?.close()
      const ws = new TradingWs({
        url: wsUrl,
        apiKey: apiKey.trim() || undefined,
        authToken: authToken.trim() || undefined,
      })
      wsRef.current = ws
      await ws.connect()
      setWsStatus('connected')
      setStep('idle')
    } catch (e) {
      setWsStatus('disconnected')
      setStep('idle')
      setError(e instanceof Error ? e.message : 'Failed to connect Trading API')
    }
  }, [apiKey, authToken, wsUrl])

  useEffect(() => {
    void connectTradingApi()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const validateMint = useCallback(() => {
    const mintStr = tokenMint.trim()
    if (!mintStr) throw new Error('Token mint is required')
    return new PublicKey(mintStr)
  }, [tokenMint])

  const ensureWs = useCallback(async () => {
    if (!wsRef.current) {
      wsRef.current = new TradingWs({
        url: wsUrl,
        apiKey: apiKey.trim() || undefined,
        authToken: authToken.trim() || undefined,
      })
    }
    if (!wsRef.current.isOpen) {
      await wsRef.current.connect()
      setWsStatus('connected')
    }
    return wsRef.current
  }, [apiKey, authToken, wsUrl])

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
      return [{ mint: mintStr, addedAt: Date.now() }, ...prev]
    })
    setWatchMintInput('')
  }, [gates.maxWatchedTokens, watchMintInput])

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

      setWatched((prev) => {
        if (prev.find((t) => t.mint === m)) return prev
        if (prev.length >= gates.maxWatchedTokens) {
          setError(`Watchlist limit reached for tier (${gates.maxWatchedTokens})`)
          return prev
        }
        return [{ mint: m, addedAt: Date.now() }, ...prev]
      })
    },
    [gates.maxWatchedTokens],
  )

  const fetchDequanwFeed = useCallback(async () => {
    setFeedError('')
    const base = dequanwDashBase.trim().replace(/\/$/, '')
    if (!base) return

    const headers: Record<string, string> = {}
    if (apiKey.trim()) headers['x-api-key'] = apiKey.trim()

    const feedUrl = `${base}/feed?limit=30`
    const watchingUrl = `${base}/watching?limit=30`

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

    const out: FeedToken[] = []
    const pushRow = (mint: string, meta: Partial<FeedToken>) => {
      if (!mint) return
      if (out.find((x) => x.mint === mint)) return
      out.push({ mint, source: 'dequanw', ...meta })
    }

    // Currently Watching
    for (const r of watchingJson.items || []) {
      const mint = r.tokenAddress || ''
      const startedAt = (r.startTime ?? r.detectionTime ?? undefined) || undefined
      const detectedMc = (r.entryMarketCap ?? r.latestMarketCap ?? undefined) || undefined
      pushRow(mint, {
        name: r.tokenName || undefined,
        symbol: r.tokenSymbol || undefined,
        startedAt: typeof startedAt === 'number' ? startedAt : undefined,
        detectedMc: typeof detectedMc === 'number' ? detectedMc : undefined,
      })
    }

    // Recent Evaluations
    for (const e of feedJson.items || []) {
      const mint = e.tokenAddress || ''
      const detectedMc = (e.entryMC ?? e.currentMC ?? undefined) || undefined
      pushRow(mint, {
        name: e.tokenName || undefined,
        symbol: e.tokenSymbol || undefined,
        startedAt: typeof e.timestamp === 'number' ? e.timestamp : undefined,
        detectedMc: typeof detectedMc === 'number' ? detectedMc : undefined,
      })
    }

    // Keep newest/active up top
    out.sort((a, b) => {
      const aa = a.startedAt ?? 0
      const bb = b.startedAt ?? 0
      return bb - aa
    })

    setFeed(out.slice(0, 30))
  }, [apiKey, dequanwDashBase])

  const removeWatchedToken = useCallback((mint: string) => {
    setWatched((prev) => prev.filter((t) => t.mint !== mint))
  }, [])

  const pollQuotes = useCallback(async () => {
    const quoteUserPubkey = publicKey?.toBase58() || READONLY_PUBKEY

    const watchedMints = watched.slice(0, gates.maxWatchedTokens).map((x) => x.mint)
    const feedMints = feed.slice(0, 12).map((x) => x.mint)
    const mints = Array.from(new Set([...watchedMints, ...feedMints]))
    if (!mints.length) return

    let ws: TradingWs
    try {
      ws = await ensureWs()
    } catch {
      return
    }

    const amountInLamports = toLamports(Number(amountSol))
    if (amountInLamports <= 0) return

    // Sequential polling keeps traffic predictable.
    for (const mint of mints) {
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
        const priceProxy = Number(priceProxyScaled) / Number(PRICE_PROXY_SCALE)

        setWatched((prev) =>
          prev.map((x) => {
            if (x.mint !== mint) return x
            const baseScaled = x.basePriceProxyScaled ? bigintFromString(x.basePriceProxyScaled) : priceProxyScaled
            const base = Number(baseScaled) / Number(PRICE_PROXY_SCALE)
            const growth = base > 0 ? ((priceProxy - base) / base) * 100 : 0
            return {
              ...x,
              error: undefined,
              basePriceProxyScaled: (x.basePriceProxyScaled ?? baseScaled.toString()),
              lastPriceProxyScaled: priceProxyScaled.toString(),
              basePriceProxy: base,
              lastPriceProxy: priceProxy,
              growthPct: growth,
              lastUpdatedAt: Date.now(),
            }
          }),
        )

        setFeed((prev) =>
          prev.map((x) => {
            if (x.mint !== mint) return x
            const baseScaled = x.basePriceProxyScaled ? bigintFromString(x.basePriceProxyScaled) : priceProxyScaled
            const base = Number(baseScaled) / Number(PRICE_PROXY_SCALE)
            const growth = base > 0 ? ((priceProxy - base) / base) * 100 : 0
            return {
              ...x,
              error: undefined,
              basePriceProxyScaled: (x.basePriceProxyScaled ?? baseScaled.toString()),
              lastPriceProxyScaled: priceProxyScaled.toString(),
              growthPct: growth,
              lastUpdatedAt: Date.now(),
            }
          }),
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Quote failed'
        setWatched((prev) =>
          prev.map((x) => (x.mint === mint ? { ...x, error: msg, lastUpdatedAt: Date.now() } : x)),
        )
        setFeed((prev) => prev.map((x) => (x.mint === mint ? { ...x, error: msg, lastUpdatedAt: Date.now() } : x)))
      }
    }
  }, [amountSol, ensureWs, feed, gates.maxWatchedTokens, publicKey, slippageBps, watched])

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

  const getWatchedPriceProxyScaled = useCallback(
    async (mint: string): Promise<bigint> => {
      const w = watched.find((x) => x.mint === mint)
      if (w?.lastPriceProxyScaled) return bigintFromString(w.lastPriceProxyScaled)

      if (!publicKey) throw new Error('Connect wallet first')
      const ws = await ensureWs()
      const amountInLamports = toLamports(Number(amountSol))
      if (amountInLamports <= 0) throw new Error('Enter a valid SOL amount')

      const quote = await ws.request<QuoteResult>(
        {
          type: 'quote',
          params: {
            userPubkey: publicKey.toBase58(),
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
      return computePriceProxyScaled(BigInt(quote.data.amountIn), BigInt(quote.data.amountOut))
    },
    [amountSol, ensureWs, publicKey, slippageBps, watched],
  )

  const paperBuyMint = useCallback(
    async (mint: string) => {
      setError('')
      setTxSig('')

      if (!publicKey) return setError('Connect wallet first')

      try {
        const sol = Number(amountSol)
        if (!Number.isFinite(sol) || sol <= 0) throw new Error('Enter a valid SOL amount')
        const amountInLamports = toLamports(sol)

        const ws = await ensureWs()
        setStep('quoting')
        const quote = await ws.request<QuoteResult>(
          {
            type: 'quote',
            params: {
              userPubkey: publicKey.toBase58(),
              inputMint: SOL_MINT,
              outputMint: mint,
              amountIn: amountInLamports.toString(),
              slippageBps: clamp(slippageBps, 0, 50_000),
            },
          },
          (m): m is QuoteResult => m.type === 'quote_result',
        )
        if (!quote.success || !quote.data?.amountOut || !quote.data?.amountIn) throw new Error('Quote failed')

        const out = BigInt(quote.data.amountOut)
        const inLamports = BigInt(quote.data.amountIn)
        const priceProxyScaled = computePriceProxyScaled(inLamports, out)

        setPaper((prev) => {
          const solBal = bigintFromString(prev.solLamports)
          if (solBal < inLamports) throw new Error('Paper wallet: insufficient SOL')

          const pos: PaperPosition = {
            mint,
            openedAt: Date.now(),
            amountInLamports: inLamports.toString(),
            tokenAmountBaseUnits: out.toString(),
            entryPriceProxyScaled: priceProxyScaled.toString(),
            lastPriceProxyScaled: priceProxyScaled.toString(),
          }

          const trade: PaperTrade = {
            id: newTradeId(),
            ts: Date.now(),
            side: 'buy',
            mint,
            solLamportsDelta: (-inLamports).toString(),
            tokenBaseUnitsDelta: out.toString(),
          }

          return {
            solLamports: (solBal - inLamports).toString(),
            positions: [pos, ...prev.positions],
            trades: clampTrades([trade, ...prev.trades]),
          }
        })

        setStep('done')
        setTimeout(() => setStep('idle'), 500)
      } catch (e) {
        setStep('idle')
        setError(e instanceof Error ? e.message : 'Paper buy failed')
      }
    },
    [amountSol, ensureWs, publicKey, slippageBps],
  )

  const paperSellMint = useCallback(
    async (mint: string, pct: 25 | 50 | 100) => {
      setError('')
      setTxSig('')

      try {
        const priceProxyScaled = await getWatchedPriceProxyScaled(mint)
        setPaper((prev) => {
          const idx = prev.positions.findIndex((p) => p.mint === mint)
          if (idx === -1) throw new Error('Paper wallet: no position')
          const pos = prev.positions[idx]

          const tokenAmt = bigintFromString(pos.tokenAmountBaseUnits)
          if (tokenAmt <= 0n) throw new Error('Paper wallet: empty position')

          const sellAmt = (tokenAmt * BigInt(pct)) / 100n
          if (sellAmt <= 0n) throw new Error('Sell amount too small')

          const solDelta = (sellAmt * priceProxyScaled) / PRICE_PROXY_SCALE

          const newTokenAmt = tokenAmt - sellAmt
          const newPos: PaperPosition | null =
            newTokenAmt > 0n
              ? {
                  ...pos,
                  tokenAmountBaseUnits: newTokenAmt.toString(),
                  lastPriceProxyScaled: priceProxyScaled.toString(),
                }
              : null

          const nextPositions = [...prev.positions]
          if (newPos) nextPositions[idx] = newPos
          else nextPositions.splice(idx, 1)

          const solBal = bigintFromString(prev.solLamports)

          const trade: PaperTrade = {
            id: newTradeId(),
            ts: Date.now(),
            side: 'sell',
            mint,
            pct,
            solLamportsDelta: solDelta.toString(),
            tokenBaseUnitsDelta: (-sellAmt).toString(),
          }

          return {
            solLamports: (solBal + solDelta).toString(),
            positions: nextPositions,
            trades: clampTrades([trade, ...prev.trades]),
          }
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Paper sell failed')
      }
    },
    [getWatchedPriceProxyScaled],
  )

  useEffect(() => {
    if (uiMode !== 'minimalist') return
    const id = setInterval(() => {
      void pollQuotes()
    }, gates.quotePollMs)
    return () => clearInterval(id)
  }, [gates.quotePollMs, pollQuotes, uiMode])

  useEffect(() => {
    if (uiMode !== 'minimalist') return
    void fetchDequanwFeed()
    const id = setInterval(() => {
      void fetchDequanwFeed()
    }, 5000)
    return () => clearInterval(id)
  }, [fetchDequanwFeed, uiMode])

  const buy = useCallback(async () => {
    setError('')
    setTxSig('')

    if (tradeMode === 'paper') {
      const mintStr = tokenMint.trim()
      if (!mintStr) return setError('Token mint is required')
      return void paperBuyMint(mintStr)
    }
    if (!publicKey) return setError('Connect wallet first')
    if (!signTransaction) return setError('Wallet does not support transaction signing')
    try {
      const mint = validateMint()
      const sol = Number(amountSol)
      if (!Number.isFinite(sol) || sol <= 0) throw new Error('Enter a valid SOL amount')

      const lamports = toLamports(sol)
      const ws = await ensureWs()

      setStep('quoting')
      const quote = await ws.request<QuoteResult>(
        {
          type: 'quote',
          params: {
            userPubkey: publicKey.toBase58(),
            inputMint: SOL_MINT,
            outputMint: mint.toBase58(),
            amountIn: lamports.toString(),
            slippageBps: clamp(slippageBps, 0, 50_000),
          },
        },
        (m): m is QuoteResult => m.type === 'quote_result',
      )

      if (!quote.success || !quote.data?.route) throw new Error('Quote failed')

      const serializedQuote = quote.data.route.serializedQuote
      if (!serializedQuote) {
        throw new Error('Quote missing route.serializedQuote (server must include it for build_swap_tx)')
      }

      setStep('building')
      const built = await ws.request<BuildSwapTxResult>(
        {
          type: 'build_swap_tx',
          params: {
            userPubkey: publicKey.toBase58(),
            quote: {
              provider: 'jupiter',
              serializedQuote,
            },
          },
        },
        (m): m is BuildSwapTxResult => m.type === 'build_swap_tx_result',
      )

      if (!built.success || !built.data) throw new Error('Failed to build transaction')
      const txBase64 = built.data.transactionBase64 || built.data.swapTransaction
      if (!txBase64) throw new Error('build_swap_tx_result missing transactionBase64')

      setStep('signing')
      const unsignedTx = deserializeTx(txBase64)
      const signedTx = await signTransaction(unsignedTx)

      setStep('submitting')
      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      })
      setTxSig(signature)

      setStep('confirming')
      await connection.confirmTransaction(signature, 'confirmed')

      setStep('done')
      await refreshBalances()
      setTimeout(() => setStep('idle'), 700)
    } catch (e) {
      setStep('idle')
      setError(e instanceof Error ? e.message : 'Buy failed')
    }
  }, [amountSol, connection, ensureWs, paperBuyMint, publicKey, refreshBalances, signTransaction, slippageBps, tokenMint, tradeMode, validateMint])

  const sellPercent = useCallback(
    async (pct: 25 | 50 | 100) => {
      setError('')
      setTxSig('')

      if (tradeMode === 'paper') {
        const mintStr = tokenMint.trim()
        if (!mintStr) return setError('Token mint is required')
        return void paperSellMint(mintStr, pct)
      }
      if (!publicKey) return setError('Connect wallet first')
      if (!signTransaction) return setError('Wallet does not support transaction signing')
      try {
        const mint = validateMint()
        const ws = await ensureWs()

        const bal = await getTokenBalanceBaseUnits(connection, publicKey, mint)
        if (!bal || bal.amount <= 0n) throw new Error('No token balance to sell')

        const amountIn = (bal.amount * BigInt(pct)) / 100n
        if (amountIn <= 0n) throw new Error('Sell amount too small')
        setTokenBalance(bal)

        setStep('quoting')
        const quote = await ws.request<QuoteResult>(
          {
            type: 'quote',
            params: {
              userPubkey: publicKey.toBase58(),
              inputMint: mint.toBase58(),
              outputMint: SOL_MINT,
              amountIn: amountIn.toString(),
              slippageBps: clamp(slippageBps, 0, 50_000),
            },
          },
          (m): m is QuoteResult => m.type === 'quote_result',
        )

        if (!quote.success || !quote.data?.route) throw new Error('Quote failed')
        const serializedQuote = quote.data.route.serializedQuote
        if (!serializedQuote) {
          throw new Error('Quote missing route.serializedQuote (server must include it for build_swap_tx)')
        }

        setStep('building')
        const built = await ws.request<BuildSwapTxResult>(
          {
            type: 'build_swap_tx',
            params: {
              userPubkey: publicKey.toBase58(),
              quote: {
                provider: 'jupiter',
                serializedQuote,
              },
            },
          },
          (m): m is BuildSwapTxResult => m.type === 'build_swap_tx_result',
        )

        if (!built.success || !built.data) throw new Error('Failed to build transaction')
        const txBase64 = built.data.transactionBase64 || built.data.swapTransaction
        if (!txBase64) throw new Error('build_swap_tx_result missing transactionBase64')

        setStep('signing')
        const unsignedTx = deserializeTx(txBase64)
        const signedTx = await signTransaction(unsignedTx)

        setStep('submitting')
        const signature = await connection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        })
        setTxSig(signature)

        setStep('confirming')
        await connection.confirmTransaction(signature, 'confirmed')

        setStep('done')
        await refreshBalances()
        setTimeout(() => setStep('idle'), 700)
      } catch (e) {
        setStep('idle')
        setError(e instanceof Error ? e.message : 'Sell failed')
      }
    },
    [connection, ensureWs, paperSellMint, publicKey, refreshBalances, signTransaction, slippageBps, tokenMint, tradeMode, validateMint],
  )

  const connectedPk = useMemo(() => publicKey?.toBase58() || '', [publicKey])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brandBlock">
          <div className="brand">dequanSnipe</div>
          <div className="brandSub">Minimal sniper dashboard</div>
        </div>
        <div className="actions">
          <div className="tierControls">
            <select
              className="select"
              value={tier}
              onChange={(e) => setTier(e.target.value as ProductTier)}
              aria-label="Product tier"
            >
              <option value="free">Free</option>
              <option value="minimalist">Minimalist</option>
              <option value="pro">Pro</option>
              <option value="elite">Elite</option>
            </select>
            <div className="seg">
              <button
                className={tradeMode === 'paper' ? 'segBtn segBtnActive' : 'segBtn'}
                onClick={() => setTradeMode('paper')}
              >
                Paper
              </button>
              <button
                className={tradeMode === 'live' ? 'segBtn segBtnActive' : 'segBtn'}
                onClick={() => {
                  if (!gates.allowLiveTrading) {
                    setError('Live trading is locked on Free tier')
                    setTradeMode('paper')
                    return
                  }
                  setTradeMode('live')
                }}
              >
                Live
              </button>
            </div>
          </div>
          <WalletMultiButton className="walletBtn" />
        </div>
      </header>

      <div className="tabs">
        <div className="tabsLeft">
          <button className={uiMode === 'minimalist' ? 'tab tabActive' : 'tab'} onClick={() => setUiMode('minimalist')}>
            Minimalist
          </button>
          <button className={uiMode === 'advanced' ? 'tab tabActive' : 'tab'} onClick={() => setUiMode('advanced')}>
            Advanced
          </button>
        </div>
        <div className="tabsRight">
          <span className={wsStatus === 'connected' ? 'dot dotOk' : 'dot dotBad'} />
          <span className="muted">Engine</span>
        </div>
      </div>

      {uiMode === 'minimalist' ? (
        <main className="gridSnipe">
          <section className="panel">
            <div className="panelHead">
              <div className="panelTitle">Live Feed</div>
              <div className="panelHint">Auto-refreshing tokens from dequanW strategy</div>
            </div>

            {feedError ? <div className="error" style={{ marginBottom: '12px' }}>Feed: {feedError}</div> : null}

            <div className="tokenGrid">
              {feed.slice(0, 12).map((t) => {
                // Dynamic heat mapping based on growth %
                const growth = t.growthPct ?? 0
                const heatClass = growth < 10 ? 'token-card-cool' : growth > 50 ? 'token-card-hot' : growth > 25 ? 'token-card-warm' : ''
                
                return (
                  <div key={t.mint} className={`tokenCard ${heatClass}`}>
                    <div className="tokenTop">
                      <div className="tokenName">{t.name || shortPk(t.mint)}{t.symbol ? <span className="tokenSym">({t.symbol})</span> : null}</div>
                      <div className={t.growthPct !== undefined && t.growthPct > 0 ? 'pos' : t.growthPct !== undefined && t.growthPct < 0 ? 'neg' : 'muted'}>
                        {t.growthPct === undefined ? '—' : `${t.growthPct.toFixed(2)}%`}
                      </div>
                    </div>
                    <div className="tokenMeta">
                      <span className="muted mono">{shortPk(t.mint)}</span>
                      <span className="muted">{t.startedAt ? `${formatAge(Date.now() - t.startedAt)} ago` : ''}</span>
                      <span className="muted">{t.detectedMc ? `$${Math.round(t.detectedMc).toLocaleString()}` : ''}</span>
                    </div>
                    <div className="tokenActions">
                      <button
                        className="ghost"
                        onClick={() => {
                          setTokenMint(t.mint)
                          void refreshBalances()
                        }}
                      >
                        Load
                      </button>
                      <button className="ghost" onClick={() => watchMint(t.mint)}>
                        Watch
                      </button>
                      <button
                        className="primary"
                        disabled={step !== 'idle'}
                        onClick={() => {
                          setTokenMint(t.mint)
                          // Add snipe trigger animation to main container
                          const mainContainer = document.querySelector('.gridSnipe')
                          mainContainer?.classList.add('snipe-trigger')
                          setTimeout(() => mainContainer?.classList.remove('snipe-trigger'), 200)
                          void buy()
                        }}
                      >
                        Snipe
                      </button>
                    </div>
                    {t.error ? <div className="note">Quote: {t.error}</div> : null}
                  </div>
                )
              })}
              {!feed.length ? <div className="muted">No live tokens yet (feed empty).</div> : null}
            </div>

            <div className="row">
              <label>Trigger</label>
              <div className="inline">
                <input
                  value={String(growthTriggerPct)}
                  onChange={(e) => setGrowthTriggerPct(Number(e.target.value))}
                  inputMode="decimal"
                  placeholder="20"
                />
                <div className="pill">Triggered: {triggeredCount}</div>
                <div className="quick">
                  <button className={growthTriggerPct === 20 ? 'pillBtn pillBtnActive' : 'pillBtn'} onClick={() => setGrowthTriggerPct(20)}>
                    20%
                  </button>
                  <button className={growthTriggerPct === 40 ? 'pillBtn pillBtnActive' : 'pillBtn'} onClick={() => setGrowthTriggerPct(40)}>
                    40%
                  </button>
                  <button className={growthTriggerPct === 80 ? 'pillBtn pillBtnActive' : 'pillBtn'} onClick={() => setGrowthTriggerPct(80)}>
                    80%
                  </button>
                </div>
              </div>
              <div className="note">Highlights tokens over the trigger (session counter).</div>
            </div>

            <div className="row">
              <label>Add token</label>
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
                Uses swap quotes as a price proxy. Tier limit: {watched.length}/{gates.maxWatchedTokens}. Poll: {Math.round(
                  gates.quotePollMs / 1000,
                )}
                s.
              </div>
            </div>

            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Age</th>
                    <th>Growth</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {watched.map((t) => (
                    <tr key={t.mint} className={t.growthPct !== undefined && t.growthPct >= growthTriggerPct ? 'rowHot' : ''}>
                      <td className="mono">{shortPk(t.mint)}</td>
                      <td className="muted">{formatAge(Date.now() - t.addedAt)}</td>
                      <td className={t.growthPct && t.growthPct > 0 ? 'pos' : t.growthPct && t.growthPct < 0 ? 'neg' : ''}>
                        {t.growthPct === undefined ? '—' : `${t.growthPct.toFixed(2)}%`}
                        {t.growthPct !== undefined && t.growthPct >= growthTriggerPct ? <span className="badge">ALERT</span> : null}
                      </td>
                      <td className="muted">
                        {t.error
                          ? `Error: ${t.error}`
                          : t.lastUpdatedAt
                            ? `Updated ${formatAge(Date.now() - t.lastUpdatedAt)} ago`
                            : 'Waiting…'}
                      </td>
                      <td>
                        <div className="tableBtns">
                          <button
                            className="ghost"
                            onClick={() => {
                              setTokenMint(t.mint)
                              void refreshBalances()
                            }}
                          >
                            Load
                          </button>
                          <button
                            className="primary"
                            disabled={!canTrade || step !== 'idle'}
                            onClick={() => {
                              setTokenMint(t.mint)
                              void buy()
                            }}
                          >
                            Buy
                          </button>
                          <button
                            className="secondary"
                            disabled={!canTrade || step !== 'idle'}
                            onClick={() => {
                              setTokenMint(t.mint)
                              void sellPercent(100)
                            }}
                          >
                            Sell
                          </button>
                          <button className="ghost" onClick={() => removeWatchedToken(t.mint)}>
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!watched.length ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        Add a token mint to start tracking growth.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="sideStack">
            <section className="panel">
              <div className="panelHead">
                <div className="panelTitle">Snipe</div>
                <div className="panelHint">Pick token, size, slippage, fire</div>
              </div>

              <div className="row">
                <label>Token</label>
                <input
                  value={tokenMint}
                  onChange={(e) => setTokenMint(e.target.value)}
                  placeholder="Paste token mint… (or click Load from Watch)"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>

              <div className="row">
                <label>Size</label>
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
                {tradeMode === 'paper' ? <div className="note">Paper mode: trades affect your paper wallet only.</div> : null}
              </div>

              <div className="row">
                <label>Slippage</label>
                <div className="inline">
                  <div className="quick">
                    <button
                      className={slippageBps === 100 ? 'pillBtn pillBtnActive' : 'pillBtn'}
                      onClick={() => setSlippageBps(100)}
                    >
                      1%
                    </button>
                    <button
                      className={slippageBps === 300 ? 'pillBtn pillBtnActive' : 'pillBtn'}
                      onClick={() => setSlippageBps(300)}
                    >
                      3%
                    </button>
                    <button
                      className={slippageBps === 500 ? 'pillBtn pillBtnActive' : 'pillBtn'}
                      onClick={() => setSlippageBps(500)}
                    >
                      5%
                    </button>
                    <button
                      className={slippageBps === 1000 ? 'pillBtn pillBtnActive' : 'pillBtn'}
                      onClick={() => setSlippageBps(1000)}
                    >
                      10%
                    </button>
                  </div>
                  <div className="pill">{(slippageBps / 100).toFixed(2)}%</div>
                </div>
              </div>

              <div className="ctaRow">
                <button className="primary" disabled={!canTrade || step !== 'idle'} onClick={buy}>
                  Buy
                </button>
                <button className="secondary" disabled={!canTrade || step !== 'idle'} onClick={() => void sellPercent(100)}>
                  Sell
                </button>
                <button className="ghost" onClick={() => void refreshBalances()} disabled={!publicKey}>
                  Refresh
                </button>
              </div>

              <div className="statusCompact">
                <div className="statusGrid">
                  <div className="kpi">
                    <div className="kpiLabel">Wallet</div>
                    <div className="kpiValue">{connectedPk ? shortPk(connectedPk) : 'Not connected'}</div>
                  </div>
                  <div className="kpi">
                    <div className="kpiLabel">SOL</div>
                    <div className="kpiValue">{solBalanceLamports === null ? '—' : `${formatSol(solBalanceLamports)} SOL`}</div>
                  </div>
                  <div className="kpi">
                    <div className="kpiLabel">Token</div>
                    <div className="kpiValue">
                      {tokenBalance
                        ? `${baseUnitsToUi(tokenBalance.amount, tokenBalance.decimals).toFixed(6)} (${tokenBalance.decimals}dp)`
                        : '—'}
                    </div>
                  </div>
                  <div className="kpi">
                    <div className="kpiLabel">API</div>
                    <div className="kpiValue">{wsStatus}</div>
                  </div>
                </div>

                {txSig ? (
                  <div className="statusLine">
                    <span className="muted">Tx</span>
                    <a href={`https://solscan.io/tx/${txSig}`} target="_blank" rel="noreferrer">
                      {shortPk(txSig)}
                    </a>
                  </div>
                ) : null}
                {error ? <div className="error">{error}</div> : null}

                <details className="details">
                  <summary className="summary">Diagnostics / Settings</summary>
                  <div className="row">
                    <label>Trading API WS URL</label>
                    <input value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} spellCheck={false} />
                  </div>
                  <div className="row">
                    <label>API key (dev only)</label>
                    <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} spellCheck={false} />
                  </div>
                  <div className="row">
                    <label>Auth token (preferred)</label>
                    <input value={authToken} onChange={(e) => setAuthToken(e.target.value)} spellCheck={false} />
                  </div>
                  <div className="ctaRow">
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

                  <div className="note">
                    MVP is non-custodial: this UI never receives private keys. The Trading API must include
                    <span className="mono"> route.serializedQuote</span> in <span className="mono">quote_result</span>.
                  </div>
                </details>
              </div>
            </section>

            <section className="panel">
              <div className="panelHead">
                <div className="panelTitle">Positions</div>
                <div className="panelHint">Paper portfolio + quick exits</div>
              </div>

              <div className="statusCompact">
                <div className="statusGrid">
                  <div className="kpi">
                    <div className="kpiLabel">Paper SOL</div>
                    <div className="kpiValue">{formatSol(bigintFromString(paper.solLamports), 4)} SOL</div>
                  </div>
                  <div className="kpi">
                    <div className="kpiLabel">Positions</div>
                    <div className="kpiValue">{paper.positions.length}</div>
                  </div>
                </div>
              </div>

              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Token</th>
                      <th>PnL</th>
                      <th>Value</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paper.positions.map((p) => {
                      const current = watched.find((w) => w.mint === p.mint)?.lastPriceProxyScaled
                      const curScaled = current ? bigintFromString(current) : bigintFromString(p.lastPriceProxyScaled || '0')
                      const pnl = curScaled > 0n ? positionPnlPct(p, curScaled) : undefined
                      const valueLamports = curScaled > 0n ? positionValueLamports(p, curScaled) : 0n
                      return (
                        <tr key={p.mint}>
                          <td className="mono">{shortPk(p.mint)}</td>
                          <td className={pnl !== undefined && pnl > 0 ? 'pos' : pnl !== undefined && pnl < 0 ? 'neg' : ''}>
                            {pnl === undefined ? '—' : `${pnl.toFixed(2)}%`}
                          </td>
                          <td className="muted">{curScaled > 0n ? `${formatSol(valueLamports, 4)} SOL` : '—'}</td>
                          <td>
                            <div className="tableBtns">
                              <button className="ghost" onClick={() => void paperSellMint(p.mint, 25)}>
                                25%
                              </button>
                              <button className="ghost" onClick={() => void paperSellMint(p.mint, 50)}>
                                50%
                              </button>
                              <button className="secondary" onClick={() => void paperSellMint(p.mint, 100)}>
                                100%
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {!paper.positions.length ? (
                      <tr>
                        <td colSpan={4} className="muted">
                          No paper positions yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <details className="details">
                <summary className="summary">Recent trades (last {paper.trades.length})</summary>
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Side</th>
                        <th>Token</th>
                        <th>Δ SOL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paper.trades.map((t) => {
                        const sol = bigintFromString(t.solLamportsDelta)
                        const solUi = Number(sol) / 1_000_000_000
                        return (
                          <tr key={t.id}>
                            <td className="muted">{new Date(t.ts).toLocaleTimeString()}</td>
                            <td className={t.side === 'buy' ? 'neg' : 'pos'}>{t.side.toUpperCase()}</td>
                            <td className="mono">{shortPk(t.mint)}</td>
                            <td className={solUi >= 0 ? 'pos' : 'neg'}>
                              {solUi >= 0 ? '+' : ''}
                              {solUi.toFixed(4)}
                            </td>
                          </tr>
                        )
                      })}
                      {!paper.trades.length ? (
                        <tr>
                          <td colSpan={4} className="muted">
                            No paper trades yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          </aside>
        </main>
      ) : (
        <main className="grid">
          <section className="panel">
            <div className="panelTitle">Trade</div>

          <div className="row">
            <label>Token mint</label>
            <input
              value={tokenMint}
              onChange={(e) => setTokenMint(e.target.value)}
              placeholder="Paste token mint…"
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
                <button onClick={() => setAmountSol('0.01')}>0.01</button>
                <button onClick={() => setAmountSol('0.05')}>0.05</button>
                <button onClick={() => setAmountSol('0.1')}>0.1</button>
              </div>
            </div>
          </div>

          <div className="row">
            <label>Slippage</label>
            <div className="inline">
              <input
                type="range"
                min={0}
                max={50000}
                step={50}
                value={slippageBps}
                onChange={(e) => setSlippageBps(Number(e.target.value))}
              />
              <div className="pill">{(slippageBps / 100).toFixed(2)}%</div>
            </div>
          </div>

          <div className="ctaRow">
            <button className="primary" disabled={!canTrade || step !== 'idle' || tradeMode === 'paper'} onClick={buy}>
              Buy
            </button>
            <button
              className="secondary"
              disabled={!canTrade || step !== 'idle' || tradeMode === 'paper'}
              onClick={() => void sellPercent(100)}
            >
              Sell 100%
            </button>
          </div>

          <div className="ctaRow">
            <button className="ghost" disabled={!canTrade || step !== 'idle' || tradeMode === 'paper'} onClick={() => void sellPercent(25)}>
              Sell 25%
            </button>
            <button className="ghost" disabled={!canTrade || step !== 'idle' || tradeMode === 'paper'} onClick={() => void sellPercent(50)}>
              Sell 50%
            </button>
            <button className="ghost" onClick={() => void refreshBalances()} disabled={!publicKey}>
              Refresh
            </button>
          </div>

          <div className="status">
            <div className="statusLine">
              <span className="muted">Wallet</span>
              <span>{connectedPk ? shortPk(connectedPk) : 'Not connected'}</span>
            </div>
            <div className="statusLine">
              <span className="muted">SOL</span>
              <span>{solBalanceLamports === null ? '—' : `${formatSol(solBalanceLamports)} SOL`}</span>
            </div>
            <div className="statusLine">
              <span className="muted">Token</span>
              <span>
                {tokenBalance
                  ? `${baseUnitsToUi(tokenBalance.amount, tokenBalance.decimals).toFixed(6)} (${tokenBalance.decimals}dp)`
                  : '—'}
              </span>
            </div>
            <div className="statusLine">
              <span className="muted">API</span>
              <span>{wsStatus}</span>
            </div>
            <div className="statusLine">
              <span className="muted">Step</span>
              <span>{step}</span>
            </div>
            {txSig ? (
              <div className="statusLine">
                <span className="muted">Tx</span>
                <a href={`https://solscan.io/tx/${txSig}`} target="_blank" rel="noreferrer">
                  {shortPk(txSig)}
                </a>
              </div>
            ) : null}
            {error ? <div className="error">{error}</div> : null}
          </div>
        </section>

        <section className="panel">
          <div className="panelTitle">Settings</div>

          <div className="row">
            <label>Trading API WS URL</label>
            <input value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} spellCheck={false} />
          </div>
          <div className="row">
            <label>API key (dev only)</label>
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} spellCheck={false} />
          </div>
          <div className="row">
            <label>Auth token (preferred)</label>
            <input value={authToken} onChange={(e) => setAuthToken(e.target.value)} spellCheck={false} />
          </div>
          <div className="ctaRow">
            <button className="primary" onClick={connectTradingApi} disabled={step !== 'idle'}>
              Connect Trading API
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

          <div className="note">
            MVP is non-custodial: this UI never receives private keys. The Trading API must include
            <span className="mono"> route.serializedQuote</span> in <span className="mono">quote_result</span>.
          </div>
        </section>
      </main>
      )}
    </div>
  )
}

export default App
