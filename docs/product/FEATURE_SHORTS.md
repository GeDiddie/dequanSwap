# Feature Shorts (Video Ideas + IDs)

Goal: keep a **single canonical list** of short, high-signal explainer videos for the current dequanSnipe build.

These IDs are used by the UI help `?` icons.

Video URL convention:
- Base URL from env: `VITE_HELP_VIDEO_BASE_URL`
- Each video: `${BASE}/${id}.mp4` (direct mp4) or `${BASE}/${id}` (redirect page, e.g. YouTube)

Help system UX spec lives in: [HELP_SYSTEM.md](HELP_SYSTEM.md)

---

## Global Recording Spec (applies to all videos)

**Duration**: 10–30s (target 18–22s)

**Format**:
- Record **16:9** at 1920×1080, 30fps
- Export a **9:16** crop at 1080×1920 if we also want TikTok/Reels/Shorts

**Style rules**:
- First 2 seconds must show the “why” (hook), not the setup.
- Keep overlays to **1–2 short lines**, max 6 words each.
- Use cursor highlight (circle) and a single “click” SFX *or* no audio.
- Do not show private wallet balances or identifiable addresses; blur if needed.

**Capture checklist**:
- Use a dedicated demo wallet.
- Use tiny amounts and blur Solscan.
- Keep browser zoom at 100%.

**Naming**:
- File name must match `id` exactly: `submitted-vs-confirmed.mp4`

---

## Ship Now (Current Build)

These are the **videos we should eventually record**, but video production can happen last.
For now, keep this list accurate so every `HelpDot` can point to a real ID.

---

## MVP / Phase 1 (Must-Have Help IDs)

### 0) Start Here — First Video to Produce (when we start recording)

### `live-feed-explainer`
- Output file: `live-feed-explainer.mp4`
- Title: “What is the Live Feed?”
- Duration target: 20s
- Where used: Primary hover on "Live Feed" header + Step 1 of onboarding tour

Script Structure (Hook → Action → Payoff → End Card)

0–2s Hook
- Overlay (top-left pill): “Catch Winners Early”
- Show Live Feed panel with a few tokens pulsing in (use demo data like: STARBUCKS +41%, BUCKETMAN +42%, etc.)

2–12s Action
- Cursor highlights scrolling feed
- Point to key columns: Token name → Market Cap → MC Δ (with color tags: HOT/WARM/COOL)
- Quick zoom on a "HOT" + high Δ token
- Overlay lines:
	- “Real-time launches”
	- “Smart signals from dequanW”

12–20s Payoff
- Show user clicking "Watch" on a hot token → it moves to Watching panel
- Overlay: “Spot. Watch. Snipe.”
- Final line: “Never miss momentum”

20–21s End Card
- Background: `#0B0F1A`
- “dequanSnipe” in `#EAF2FF`
- “Live Feed” in `#2DE2E6`

Safety notes:
- Use only demo/test tokens (no real sensitive data)
- Blur any addresses if they appear

### 1) `tiers-scout-sniper-apex`
- Title: “Pick a Plan in 10 Seconds”
- Where used: Tier Selection screen + header Plan control
- Hook (overlay): “Scout → Sniper → Apex”
- Show:
	1) Open Tier Selection
	2) Point at Scout/Sniper/Apex cards (no scrolling)
	3) Tap Scout (free) then “Change Plan” to reopen
- Key line (overlay): “Upgrade anytime”
- Notes: emphasize names, not pricing

### 2) `change-plan-upgrade`
- Title: “Upgrade Anytime (Change Plan)”
- Where used: Topbar next to Plan selector
- Hook (overlay): “Stuck on Scout?”
- Show:
	1) Start in app on Scout
	2) Click **Change Plan**
	3) Tier screen reopens instantly
- Key line (overlay): “One click to upgrade”

### 3) `subscription-usdc-upgrade`
- Title: “Subscribe with USDC (Sniper/Apex)”
- Where used: Tier Selection paid buttons
- Hook (overlay): “Paid plans = USDC”
- Show:
	1) Click Sniper (or Apex) subscribe button
	2) Phantom pops up (sign)
	3) Back in UI: plan switches + closes
- Key line (overlay): “No credit cards”
- Notes: blur the wallet address + signature; keep amount visible (29/99)

