# Edge15 Genesis-024 — Early Signal Stack

This is a Vercel-ready Edge15 build focused on getting into BTC 15-minute Kalshi trades sooner **only when the edge is real**.

## What this version adds

- Early Entry Engine
- Fair Price / Max Buy Price
- Kalshi orderbook pressure
- Kalshi odds movement tracking
- Coinbase BTC price, 1-minute candles, and Level 2 orderbook imbalance. The app uses a light spot/orderbook refresh and refreshes candles separately instead of hammering candle history every 5 seconds.
- Binance Futures regime data: open interest, funding, mark price, 24h change
- Deribit BTC volatility regime data
- Signal Agreement Score across multiple profiles
- Stronger No-Trade Guard
- Result tracker with Win/Loss/No-Trade logging
- CSV/JSON export
- Diagnostics, Test API, Copy diagnostics
- Kept the safe Vercel API structure: `/api/kalshi`, `/api/candles`, `/api/coinbase`, `/api/binance`, `/api/deribit`, `/api/health`, `/api/all`

## Decision labels

- `TAKE YES` / `TAKE NO`: signal, timing, risk, and value line up.
- `WAIT FOR PRICE`: direction looks right, but the contract is too expensive.
- `WATCH DEVELOPING`: early signal is forming, but not clean enough yet.
- `SKIP`: no clean edge.
- `DATA NEEDED`: missing BTC price or Kalshi target.

## Vercel deployment

1. Unzip this folder.
2. Upload the folder contents to your `woodsauce/edge15` GitHub repo, or create a new repo.
3. In Vercel, import the repo.
4. Deploy with default settings.
5. Open the deployed URL.
6. Click **Test API**.

No build step is required. This is a static frontend with Vercel serverless API routes.

## Optional Kalshi environment variables

Public Kalshi market data may work without credentials. If orderbook or market endpoints return `401`, add these Vercel environment variables:

```text
KALSHI_KEY_ID=your-api-key-id
KALSHI_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
```

Optional base URL override:

```text
KALSHI_API_BASE_URL=https://external-api.kalshi.com/trade-api/v2
```

## How to use live

1. Open the app before the 15-minute market starts.
2. Wait for the app to find the current `KXBTC15M` market.
3. Watch the **Early Entry Engine** panel.
4. Only consider action when it shows `TAKE YES` or `TAKE NO`.
5. Use the displayed **Max Buy** price. If the contract is more expensive than Max Buy, wait or skip.
6. Log the result after the market closes.

## Manual fallback

If Kalshi does not expose the target cleanly, enter the target manually in **Manual fallback / overrides**. You can also manually enter YES/NO ask prices if the orderbook is unavailable.

## Important

This app does not place trades. It is a decision assistant and logger. Short-term prediction markets are risky, and the app can be wrong.


## Vercel deploy note

This patch removes the invalid `functions.runtime: nodejs20.x` entry from `vercel.json`. Vercel auto-detects JavaScript files in `/api` as Node.js Functions, and Node is pinned in `package.json` with `engines.node = 20.x`.


## v24.0.5 Frontend Live Display Fix

- Browser now calls `/api/kalshi`, `/api/btc`, `/api/coinbase`, `/api/binance`, and `/api/deribit` directly as the primary data path.
- `/api/all` is retained as a diagnostic cross-check only.
- Added cache-busting query strings to live fetches.
- Added fetch-mode visibility in Market Data.
