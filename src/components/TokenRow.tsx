import React from 'react'
import { motion } from 'framer-motion'

interface TokenRowProps {
  token: {
    mint: string
    name?: string
    symbol?: string
    growthPct?: number
    startedAt?: number
    detectedMc?: number
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
  const growth = token.growthPct ?? 0
  const heatWidth = Math.min(Math.max(growth, 0), 100)
  const isHot = growth > 50
  const isWarm = growth > 25 && growth <= 50
  const isCool = growth < 10

  // Determine heat class for border
  const getHeatClass = () => {
    if (isHot) return 'border-l-red-500 shadow-[inset_10px_0_15px_-10px_rgba(239,68,68,0.3)]'
    if (isWarm) return 'border-l-yellow-500 shadow-[inset_10px_0_15px_-10px_rgba(234,179,8,0.3)]'
    if (isCool) return 'border-l-blue-500 shadow-[inset_10px_0_15px_-10px_rgba(59,130,246,0.3)]'
    return 'border-l-transparent'
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={`relative group flex items-center justify-between p-3 mb-1 border-b border-white/5 
        bg-gradient-to-r from-transparent to-transparent hover:from-white/5 transition-all duration-200
        border-l-2 ${getHeatClass()}`}
    >
      {/* HEAT BAR BACKGROUND */}
      <div
        className={`absolute inset-0 h-full opacity-10 transition-all duration-1000 ease-out
          ${isHot ? 'bg-red-600' : isWarm ? 'bg-yellow-500' : 'bg-emerald-500'}`}
        style={{ width: `${heatWidth}%` }}
      />

      {/* LEFT: IDENTITY & AGE */}
      <div className="relative flex items-center space-x-4 w-1/4 min-w-0">
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-bold tracking-tighter text-white truncate uppercase">
            {token.symbol || token.name || shortPk(token.mint)}
          </span>
          <span className="text-[10px] text-white/40 font-mono">
            {token.startedAt ? `${formatAge(Date.now() - token.startedAt)} ago` : '—'}
          </span>
        </div>
      </div>

      {/* CENTER: CORE SIGNALS */}
      <div className="relative flex flex-1 items-center justify-around px-4">
        <div className="flex flex-col items-center">
          <span className="text-[9px] uppercase text-white/30 font-bold tracking-widest">Market Cap</span>
          <span className="text-xs font-mono text-white">
            {token.detectedMc ? `$${Math.round(token.detectedMc).toLocaleString()}` : '—'}
          </span>
        </div>

        <div className="flex flex-col items-center">
          <span className="text-[9px] uppercase text-white/30 font-bold tracking-widest">Signal</span>
          <span className={`text-sm font-black font-mono ${growth >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {growth > 0 ? '+' : ''}{growth.toFixed(2)}%
          </span>
        </div>

        <div className="flex flex-col items-center">
          <span className="text-[9px] uppercase text-white/30 font-bold tracking-widest">Mint</span>
          <span className="text-xs font-mono text-white/80">{shortPk(token.mint)}</span>
        </div>
      </div>

      {/* RIGHT: QUICK ACTIONS (VISIBLE ON HOVER) */}
      <div className="relative flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onLoad(token.mint)}
          className="px-3 py-1 text-[10px] font-bold bg-white/10 hover:bg-white/20 text-white rounded uppercase tracking-tighter border border-white/10"
        >
          Load
        </button>
        <button
          onClick={() => onWatch(token.mint)}
          className="px-3 py-1 text-[10px] font-bold bg-white/10 hover:bg-white/20 text-white rounded uppercase tracking-tighter border border-white/10"
        >
          Watch
        </button>
        <button
          onClick={() => onSnipe(token.mint)}
          disabled={disabled}
          className="px-3 py-1 text-[10px] font-bold bg-emerald-500/80 hover:bg-emerald-400 text-black rounded uppercase tracking-tighter shadow-[0_0_15px_rgba(16,185,129,0.4)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Snipe
        </button>
      </div>

      {token.error ? (
        <div className="absolute bottom-0 left-0 right-0 text-[9px] text-red-400/80 px-3 py-1">
          {token.error}
        </div>
      ) : null}
    </motion.div>
  )
}
