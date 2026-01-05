export type ProductTier = 'free' | 'pro' | 'elite'
export type TradeMode = 'paper' | 'live'

export type TierGates = {
  allowLiveTrading: boolean
  allowFastMode: boolean
  tradeFeeBps: number
  maxWatchedTokens: number
  quotePollMs: number
}

export const DEFAULT_TIER: ProductTier = 'free'

export function tierDisplayName(tier: ProductTier): string {
  switch (tier) {
    case 'free':
      return 'Scout'
    case 'pro':
      return 'Sniper'
    case 'elite':
      return 'Apex'
  }
}

export function gatesForTier(tier: ProductTier): TierGates {
  switch (tier) {
    case 'free':
      return { allowLiveTrading: true, allowFastMode: false, tradeFeeBps: 100, maxWatchedTokens: 5, quotePollMs: 4000 }
    case 'pro':
      return { allowLiveTrading: true, allowFastMode: true, tradeFeeBps: 75, maxWatchedTokens: 20, quotePollMs: 800 }
    case 'elite':
      return { allowLiveTrading: true, allowFastMode: true, tradeFeeBps: 50, maxWatchedTokens: 999, quotePollMs: 500 }
  }
}

export function loadSetting(key: string, fallback: string) {
  const v = localStorage.getItem(key)
  return v && v.trim().length > 0 ? v : fallback
}

export function saveSetting(key: string, value: string) {
  localStorage.setItem(key, value)
}

export function loadTier(): ProductTier {
  const raw = loadSetting('dequanswap.tier', DEFAULT_TIER)
  // Back-compat: older builds used 'minimalist'. Map it to 'pro'.
  if (raw === 'minimalist') return 'pro'
  if (raw === 'free' || raw === 'pro' || raw === 'elite') return raw
  return DEFAULT_TIER
}

export function saveTier(tier: ProductTier) {
  saveSetting('dequanswap.tier', tier)
}

export function loadTradeMode(): TradeMode {
  const raw = loadSetting('dequanswap.tradeMode', 'paper')
  if (raw === 'paper' || raw === 'live') return raw
  return 'paper'
}

export function saveTradeMode(mode: TradeMode) {
  saveSetting('dequanswap.tradeMode', mode)
}
