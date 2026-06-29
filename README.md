# Edge15 Genesis-002

Edge15 is an AI decision-support platform for 15-minute BTC prediction markets.

Genesis-002 focuses on the live data foundation:

- Next.js + TypeScript + Tailwind
- Coinbase Exchange primary BTC feed
- Binance.US fallback BTC feed
- Kalshi KXBTC15M optional market context
- Feed-specific diagnostics
- Health endpoint
- Market data endpoint
- Mobile-first live dashboard

## Run locally

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

Test endpoints:

```text
/api/health
/api/market-data
/api/coinbase
/api/fallback
/api/kalshi
```

## Deploy

Push the full project contents to `https://github.com/woodsauce/edge15`, then Vercel will redeploy from GitHub.

## Release notes

See `docs/GENESIS_002.md`.
