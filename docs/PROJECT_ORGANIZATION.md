# Project Organization Summary

**Last Updated**: December 31, 2025

---

## ✅ Cleanup Completed

### Root Directory
- ✅ Clean: No loose files
- ✅ `cloudflared.deb` moved to `dev-docs/` (deployment artifact)
- ✅ All source code organized in `src/`
- ✅ All documentation organized in `docs/` and `dev-docs/`

### Documentation Structure

```
docs/
├── product/                    # Product & UX specifications
│   ├── MASTER_BUILD_CHECKLIST.md    ⭐ PRIMARY TODO - CHECK BEFORE ALL CHANGES
│   ├── ROADMAP.md              # Feature roadmap & milestones
│   ├── TIERS.md                # Product tier definitions
│   ├── FAST_MODE.md            # Fast Mode hybrid design spec
│   ├── BUILD_GUIDELINES.md     # Development standards
│   ├── UX_MINIMALIST.md        # UI/UX requirements
│   ├── FEATURE_GATES.md        # Tier gating matrix
│   ├── KINETIC_STREAM.md       # Feed animation spec
│   └── README.md               # Product docs index
└── trading-api/                # Backend integration
    ├── TRADING_API_INTEGRATION.md
    ├── WEBSOCKET_API_IMPLEMENTATION.md
    └── TRADING_UI_COMPARISON.md

dev-docs/                       # PRIVATE (gitignored)
├── DEPLOYMENT.md               # Production deploy guide
├── ENV_VARS.md                 # Environment configuration
├── CHEAT_SHEET.md              # Quick reference (URLs, IDs, commands)
├── README.md                   # Dev docs index
└── cloudflared.deb             # Cloudflare Tunnel installer
```

---

## 🎯 Workflow Reminders

### Before Making Changes
1. **ALWAYS CHECK**: [docs/product/MASTER_BUILD_CHECKLIST.md](../docs/product/MASTER_BUILD_CHECKLIST.md)
2. Review relevant product docs in `docs/product/`
3. Check tier gating requirements

### Before Deploying
1. Run `npm run build` (must pass)
2. Review checklist Section B (Release)
3. Verify no secrets in env vars
4. Deploy: `npx wrangler pages deploy dist --project-name=dequanswap`

### Backend Dependency
- This UI requires `~/bot/jul2025/dequanW/tradingAPI/server.js` running
- Start backend: `cd ~/bot/jul2025/dequanW && node tradingAPI/server.js`
- Backend must be on port `8900` and support `quote` + `build_swap_tx` WS commands

---

## 📋 Current TODO Priorities

See [docs/product/MASTER_BUILD_CHECKLIST.md](../docs/product/MASTER_BUILD_CHECKLIST.md) for the authoritative list.

**Top 3 (as of Dec 31, 2025)**:
1. ✅ Delegate Fast Mode BUYs (implemented)
2. 🔴 Delegate Fast Mode SELLs (high priority, in progress)
3. Bot wallet hardening (encryption, backup UX)

---

## 🔒 Security Checklist

- ✅ `.env` is gitignored
- ✅ `dev-docs/` is gitignored (contains secrets)
- ✅ No long-lived API keys shipped to browser
- ✅ All wallet operations require explicit user action
- ✅ Fast Mode uses conservative caps by default

---

## 📦 Project State

**Frontend**: Production-ready  
**Deployment**: Cloudflare Pages (`dequanswap` project)  
**Live URL**: https://snipe.dequan.xyz  
**Backend**: dequanW Trading API at `~/bot/jul2025/dequanW`  
**Backend URL**: https://dequanw-api.dequan.xyz (via Cloudflare Tunnel)

**Tech Stack**:
- React 19 + TypeScript + Vite
- Solana Web3.js + Wallet Adapter
- Framer Motion (animations)
- Cloudflare Pages (hosting)

---

## 🧪 Testing Quick Start

```bash
# 1. Install
npm install

# 2. Start backend
cd ~/bot/jul2025/dequanW
node tradingAPI/server.js

# 3. Start frontend (new terminal)
cd ~/bot/dequanSwap
npm run dev

# 4. Open browser
# http://localhost:5173
```

---

**Maintainer**: g1@G1
