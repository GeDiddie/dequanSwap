import { motion } from 'framer-motion'
import type { ProductTier } from '../lib/product'

interface TierSelectionScreenProps {
  onSelectTier: (tier: ProductTier) => void
  onSubscribeTier?: (tier: Extract<ProductTier, 'pro' | 'elite'>) => void
  busy?: boolean
}

type TierConfig = {
  id: ProductTier
  name: string
  tagline: string
  features: string[]
  pricing: string
  recommended?: boolean
}

const TIERS: TierConfig[] = [
  {
    id: 'free',
    name: 'SCOUT',
    tagline: 'Get Started — Learn & Earn',
    features: [
      'Watch up to 5 tokens',
      'Track up to 5 positions',
      'Paper + Live trading',
      'Live feed (last 5 tokens)',
      '1% fee per trade',
      'Community support',
      'Non-custodial (you hold keys)',
    ],
    pricing: 'Free Forever',
  },
  {
    id: 'pro',
    name: 'SNIPER',
    tagline: 'Serious Trading',
    features: [
      'Watch up to 20 tokens',
      'Track up to 20 positions',
      'Paper + Live trading',
      'Live feed (last 30 tokens)',
      'Full PnL statements',
      '0.75% fee per trade',
      'Email support',
      'Everything in Scout',
    ],
    pricing: '$79/month',
    recommended: true,
  },
  {
    id: 'elite',
    name: 'APEX',
    tagline: 'Maximum Speed',
    features: [
      'Unlimited watchlist',
      'Unlimited position tracking',
      'Live + Fast Mode (delegate signing)',
      'Priority feed (last 50 tokens)',
      'Exportable PnL reports (CSV/JSON)',
      '0.5% fee per trade',
      'Priority support + onboarding',
      'Everything in Sniper',
    ],
    pricing: '$199/month',
  },
]

export const TierSelectionScreen: React.FC<TierSelectionScreenProps> = ({ onSelectTier, onSubscribeTier, busy }) => {
  return (
    <div className="tierScreen">
      <motion.div
        className="tierContainer"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        <div className="tierHeader">
          <h1 className="tierTitle">Choose Your Plan</h1>
          <p className="tierSubtitle">Start trading with the plan that fits your needs</p>
        </div>

        <div className="tierGrid">
          {TIERS.map((tier, index) => (
            <motion.div
              key={tier.id}
              className={`tierCard ${tier.recommended ? 'tierCardRecommended' : ''}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1, duration: 0.3 }}
            >
              {tier.recommended ? <div className="tierRecommendedBadge">Most Popular</div> : null}

              <div className="tierCardHeader">
                <h2 className="tierCardName">{tier.name}</h2>
                <p className="tierCardTagline">{tier.tagline}</p>
              </div>

              <div className="tierCardFeatures">
                {tier.features.map((feature, i) => (
                  <div key={i} className="tierFeature">
                    <span className="tierFeatureCheck">✓</span>
                    <span className="tierFeatureText">{feature}</span>
                  </div>
                ))}
              </div>

              <div className="tierCardFooter">
                <div className="tierPricing">{tier.pricing}</div>
                <button
                  className="tierSelectBtn"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    if (tier.id === 'free') return onSelectTier('free')
                    if (onSubscribeTier) return onSubscribeTier(tier.id)
                    return onSelectTier(tier.id)
                  }}
                >
                  {tier.id === 'free' ? 'Continue as Scout' : tier.id === 'pro' ? 'Subscribe to Sniper' : 'Subscribe to Apex'}
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="tierFooterNote">Plan fees: Scout 1%, Sniper 0.75%, Apex 0.5%. You can change your plan anytime in settings.</div>
      </motion.div>
    </div>
  )
}
