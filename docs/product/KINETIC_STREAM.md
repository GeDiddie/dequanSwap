# Kinetic Vertical Stream Architecture

## Overview
Complete architectural overhaul of the "Minimalist" dashboard from a static 3-column grid to a dynamic single-column vertical stream with fixed command panel.

## The Problem
- **Static Grid**: Dead feeling, elements pop in instantly
- **Z-Pattern Eye Movement**: Forces eyes to scan across multiple columns (fatigue)
- **Lost Context**: Snipe/Position controls scroll away from view
- **Low Information Density**: Cards waste space, limit data visibility

## The Solution: Kinetic Vertical Stream

### 1. Layout Architecture

#### The Waterfall (Left 65%)
- **Single-column vertical list** replacing 3-column grid
- Each token = slim horizontal row (not card)
- Fixed viewport height with smooth scroll
- Top 20-25 tokens maximum
- New tokens materialize at the top with spring physics

#### The Command Panel (Right 35%)
- **Fixed position sidebar** (`position: sticky; top: 0`)
- Contains: Snipe module + Positions table
- Stays visible while feed scrolls
- Always ready for execution

### 2. Kinetic Motion Logic

#### Conveyor Belt Physics
```javascript
// Spring animation parameters
const springConfig = {
  type: "spring",
  stiffness: 400,
  damping: 25
}

// Insertion logic
const handleNewToken = (newToken, currentTokens) => {
  const entryWithEffect = { 
    ...newToken, 
    isNew: true,
    timestamp: Date.now()
  }
  
  // Push existing tokens down, keep top 20
  const updatedList = [entryWithEffect, ...currentTokens].slice(0, 20)
  
  // Trigger effects based on thresholds
  if (newToken.growth > 50) {
    triggerTactileThump()
    triggerSnipeGlowPulse()
  }
  
  return updatedList
}
```

#### Visual Displacement
- New token slides in from top with `y: -20 → 0`
- All existing rows animate down smoothly (`layout` prop in Framer Motion)
- Exiting tokens slide left with `x: 0 → -20, opacity: 0`

#### Signal Flash
- If growth increases >10% in single update: pulse neon glow for 1s
- Border flashes from transparent → neon → transparent

### 3. Row Component Blueprint

#### Structure
```
┌─────────────────────────────────────────────────────┐
│ [Heat Bar Background - Dynamic Width 0-100%]       │
├─────────┬──────────────────────────┬────────────────┤
│ IDENTITY│      CORE SIGNALS        │ QUICK ACTIONS  │
│         │                          │ (hover reveal) │
│ Symbol  │ MC    Growth%   Liquidity│  [Watch][Snipe]│
│ Age     │ $50k    +42%    $12k     │                │
└─────────┴──────────────────────────┴────────────────┘
```

#### Left Section (25% width)
- Token Symbol (large, uppercase, bold)
- Age indicator (small, mono font, muted)
- Circular progress ring (optional enhancement)

#### Center Section (50% width)
- **Market Cap**: `$50,000` format
- **Growth %**: Large, color-coded (`+` green, `-` red)
- **Liquidity**: Secondary metric
- Heat bar fills behind based on growth relative to session high

#### Right Section (25% width)
- Action buttons (Watch, Snipe)
- **Hidden by default** (`opacity-0`)
- Appear on row hover (`group-hover:opacity-100`)
- Snipe button has neon glow

### 4. Dynamic Visual Elements

#### Heat Mapping
```javascript
// Growth → Border Color + Shadow
const getHeatClass = (growth) => {
  if (growth < 10) return 'border-l-blue-500 shadow-blue'
  if (growth < 25) return 'border-l-transparent'
  if (growth < 50) return 'border-l-yellow-500 shadow-yellow'
  return 'border-l-red-500 shadow-red animate-pulse-heat'
}
```

#### Heat Bar (Background Progress)
- Absolute positioned div behind row content
- Width: `${Math.min(growth, 100)}%`
- Color: Emerald (positive) / Red (hot >50%)
- Opacity: 10% to avoid overwhelming text
- Transitions over 1s for smooth fills

#### Progressive Age Visualization
- Text: "2m 15s ago"
- Optional: Circular SVG ring that fills clockwise as time passes
- Color shifts: Fresh (green) → Stale (yellow) → Old (red)

### 5. Framer Motion Implementation

