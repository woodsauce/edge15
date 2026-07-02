# Edge15 Genesis-028 — 5:30 Decision Classic

This version starts from the Genesis-027 classic helper style and tunes the main model around the scored sweet spot: 6:00 to 5:00 remaining, with a target decision around 5:30 left.

## Main behavior

- Above 8:00 remaining: staging only.
- 8:00–6:00 remaining: build a lean, but wait for the decision window.
- 6:00–5:00 remaining: primary 5:30 decision window.
- 5:00–4:30 remaining: confirmation window.
- Under 4:30 remaining: late-risk / very selective.

## Layout

This keeps the older Genesis-027 helper flow:

- screenshot upload and manual inputs on the left
- one Analyze button
- single prediction card on the right
- OVER / UNDER / WAIT output
- success percentage
- risk, whipsaw, late-window, value-vs-market
- live BTC and Kalshi support in the background

## Vercel settings

- Framework Preset: Other
- Build Command: npm run vercel-build
- Output Directory: public
- Node.js Version: 24.x
