# Edge15 Genesis-013.1

Edge15 is an AI decision-support dashboard for 15-minute Bitcoin prediction-market analysis.

## Genesis-013.1 additions

- Commitment Accuracy Tracker: automatically tracks whether Edge15's locked committed plan was correct for the last 10 completed 15-minute periods.
- Market Microstructure panel: adds Coinbase level-2 order book spread, midpoint, top-depth imbalance, and buy/sell pressure.
- Health endpoint now reports Genesis-013.1.

## Run locally

```bash
npm install
npm run dev
```

## Test

```bash
npm run typecheck
npm test -- --run
npm run build
```


## Genesis-013.1 Build Safety Patch

Adds TypeScript excludes so accidentally uploaded old release folders like `edge15-genesis-012.1/` do not get type-checked by Vercel. You should still delete old nested release folders from the GitHub repo root.
