# Edge15 Genesis-025 — 9:30 Predictor

A Vercel-ready BTC 15-minute Kalshi prediction dashboard focused on one test window: **10:00 through 9:00 remaining**.

## What this version is for

Genesis-025 is not the normal Edge15 flow. It is a focused paper-test model designed to answer:

> At roughly 9 to 10 minutes remaining, what side does the data favor?

The model still separates direction from trade quality:

- `TAKE YES/NO` means the 9:30 model likes the direction and the current contract price is acceptable.
- `PREDICT YES/NO / WAIT PRICE` means the model likes the direction, but the ask is too expensive.
- `PREDICT YES/NO / PAPER ONLY` means it has a directional read but trade filters are not satisfied.
- `WAIT FOR 10:00`, `STAGING`, or `WINDOW PASSED` means the current time is outside the intended test zone.

## Data used

The model uses:

- Kalshi KXBTC15M market discovery
- Kalshi target/strike price
- Kalshi YES/NO bid/ask
- Kalshi orderbook depth
- Kalshi recent trades/taker pressure
- Coinbase BTC spot price
- Coinbase candles
- Coinbase orderbook imbalance
- Binance Futures open interest/funding/regime fields
- Deribit BTC volatility-index regime
- Local in-browser market history since the app opened

Important caveat: Kalshi BTC markets settle from CF Benchmarks BRTI average, while Coinbase is only a proxy input.

## How to test

1. Open the app at the beginning of a new 15-minute BTC market.
2. Let it run so it can collect baseline/history.
3. Watch the model from 10:00 through 9:00 remaining.
4. Log the prediction after settlement using Log Win / Log Loss / Log No-Trade.
5. Export JSON or CSV after several rounds.

## Vercel settings

- Framework Preset: Other
- Build Command: `npm run vercel-build`
- Output Directory: `public`
- Install Command: `npm install`
- Node.js Version: `24.x`

## Main endpoints

- `/api/health`
- `/api/kalshi?series=KXBTC15M`
- `/api/btc`
- `/api/coinbase`
- `/api/candles`
- `/api/binance`
- `/api/deribit`
- `/api/all`
