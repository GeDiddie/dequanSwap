import { useEffect, useMemo, useRef } from 'react'
import {
  createChart,
  createSeriesMarkers,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  CandlestickSeries,
} from 'lightweight-charts'
import type { Candle1s } from '../lib/candles1s'
import reticleLogo from '../media/reticleLogo.png'

export type CandlesChartMarker = {
  time: number
  position?: 'aboveBar' | 'belowBar' | 'inBar'
  color?: string
  shape?: 'circle' | 'square' | 'arrowUp' | 'arrowDown'
  text?: string
  size?: number
}

export type CandlesChartProps = {
  candles: Candle1s[]
  markers?: CandlesChartMarker[]
  height?: number
  showAttributionHint?: boolean
  currentMc?: number
  priceToMcRatio?: number
}

function toSeriesBar(c: Candle1s) {
  return {
    time: c.time as Time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }
}

export function CandlesChart({ candles, markers, height = 260, currentMc, priceToMcRatio }: CandlesChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const lastBarTimeRef = useRef<number | null>(null)
  const seededRef = useRef(false)
  const mcLineRef = useRef<HTMLDivElement | null>(null)

  const candleBars = useMemo(() => candles.map(toSeriesBar), [candles])

  const seriesMarkers = useMemo(() => {
    return (markers || []).map(
      (x): SeriesMarker<Time> =>
        ({
          time: x.time as Time,
          position: x.position ?? 'aboveBar',
          color: x.color ?? 'rgba(45,226,230,0.9)',
          shape: x.shape ?? 'circle',
          text: x.text,
          size: x.size,
        }) as SeriesMarker<Time>,
    )
  }, [markers])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // Hide TradingView watermark with CSS
    const style = document.createElement('style')
    style.textContent = `
      div[class*="tv-lightweight-charts"] a[href*="tradingview"] {
        display: none !important;
      }
      div[class*="tv-lightweight-charts"] div[class*="watermark"] {
        display: none !important;
      }
    `
    document.head.appendChild(style)

    const chart = createChart(el, {
      height,
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: '#cbd5e1',
      },
      grid: {
        vertLines: { color: 'rgba(148, 163, 184, 0.08)' },
        horzLines: { color: 'rgba(148, 163, 184, 0.08)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(148, 163, 184, 0.18)',
        visible: true,
        autoScale: true,
      },
      leftPriceScale: {
        borderColor: 'rgba(148, 163, 184, 0.18)',
        visible: priceToMcRatio ? true : false,
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(148, 163, 184, 0.18)',
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 5,
        barSpacing: 6,
      },
      crosshair: {
        vertLine: { color: 'rgba(226, 232, 240, 0.22)' },
        horzLine: { color: 'rgba(226, 232, 240, 0.22)' },
      },
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      borderVisible: false,
      priceScaleId: 'right',
    })

    // Add MC scale series if priceToMcRatio is provided
    if (priceToMcRatio) {
      const mcScale = chart.priceScale('left')
      mcScale.applyOptions({
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      })
    }

    const markers = createSeriesMarkers(series, [])

    chartRef.current = chart
    seriesRef.current = series
    markersRef.current = markers

    return () => {
      document.head.removeChild(style)
      try {
        chart.remove()
      } catch {
        // ignore
      }
      chartRef.current = null
      seriesRef.current = null
      markersRef.current = null
    }
  }, [height])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    if (!candleBars.length) {
      series.setData([])
      seededRef.current = false
      lastBarTimeRef.current = null
      return
    }

    // Perf: after initial seed, only update the last bar.
    const last = candleBars[candleBars.length - 1]
    const lastTime = typeof last?.time === 'number' ? (last.time as number) : null

    if (!seededRef.current) {
      series.setData(candleBars)
      seededRef.current = true
      lastBarTimeRef.current = lastTime
      return
    }

    // If time went backwards (or unknown), fall back to setData.
    const prevTime = lastBarTimeRef.current
    if (prevTime != null && lastTime != null && lastTime < prevTime) {
      series.setData(candleBars)
      lastBarTimeRef.current = lastTime
      return
    }

    // update() replaces last bar if same time, or appends if newer.
    series.update(last)
    lastBarTimeRef.current = lastTime
  }, [candleBars])

  useEffect(() => {
    const markers = markersRef.current
    if (!markers) return
    // Note: lightweight-charts v5 uses a markers plugin API, not series.setMarkers.
    markers.setMarkers(seriesMarkers)
  }, [seriesMarkers])

  // Update MC indicator position
  useEffect(() => {
    const mcLine = mcLineRef.current
    const container = containerRef.current
    if (!mcLine || !container || !currentMc || !priceToMcRatio || !candleBars.length) return

    try {
      const lastCandle = candleBars[candleBars.length - 1]
      const currentPrice = lastCandle?.close
      if (!currentPrice) return

      // Calculate position based on visible price range
      const minPrice = Math.min(...candleBars.slice(-100).map(c => c.low))
      const maxPrice = Math.max(...candleBars.slice(-100).map(c => c.high))
      const range = maxPrice - minPrice
      if (range === 0) {
        mcLine.style.display = 'none'
        return
      }
      
      // Chart takes up container height minus some padding
      const chartHeight = container.clientHeight - 30 // account for time axis
      const pct = (currentPrice - minPrice) / range
      const y = chartHeight * (1 - pct) + 10 // offset from top
      
      mcLine.style.top = `${y}px`
      mcLine.style.display = 'block'
    } catch {
      mcLine.style.display = 'none'
    }
  }, [candleBars, currentMc, priceToMcRatio])

  const fmtMc = (mc: number | undefined) => {
    if (typeof mc !== 'number' || !Number.isFinite(mc)) return '—'
    const abs = Math.abs(mc)
    if (abs >= 1_000_000) return `$${(mc / 1_000_000).toFixed(2)}M`
    if (abs >= 1_000) return `$${(mc / 1_000).toFixed(1)}K`
    return `$${Math.round(mc).toLocaleString()}`
  }

  return (
    <div style={{ position: 'relative' }}>
      <div ref={containerRef} />
      {currentMc && priceToMcRatio ? (
        <div
          ref={mcLineRef}
          style={{
            position: 'absolute',
            right: 0,
            left: 0,
            height: 1,
            background: 'rgba(45, 226, 230, 0.6)',
            pointerEvents: 'none',
            display: 'none',
            zIndex: 10,
          }}
        >
          <div
            style={{
              position: 'absolute',
              right: 65,
              top: -10,
              padding: '2px 8px',
              background: 'rgba(45, 226, 230, 0.95)',
              color: '#000',
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 4,
              whiteSpace: 'nowrap',
            }}
          >
            MC: {fmtMc(currentMc)}
          </div>
        </div>
      ) : null}
      <img
        src={reticleLogo}
        alt=""
        style={{
          position: 'absolute',
          left: 8,
          bottom: 6,
          height: 28,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      />
    </div>
  )
}
