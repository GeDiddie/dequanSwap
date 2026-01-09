import { motion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import type { ProductTier } from '../lib/product'

interface TierSelectionScreenProps {
  onSelectTier: (tier: ProductTier) => void
  onSubscribeTier?: (tier: Extract<ProductTier, 'pro' | 'elite'>) => void
  busy?: boolean
  onClose?: () => void
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
      'Watch up to 3 tokens',
      'Track your positions',
      'Live feed (last 10 tokens)',
      'Live 1-second candles (popouts)',
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
      'Live trading',
      'Live feed (last 20 tokens)',
      'Risk/edge signals (popouts)',
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
      'Live + Fast Mode (delegate signing)',
      'Live feed (last 30 tokens)',
      'Risk/edge signals (popouts)',
      '0.5% fee per trade',
      'Priority support + onboarding',
      'Everything in Sniper',
    ],
    pricing: '$199/month',
  },
]

export const TierSelectionScreen: React.FC<TierSelectionScreenProps> = ({ onSelectTier, onSubscribeTier, busy, onClose }) => {
  const screenRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // Fixed-position scroll containers on mobile can restore a stale scroll offset.
    // Force the Tier screen to start at the top.
    const el = screenRef.current
    requestAnimationFrame(() => {
      try {
        el?.scrollTo({ top: 0 })
      } catch {
        // ignore
      }
      try {
        window.scrollTo({ top: 0 })
      } catch {
        // ignore
      }
    })
  }, [])

  return (
    <div className="tierScreen" ref={screenRef}>
      <motion.div
        className="tierContainer"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        <div className="tierTopActions">
          {onClose ? (
            <button type="button" className="tierBackBtn" onClick={onClose}>
              Back
            </button>
          ) : null}
        </div>

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
