import React, { useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { isTokenRugged } from '../lib/rug'

interface TokenRowProps {
  token: {
    mint: string
    name?: string
    symbol?: string
    startedAt?: number
    detectedMc?: number
    mcEntry?: number
    mcCurrent?: number
    mcGrowthPct?: number
    isRugged?: boolean
    liquidityStatus?: 'active' | 'removed' | 'unknown'
    liquidityRemovedAt?: number
    liquidityRemovedSig?: string
    liquidityRemovedInstruction?: string
    liquidityRemovedReason?: string
    error?: string
  }
  onLoad: (mint: string) => void
  onWatch: (mint: string) => void
  onSnipe: (mint: string) => void
  disabled: boolean
}

const shortPk = (pk: string) => `${pk.slice(0, 4)}…${pk.slice(-4)}`

const formatAge = (ms: number) => {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  if (min < 60) return `${min}m ${remSec}s`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return `${hr}h ${remMin}m`
}

export const TokenRow: React.FC<TokenRowProps> = ({ token, onLoad, onWatch, onSnipe, disabled }) => {
  const hasGrowth = typeof token.mcGrowthPct === 'number' && Number.isFinite(token.mcGrowthPct)
  const growth = hasGrowth ? (token.mcGrowthPct as number) : 0
  const prevGrowthRef = useRef(growth)
  const rowRef = useRef<HTMLDivElement>(null)
  const [isHovered, setIsHovered] = React.useState(false)
  const [ruggedClickedButton, setRuggedClickedButton] = React.useState<'load' | 'watch' | 'snipe' | null>(null)
  
  const heatWidth = Math.min(Math.max(growth, 0), 100)
  const isHot = growth > 50
  const isWarm = growth > 25 && growth <= 50
  const isCool = growth < 10

  const accent = isHot
    ? 'rgba(248,81,73,0.95)'
    : isWarm
      ? 'rgba(234,179,8,0.95)'
      : isCool
        ? 'rgba(0,212,255,0.95)'
        : 'rgba(57,211,83,0.95)'

  const heatAccent = isHot
    ? 'rgba(248,81,73,0.22)'
    : isWarm
      ? 'rgba(234,179,8,0.18)'
      : isCool
        ? 'rgba(0,212,255,0.16)'
        : 'rgba(57,211,83,0.18)'

  const ageMs = token.startedAt ? Date.now() - token.startedAt : 0
  const isDead = ageMs > 5 * 60 * 1000
  const isStale = !isDead && ageMs > 60 * 1000

  const isRugged = isTokenRugged(token)
  const badgeLabel = isRugged ? 'RUGGED' : isHot ? 'HOT' : isWarm ? 'WARM' : isCool ? 'COOL' : 'TRACK'
  const badgeClass = isRugged
    ? 'tokenRowBadgeRugged'
    : isHot
      ? 'tokenRowBadgeHot'
      : isWarm
        ? 'tokenRowBadgeWarm'
        : isCool
          ? 'tokenRowBadgeCool'
          : 'tokenRowBadgeTrack'

  // Auto-remove rugged tokens from feed after 5 seconds
  useEffect(() => {
    if (isRugged) {
      const timer = setTimeout(() => {
        // Trigger exit animation by having parent remove this token
        // The parent will handle actual removal from feed state
        const row = rowRef.current
        if (row) {
          row.style.opacity = '0'
          row.style.transform = 'translateX(-100px)'
        }
      }, 5000)
      return () => clearTimeout(timer)
    }
  }, [isRugged])

  const formatUsd = (n: number) => {
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

  // Trigger kinetic feedback on growth changes
  useEffect(() => {
    if (!rowRef.current) return
    if (!hasGrowth) return
    
    const prevGrowth = prevGrowthRef.current
    const delta = growth - prevGrowth

    const thresholds = [25, 50, 100]
    const crossed = thresholds.some((t) => prevGrowth < t && growth >= t)
    
    // Level 1: Subtle update (Slow fade)
    if (delta > 0 && delta < 10) {
      rowRef.current.style.transition = 'background 1s'
      rowRef.current.style.backgroundColor = 'rgba(0, 255, 127, 0.05)'
      setTimeout(() => {
        if (rowRef.current) rowRef.current.style.backgroundColor = 'transparent'
      }, 1000)
    }

    // POP when growth crosses key thresholds
    if (crossed || delta >= 25) {
      const cls = growth >= 100 || delta >= 50 ? 'tokenRowPopBig' : 'tokenRowPop'
      rowRef.current.classList.remove('tokenRowPop', 'tokenRowPopBig')
      void rowRef.current.offsetWidth
      rowRef.current.classList.add(cls)
      setTimeout(() => {
        if (rowRef.current) rowRef.current.classList.remove('tokenRowPop', 'tokenRowPopBig')
      }, 420)
    }
    
    // Level 2: Violent Signal (The glitch)
    if (delta >= 10) {
      rowRef.current.classList.remove('row-critical-signal')
      void rowRef.current.offsetWidth // Trigger reflow to restart animation
      rowRef.current.classList.add('row-critical-signal')
      
      // Physical feedback: Subtle shake of the entire dashboard
      const dashboard = document.getElementById('minimalist-view')
      if (dashboard) {
        dashboard.classList.add('snipe-shake')
        setTimeout(() => dashboard.classList.remove('snipe-shake'), 200)
      }
      
      // Remove critical class after animation
      setTimeout(() => {
        if (rowRef.current) rowRef.current.classList.remove('row-critical-signal')
      }, 400)
    }
    
    prevGrowthRef.current = growth
  }, [growth, hasGrowth])

  return (
    <motion.div
      ref={rowRef}
      layout
      initial={{ opacity: 0, x: -100, scale: 0.8 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`token-row-container legible-text tokenRow ${isHot && !isRugged ? 'tokenRowHotRadiate' : ''} ${isStale ? 'tokenRowStale' : ''} ${isDead ? 'tokenRowDead' : ''}`}
      style={{
        borderLeft: `4px solid ${accent}`,
        boxShadow: isHot
          ? `0 0 22px rgba(248,81,73,0.28), 0 0 74px rgba(248,81,73,0.18), inset 0 0 18px rgba(248,81,73,0.09)`
          : isWarm
            ? `0 0 18px rgba(234,179,8,0.12)`
            : undefined,
      }}
    >
      {/* HEAT BAR BACKGROUND */}
      <div
        className="tokenRowHeat"
        style={{ width: `${heatWidth}%`, background: `linear-gradient(90deg, ${heatAccent}, transparent)` }}
      />

      {/* IDENTITY */}
      <div className="tokenRowIdentity">
        <div className="tokenRowSymbol">{token.symbol || token.name || shortPk(token.mint)}</div>
        <div className="tokenRowMeta">{token.startedAt ? `${formatAge(Date.now() - token.startedAt)} ago` : '—'} · {shortPk(token.mint)}</div>
      </div>

      {/* MC */}
      <div className="tokenRowMetric">
        <div className="tokenRowLabel">MC</div>
        <div className="tokenRowValue">{typeof token.mcCurrent === 'number' ? formatUsd(token.mcCurrent) : typeof token.detectedMc === 'number' ? formatUsd(token.detectedMc) : '—'}</div>
        <div className="tokenRowSub">{typeof token.mcEntry === 'number' ? `Entry ${formatUsd(token.mcEntry)}` : 'Entry —'}</div>
      </div>

      {/* MC GROWTH */}
      <div className="tokenRowMetric">
        <div className="tokenRowLabel">MC Δ</div>
        <div className="tokenRowValueRow">
          <div className="tokenRowValue" style={{ color: growth >= 0 ? 'var(--neon-green)' : 'var(--neon-red)' }}>
            {!hasGrowth ? '—' : `${growth > 0 ? '+' : ''}${growth.toFixed(2)}%`}
          </div>
          <span className={`tokenRowBadge ${badgeClass}`}>{badgeLabel}</span>
        </div>
        <div className="tokenRowSub">{token.startedAt ? `Age ${formatAge(Date.now() - token.startedAt)}` : 'Age —'}</div>
      </div>

      {/* ACTIONS */}
      <div className={`tokenRowActions ${isHovered ? 'tokenRowActionsOn' : ''}`}>
        <button
          onClick={() => {
            if (isRugged) {
              setRuggedClickedButton('load')
              return
            }
            onLoad(token.mint)
          }}
          className="tokenRowBtn"
        >
          {ruggedClickedButton === 'load' ? 'RUGGED' : 'Load'}
        </button>
        <button
          onClick={() => {
            if (isRugged) {
              setRuggedClickedButton('watch')
              return
            }
            onWatch(token.mint)
          }}
          className="tokenRowBtn"
        >
          {ruggedClickedButton === 'watch' ? 'RUGGED' : 'Watch'}
        </button>
        <button
          onClick={() => {
            if (isRugged) {
              setRuggedClickedButton('snipe')
              return
            }
            onSnipe(token.mint)
          }}
          disabled={disabled}
          className="tokenRowBtnPrimary"
        >
          {ruggedClickedButton === 'snipe' ? 'RUGGED' : 'Snipe'}
        </button>
      </div>

      {token.error ? (
        <div className="tokenRowError">
          {token.error}
        </div>
      ) : null}
    </motion.div>
  )
}
