# Changelog

## v24.0.3 - Vercel public output fix
- Added `/public` static output folder with `index.html`, `app.js`, and `styles.css`.
- Set `vercel.json` `outputDirectory` to `public` so Vercel serves the app homepage instead of a 404.
- Build script now copies static files into `/public` before deployment.
- Kept Node 24.x.

## Genesis-024

- Added Early Signal Stack.
- Added Early Entry Engine.
- Added fair price, max buy, and value edge calculation.
- Added Kalshi orderbook pressure and odds movement tracking.
- Added Coinbase spot/candle/orderbook data panel.
- Added Binance Futures regime filter.
- Added Deribit volatility regime filter.
- Added six profiles: Balanced, Aggressive, Conservative, Early Trend, Late Sniper, No-Trade Guardian.
- Added result tracker and export.
- Preserved Diagnostics, Test API, Copy diagnostics, `/api/kalshi`, and `/api/candles`.

## v24.0.2 - Vercel Static Build Fix
- Changed `engines.node` to `24.x` to match Vercel's current default and avoid Node 20 deprecation failures.
- Added `scripts/vercel-build.js` and `vercel-build`/`build` scripts so Vercel does not try to run a Next.js build.
- The build script verifies required static/API files exist and then exits successfully.
