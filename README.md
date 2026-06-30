# Edge15 Genesis-015

Edge15 is an AI decision-support dashboard for 15-minute Bitcoin prediction-market analysis.

## Genesis-015 focus

Performance tracking and late-window protection. This release adds automatic running win/loss stats and tightens behavior in the final 3 minutes, where BTC often flips and payout value can become too small to justify the risk.

## Genesis-015 changes

- Adds a Performance Tracker panel with all-time wins/losses plus 1 hour, 4 hour, 12 hour, and 24 hour windows.
- Expands stored commitment history from last 10 to up to 500 local records.
- Keeps NO TRADE separate from wins/losses so protective skips do not hurt win rate.
- Adds a final-3-minute chaos guard that blocks fresh late entries.
- Adds a payout-value gate using Kalshi ask pricing when available.
- Keeps Genesis-014 stricter accuracy guardrails and NO TRADE behavior.
- Dashboard version and health endpoint now report Genesis-015.

## Important tracking note

Genesis-015 tracks automatically while Edge15 is open in a browser. If every device is closed, a future cloud watcher/backend worker will be needed to keep recording and grading commitments in the background.

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