### 4) `subscription-renewals`
- Title: “Renewals + Reminders”
- Where used: Topbar auth pills (Renew soon / overdue)
- Hook (overlay): “No surprise lockouts”
- Show:
	1) Show “Renew soon” pill
	2) Click Change Plan → show subscription CTA again
- Key line (overlay): “Renew when ready”
- Notes: can be recorded on a staging DB row (don’t wait 27 days)

### 5) `trade-fees-by-plan`
- Title: “Protocol Fee (By Plan)”
- Where used: Anywhere fee breakdown is shown (pre-trade panel)
- Hook (overlay): “Fees are transparent”
- Show:
	1) Point at fee breakdown line(s)
	2) Quick zoom on fee percent (Scout 1%, Sniper 0.75%, Apex 0.5%)
- Key line (overlay): “Shown before you trade”

### 7) `submitted-vs-confirmed`
- Title: “Submitted vs Confirmed”
- Where used: Snipe status/toasts
- Hook (overlay): “Sig first. Confirm later.”
- Show:
	1) Click Snipe
	2) UI shows signature quickly
	3) UI later shows confirmed
- Key line (overlay): “No fake ‘timeouts’”

### 8) `real-solana-ws-confirm`
- Title: “Real WebSocket Confirmations”
- Where used: Debug Portal / reliability messaging
- Hook (overlay): “WS confirmations are faster”
- Show:
	1) Open Debug Portal
	2) Point at WS health / confirmation indicators
- Key line (overlay): “Event-driven confirmations”

### 9) `no-secrets-in-browser`
- Title: “No Secrets in the Browser”
- Where used: Auth/help near Control Plane
- Hook (overlay): “Browser has no API keys”
- Show:
	1) Open Debug/Settings
	2) Point at Control Plane auth label
- Key line (overlay): “JWT is short-lived”

### 10) `jwt-wallet-binding`
- Title: “Wallet-Bound JWT”
- Where used: Auth/help near wallet connect
- Hook (overlay): “JWT = wallet-signed login”
- Show:
	1) Connect wallet
	2) Show signature prompt once
	3) Show “JWT expires in …” pill
- Key line (overlay): “Server verifies via JWKS”

### 11) `capped-fast-mode`
- Title: “Fast Mode is Capped Risk”
- Where used: Fast Mode panel
- Hook (overlay): “Speed with limits”
- Show:
	1) Point at Fast Mode cap + timer
	2) Show Revoke control
- Key line (overlay): “Opt-in + capped”

### 12) `watchlist-growth-proxy`
- Title: “Growth% from Real Quotes”
- Where used: Watching list growth% UI
- Hook (overlay): “Growth is executable”
- Show:
	1) Hover a token in Watching
	2) Point at Growth% / quote polling
- Key line (overlay): “Derived from quotes”

### 13) `dequanw-signal-feed`
- Title: “Powered by dequanW Signals”
- Where used: Feed area
- Hook (overlay): “Signals, not noise”
- Show:
	1) Feed updates
	2) Highlight “new token” pulse/animation
- Key line (overlay): “Live detection stream”

### 14) `holdings-buy-mc-time`
- Title: “Holdings: Buy Time + Buy MC”
- Where used: Holdings list columns
- Hook (overlay): “Know your entry”
- Show:
	1) Show a holding row
	2) Point at Buy Time + Buy MC
- Key line (overlay): “Entry snapshot”

### 15) `holdings-realtime-chart`
- Title: “Holdings: Real-Time Chart”
- Where used: Holdings chart/drawer
- Hook (overlay): “See momentum instantly”
- Show:
	1) Open holding detail/chart
	2) Show line updating
- Key line (overlay): “Watch → decide → sell”

### 16) `debug-portal-unlock`
- Title: “Open the Debug Portal”
- Where used: Help / owner troubleshooting
- Hook (overlay): “Hidden diagnostics”
- Show:
	1) Click the brand rapidly (easter egg)
	2) Debug Portal opens
	3) (Optional) Enter passcode to unlock
- Key line (overlay): “Owner tools”
- Notes: do not expose the real passcode; record with passcode disabled or blurred

### 17) `wallet-pending-prompts`
- Title: “Wallet Prompt in Another Tab?”
- Where used: walletActionHint toast
- Hook (overlay): “Phantom is waiting”
- Show:
	1) Trigger a wallet action
	2) Show the toast hint
	3) Switch briefly to Phantom side panel (blur address)
- Key line (overlay): “Approve the pending prompt”