#### AnimatePresence Wrapper
```jsx
<AnimatePresence mode="popLayout">
  {feed.map(token => (
    <TokenRow key={token.mint} token={token} />
  ))}
</AnimatePresence>
```

#### Row Animation Config
```jsx
<motion.div
  layout
  initial={{ opacity: 0, y: -20 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, x: -20 }}
  transition={{ type: "spring", stiffness: 400, damping: 25 }}
>
```

### 6. Empty State

When feed is empty, show:
- **"Scanning for Signals..."** text
- Animated radar sweep effect
- Pulsing horizon line at top of feed container

### 7. HUD Header (Floating KPI Strip)

#### Design
- Semi-transparent glass (`backdrop-blur-12`)
- Floats over top of feed (overlaps by 20px)
- Contains: Session PnL, Triggered Count, Engine Status
- Fixed position, stays visible on scroll

#### Layout
```
┌──────────────────────────────────────────────────┐
│  PnL: +$125  |  Triggered: 5  |  ● Engine OK    │
└──────────────────────────────────────────────────┘
```

### 8. Tactical Feedback Systems

#### Snipe Panel Pulse
```javascript
const triggerTactileThump = () => {
  const panel = document.getElementById('snipe-panel')
  panel?.classList.add('animate-glitch-pulse')
  setTimeout(() => panel?.classList.remove('animate-glitch-pulse'), 500)
}
```

#### Engine Status Velocity
- Baseline: Slow pulse (2s cycle)
- Multiple tokens in 1s: Increase pulse speed to 0.5s
- Reflects network activity visually

### 9. CSS Animations

```css
@keyframes glitch-pulse {
  0%, 100% { 
    box-shadow: 0 0 10px var(--neon-green);
    transform: scale(1);
  }
  50% { 
    box-shadow: 0 0 25px var(--neon-green), inset 0 0 15px rgba(0,255,127,0.3);
    transform: scale(1.02);
  }
}

@keyframes pulse-heat {
  0%, 100% { 
    box-shadow: inset 10px 0 15px -10px rgba(239,68,68,0.3);
  }
  50% { 
    box-shadow: inset 10px 0 25px -5px rgba(239,68,68,0.6);
  }
}

@keyframes radar-sweep {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
```

### 10. Implementation Checklist

#### Phase 1: Structure
- [ ] Replace `.tokenGrid` with vertical flex container
- [ ] Create two-column layout (65% feed / 35% command)
- [ ] Make command panel `position: sticky`
- [ ] Implement TokenRow component

#### Phase 2: Motion
- [ ] Install/configure Framer Motion
- [ ] Add AnimatePresence wrapper
- [ ] Implement spring entrance animations
- [ ] Add layout animations for displacement
- [ ] Add exit animations (slide left)

#### Phase 3: Visual Enhancement
- [ ] Implement dynamic heat bar backgrounds
- [ ] Add growth-based border colors
- [ ] Create hover-reveal action buttons
- [ ] Add flash effect for >10% growth jumps

#### Phase 4: Tactical Feedback
- [ ] Add Snipe panel pulse on hot tokens
- [ ] Implement engine status velocity pulse
- [ ] Create empty state with radar animation
- [ ] Add floating KPI header

#### Phase 5: Polish
- [ ] Test animations at 60fps
- [ ] Optimize re-render performance
- [ ] Add accessibility (keyboard nav)
- [ ] Mobile responsive adjustments

## Why This Works Better

1. **Directional Focus**: Eyes move only up/down (not Z-pattern)
2. **Persistent Control**: Snipe/Positions always visible
3. **Momentum Feel**: Constant "pushing down" creates urgency
4. **Higher Information Density**: More data per screen
5. **Alive Feeling**: Physics-based motion vs instant pops
6. **Reduced Fatigue**: Single column = less cognitive load

## Technical Notes

### Performance
- Limit feed to top 20-25 tokens to prevent DOM bloat
- Use `layout` prop carefully (expensive operation)
- Memoize TokenRow component with React.memo()
- Virtualize if list exceeds 30 items

### Browser Compatibility
- Framer Motion requires modern browsers (ES6+)
- Fallback: CSS transitions for older browsers
- Test Safari for backdrop-filter performance

### State Management
```javascript
const [feed, setFeed] = useState([])

// On new token from WebSocket/poll
const handleNewTokenData = (newToken) => {
  setFeed(prev => {
    const updated = [newToken, ...prev]
    return updated.slice(0, 20) // Keep top 20
  })
}
```
