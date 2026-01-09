export type Candle1s = {
  time: number // unix seconds
  open: number
  high: number
  low: number
  close: number
  volume?: number
  buyVolume?: number
  sellVolume?: number
}

export type CandleTick = {
  tsMs: number
  price: number
  volume?: number
  side?: 'buy' | 'sell'
}

export type CandleBuilderOptions = {
  maxCandles?: number
  gapFill?: boolean
}

export class Candles1sBuilder {
  private readonly maxCandles: number
  private readonly gapFill: boolean
  private candles: Candle1s[] = []

  constructor(opts: CandleBuilderOptions = {}) {
    this.maxCandles = Math.max(10, Math.floor(opts.maxCandles ?? 1200)) // default: 20 min
    this.gapFill = opts.gapFill ?? false
  }

  getAll(): Candle1s[] {
    return this.candles
  }

  getLast(): Candle1s | null {
    return this.candles.length ? this.candles[this.candles.length - 1] : null
  }

  reset() {
    this.candles = []
  }

  pushTick(tick: CandleTick): { updated: boolean; candle: Candle1s } | null {
    if (!tick || typeof tick.tsMs !== 'number' || typeof tick.price !== 'number') return null
    if (!Number.isFinite(tick.tsMs) || !Number.isFinite(tick.price)) return null

    const t = Math.floor(tick.tsMs / 1000)
    const last = this.getLast()

    if (!last) {
      const c: Candle1s = {
        time: t,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
      }
      this.applyVolume(c, tick)
      this.candles.push(c)
      this.trim()
      return { updated: false, candle: c }
    }

    if (t === last.time) {
      last.high = Math.max(last.high, tick.price)
      last.low = Math.min(last.low, tick.price)
      last.close = tick.price
      this.applyVolume(last, tick)
      return { updated: true, candle: last }
    }

    if (t > last.time) {
      if (this.gapFill) {
        // Fill missing seconds with flat candles so the chart doesn't appear "dead".
        for (let tt = last.time + 1; tt < t; tt += 1) {
          const flat: Candle1s = {
            time: tt,
            open: last.close,
            high: last.close,
            low: last.close,
            close: last.close,
            volume: 0,
            buyVolume: 0,
            sellVolume: 0,
          }
          this.candles.push(flat)
          this.trim()
        }
      }

      const c: Candle1s = {
        time: t,
        open: last.close,
        high: tick.price,
        low: tick.price,
        close: tick.price,
      }
      // If you prefer open=tick.price instead of last.close, switch here.
      c.open = this.gapFill ? last.close : tick.price
      this.applyVolume(c, tick)
      this.candles.push(c)
      this.trim()
      return { updated: false, candle: c }
    }

    // Out-of-order tick; ignore for now (keeps logic simple and fast)
    return null
  }

  private applyVolume(c: Candle1s, tick: CandleTick) {
    if (typeof tick.volume === 'number' && Number.isFinite(tick.volume)) {
      c.volume = (c.volume ?? 0) + tick.volume
      if (tick.side === 'buy') c.buyVolume = (c.buyVolume ?? 0) + tick.volume
      if (tick.side === 'sell') c.sellVolume = (c.sellVolume ?? 0) + tick.volume
    }
  }

  private trim() {
    const extra = this.candles.length - this.maxCandles
    if (extra > 0) this.candles = this.candles.slice(extra)
  }
}
