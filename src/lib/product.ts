export type ProductTier = 'free' | 'minimalist' | 'pro' | 'elite'
export type TradeMode = 'paper' | 'live'

export type TierGates = {
  allowLiveTrading: boolean
  maxWatchedTokens: number
  quotePollMs: number
}

export const DEFAULT_TIER: ProductTier = 'free'

export function gatesForTier(tier: ProductTier): TierGates {
  switch (tier) {
    case 'free':
      return { allowLiveTrading: false, maxWatchedTokens: 10, quotePollMs: 4000 }
    case 'minimalist':
      return { allowLiveTrading: true, maxWatchedTokens: 50, quotePollMs: 1500 }
    case 'pro':
      return { allowLiveTrading: true, maxWatchedTokens: 200, quotePollMs: 800 }
    case 'elite':
      return { allowLiveTrading: true, maxWatchedTokens: 500, quotePollMs: 500 }
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
  if (raw === 'free' || raw === 'minimalist' || raw === 'pro' || raw === 'elite') return raw
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