### 18) `debug-portal-health`
- Title: “Debug Portal: Health”
- Where used: Debug Portal
- Hook (overlay): “Know what’s broken”
- Show:
	1) Open Debug Portal
	2) Point at /healthz stats + tier counts
- Key line (overlay): “WS + RPC + auth”

### 19) `error-timeline`
- Title: “Debug Portal: Timeline”
- Where used: Debug Portal
- Hook (overlay): “Find errors fast”
- Show:
	1) Trigger a safe error (e.g., disconnect WS)
	2) Show timeline entry
- Key line (overlay): “Actionable errors”

### 20) `powered-by-status-dot`
- Title: “Powered By: Green = Fresh”
- Where used: topbar “powered by dequan” dot
- Hook (overlay): “Green = connected”
- Show:
	1) Dot red when feed is stale/error
	2) Dot flips green when feed is fresh
- Key line (overlay): “Live feed health”

### 21) `rugged-no-route`
- Title: “RUGGED / No Route”
- Where used: sell error UX + RUGGED badges
- Hook (overlay): “No liquidity = no sell”
- Show:
	1) A rugged token shows RUGGED
	2) Sell explains “no route/liquidity” instead of raw Jupiter errors
- Key line (overlay): “Clear, safe messaging”

### 22) `holdings-sell-workflow`
- Title: “Holdings → Sell (Flip Card)”
- Where used: Holdings sell button + Sell view
- Hook (overlay): “Sell from Holdings”
- Show: click Sell in Holdings → right panel flips to Sell → quick % buttons → Return to Snipe
- Key line (overlay): “Fast manual exits”

### 23) `holdings-quick-sell-buttons`
- Title: “Quick Sell: 25 / 50 / 100”
- Where used: Sell view
- Hook (overlay): “One tap sells”
- Show: tap 25/50/100, then Sell
- Key line (overlay): “Percent-based sells”

### 24) `watching-token-copy`
- Title: “Copy Token Address (Hover + Click)”
- Where used: Watching + Holdings token column
- Hook (overlay): “Copy in 1 click”
- Show: hover token → flips to short mint → click copies full mint
- Key line (overlay): “No typing addresses”

### 25) `snipe-clear`
- Title: “Clear Snipe Form”
- Where used: Snipe panel Clear button
- Hook (overlay): “Reset instantly”
- Show: click Clear → mint/amount/slippage reset + messages cleared
- Key line (overlay): “No stale state”

### 26) `mobile-minimalist-layout`
- Title: “Mobile Layout (Minimalist)”
- Where used: general onboarding/help
- Hook (overlay): “Works on mobile”
- Show: small screen: Command Center moves top, rows stack with labels, big tap targets
- Key line (overlay): “Built for phone browsers”

### 27) `tiered-auth-free-vs-paid`
- Title: “Free vs Paid Auth (Why Account Exists)”
- Where used: Tier selection + account-required modal
- Hook (overlay): “Free = wallet-only”
- Show: free tier uses wallet auth; paid flows require account (email code) for subscription linkage
- Key line (overlay): “Safer subscriptions”

---

---

## Later / Backlog (Don’t record until features ship)

### `fast-mode-arm-and-revoke`
- Title: “Arm Fast Mode (Then Revoke)”
- Hook (overlay): “1 signature → many swaps”
- Show: arming tx, timer starts, revoke
- Notes: record once delegate-authority swap builder is in place (otherwise it’s confusing)

### `tp-sl-rules`
- Title: “Take Profit / Stop Loss (Rules)”
- Hook (overlay): “Simple exits, automated”
- Show: set TP/SL, demonstrate simulated trigger
- Notes: replaces deprecated `tp-sl-minimalist`

### 19) `auto-buy-presets`
- Title: “Auto-Buy Presets (Sniper/Apex)”
- Hook (overlay): “Preset automation”
- Show: choose preset, cap spend, enable

### 20) `strategy-lab`
- Title: “Apex Strategy Lab”
- Hook (overlay): “Full control”
- Show: allowlist/denylist, multi-rule

---

## Deprecated IDs (keep for back-compat)

### `tp-sl-minimalist`
- Deprecated: tier model changed to Scout/Sniper/Apex
- Replacement: `tp-sl-rules`

### `pro-assisted-automation`
- Deprecated: rename to `auto-buy-presets`

### `elite-full-automation`
- Deprecated: rename to `strategy-lab`
