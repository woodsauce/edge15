# Edge15 Genesis-027 Rollback Base

This version intentionally returns to the older Genesis 027-style helper flow:

- two-card layout
- screenshot/manual inputs
- one Analyze button
- simple OVER / UNDER / SKIP output
- success percentage and bet-quality stars
- estimated Under/Over probabilities
- gap to target
- move needed per minute
- live BTC price and momentum
- risk, late-window danger, whipsaw risk, and value vs market
- hidden diagnostics only

Live data remains available as support:

- `/api/btc`
- `/api/kalshi?series=KXBTC15M`
- `/api/coinbase?light=1`
- `/api/candles`
- `/api/health`

## Vercel settings

- Framework Preset: Other
- Build Command: `npm run vercel-build`
- Output Directory: `public`
- Install Command: `npm install`
- Node.js Version: `24.x`
