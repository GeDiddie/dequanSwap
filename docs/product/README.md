# Product Docs (dequanSwap)

These docs define the **tiered UX**, what each tier is allowed to do, and the build rules for implementing features safely.

## Product North Star
A beginner should be able to:
1. Connect a wallet (or start in paper mode)
2. Watch new tokens in a live feed
3. Understand *why* a token is interesting (simple growth + simple reasons)
4. Buy / sell with one click

The UI should feel like:
- **DequanW dashboard simplicity** (one screen, signal-first)
- With **BullX/PumpSwap ergonomics** (fast actions, minimal decisions)

## The four “modes” (how the app stays simple)
We avoid adding 50 toggles by mapping tiers to modes:

- **Free** → Observe + Paper
- **Minimalist** → Observe + Manual Execute
- **Pro** → Observe + Assisted Auto
- **Elite** → Strategy Lab

Each mode has its own UI surface area. Users only see the controls needed for that mode.

## Documents
- [Tiers](TIERS.md)
- [Feature Gates](FEATURE_GATES.md)
- [Minimalist UX](UX_MINIMALIST.md)
- [Build Guidelines](BUILD_GUIDELINES.md)
- [Roadmap](ROADMAP.md)
