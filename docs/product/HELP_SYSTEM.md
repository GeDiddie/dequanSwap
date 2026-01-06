# Help System (dequanSnipe) — Final Design

**Date**: 2026-01-03

This document defines the premium, on-brand help system for dequanSnipe.

## Goals

- Beginner-friendly: explain the core workflow quickly.
- Non-annoying for power users: easy to disable and never blocks trading.
- On-brand: "sniper precision" visual language.
- Fast: minimal UI overhead, no jank.

---

## A) Contextual Hover Help (Primary for returning users)

Trigger:
- Hover over any **main section header** (examples: "Live Feed", "Watching", "Holdings", "Snipe", etc.).

UI:
- A subtle **pulsing cyan scope reticle** appears in the corner of the panel.
- A sleek **dark tooltip/pill** slides in containing:
  - One short 1-line benefit statement
  - Video thumbnail + play button

Interaction:
- Click the thumbnail → short explainer video plays as a **centered overlay** (target 18–22s).
- Video overlay supports:
  - Auto-close at end and/or manual close (X)
  - ESC closes
  - Click-backdrop closes

Brand alignment:
- Reticle glow: cyan
- Tooltip: dark pill
- Typography: clean, legible, minimal

---

## B) Global Toggle (Help Mode)

UI:
- Small fixed toggle in bottom-right corner: **"Help Mode" ON/OFF**
- Default: **ON**

Behavior:
- When OFF: all hover reticles, tooltips, and pulsing are disabled.
- When ON: full contextual help is active.

Icon:
- Subtle target/reticle icon
- Gently pulses when ON

Persistence:
- Store in `localStorage` (recommended key: `dequanswap.helpMode`, values `on|off`).

---

## C) First-Time Onboarding Tour (4-step)

Trigger:
- Auto-run on **first wallet connect** or a fresh session.
- Detected via a `localStorage` flag (recommended key: `dequanswap.onboardingDone=1`).

Tour steps (with embedded mini videos):
1) Live Feed → "Catch hot launches instantly"
2) Watching → "Track rising tokens before you snipe"
3) Snipe panel → "Fast, safe buys in one click"
4) Holdings → "See your wins and PnL live"

Each step:
- Spotlight highlight on the target panel
- Pulsing reticle
- Mini video plays inline

Controls:
- Skippable at any time
- Ends with "Got it!" button and sets the flag so it does not replay

---

## Visual System (must stay consistent)

Palette:
- Background: `#0B0F1A`
- Panel: `#121A2B`
- Text primary: `#EAF2FF`
- Text secondary: `#97A3B6`
- Accent cyan: `#2DE2E6`

Motion:
- Reticle pulse: subtle (no distracting bounce)
- Tooltip slide-in: 180–240ms

Video format:
- Target duration: 18–22s
- Default playback: click-to-play (no surprise autoplay)

---

## Video Link Strategy

We support two hosting styles:

1) **Direct mp4**: `VITE_HELP_VIDEO_BASE_URL` + `/${id}.mp4`
2) **Redirect page**: `VITE_HELP_VIDEO_BASE_URL` + `/${id}` → redirects to YouTube (or other host)

See [FEATURE_SHORTS.md](FEATURE_SHORTS.md) for the canonical list of video IDs and per-video scripts.
