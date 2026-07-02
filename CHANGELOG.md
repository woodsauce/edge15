# v24.0.5

- Fixed front-end live-data display issue where working `/api/kalshi` and `/api/btc` endpoints could still leave the dashboard blank if `/api/all` had nested/self-fetch problems.
- Direct browser endpoint calls are now primary.
- Added cache-busting to every refresh.
- Added fetch-mode row in Market Data.

# Edge15 Genesis-024 v24.0.4

- Added `/api/btc` multi-source BTC fallback: Coinbase, Kraken, Gemini, Bitstamp.
- Improved Kalshi discovery: searches markets and nested events for `KXBTC15M` instead of relying on one route.
- Added clearer diagnostics when Kalshi or spot-price data is missing.
- Updated app to use the BTC fallback before Binance/manual fallback.

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
