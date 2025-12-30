import './App.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { PublicKey } from '@solana/web3.js'
import { TradingWs } from './lib/tradingWs'
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

function loadSetting(key: string, fallback: string) {
  const v = localStorage.getItem(key)
  return v && v.trim().length > 0 ? v : fallback
}

function saveSetting(key: string, value: string) {
  localStorage.setItem(key, value)
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

  const wsRef = useRef<TradingWs | null>(null)
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connected'>('disconnected')

  const [tokenMint, setTokenMint] = useState('')
  const [amountSol, setAmountSol] = useState('0.01')
  const [slippageBps, setSlippageBps] = useState(4000)

  const [step, setStep] = useState<UiStep>('idle')
  const [error, setError] = useState<string>('')
  const [txSig, setTxSig] = useState<string>('')

  const [solBalanceLamports, setSolBalanceLamports] = useState<number | null>(null)
  const [tokenBalance, setTokenBalance] = useState<{ amount: bigint; decimals: number } | null>(null)

  const canTrade = connected && publicKey && !!signTransaction

  useEffect(() => saveSetting('dequanswap.wsUrl', wsUrl), [wsUrl])
  useEffect(() => saveSetting('dequanswap.apiKey', apiKey), [apiKey])
  useEffect(() => saveSetting('dequanswap.authToken', authToken), [authToken])

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

  const buy = useCallback(async () => {
    setError('')
    setTxSig('')

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
  }, [amountSol, connection, ensureWs, publicKey, refreshBalances, signTransaction, slippageBps, validateMint])

  const sellPercent = useCallback(
    async (pct: 25 | 50 | 100) => {
      setError('')
      setTxSig('')

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
    [connection, ensureWs, publicKey, refreshBalances, signTransaction, slippageBps, validateMint],
  )

  const connectedPk = useMemo(() => publicKey?.toBase58() || '', [publicKey])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">dequanSwap</div>
        <div className="actions">
          <WalletMultiButton className="walletBtn" />
        </div>
      </header>

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
            <button className="primary" disabled={!canTrade || step !== 'idle'} onClick={buy}>
              Buy
            </button>
            <button className="secondary" disabled={!canTrade || step !== 'idle'} onClick={() => void sellPercent(100)}>
              Sell 100%
            </button>
          </div>

          <div className="ctaRow">
            <button className="ghost" disabled={!canTrade || step !== 'idle'} onClick={() => void sellPercent(25)}>
              Sell 25%
            </button>
            <button className="ghost" disabled={!canTrade || step !== 'idle'} onClick={() => void sellPercent(50)}>
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
    </div>
  )
}

export default App
