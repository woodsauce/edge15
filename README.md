# Edge15 Genesis-001

Edge15 is an AI decision-support platform for 15-minute BTC prediction markets.

Genesis-001 is the foundation release. It intentionally focuses on the core project structure and live data shell before adding the full AI Trading Desk.

## What is included

- Next.js + TypeScript app structure
- Tailwind mobile-first UI
- Vercel-ready API routes
- Coinbase market data service
- Binance.US fallback service
- Kalshi BTC 15m market context service
- Health endpoint
- Countdown engine
- Indicator scaffolding: EMA, RSI, VWAP, ATR
- Starter decision engine
- Edge15 Constitution
- Vitest test setup

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Test

```bash
npm run typecheck
npm test
npm run build
```

## API routes

- `/api/health`
- `/api/market-data`
- `/api/coinbase`
- `/api/kalshi`

## Deploy to Vercel

Connect the GitHub repository to Vercel and deploy normally. No environment variables are required for Genesis-001.

## Next milestone: Genesis-002

- Better data diagnostics
- Full health dashboard
- Manual strike override
- Flight recorder shell
- Better decision scoring tests
