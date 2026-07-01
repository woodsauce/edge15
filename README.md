# Edge15 Genesis-016

Edge15 is an AI decision-support dashboard for 15-minute Bitcoin prediction-market analysis.

## Genesis-016 focus

Focused cockpit cleanup. This release hides the panels the user is not using often and keeps the screen centered on the core trading decision, commitment status, risk/value gates, and performance tracking.

## Genesis-016 changes

- Hides Market Microstructure from the main dashboard.
- Hides Market Story from the main dashboard.
- Removes the Confidence Heat Strip from the main decision area.
- Hides Why Not / Trade Plan by default under advanced tools.
- Hides AI Debate; the optional AI panel now shows chief summary and engines only.
- Hides Trade Review + Learning Log from the main dashboard.
- Keeps Performance Tracker and Commitment Accuracy visible.
- Keeps Entry Gate Checklist, settlement risk, late-entry warnings, payout-value protection, and final-3-minute guard visible.
- Adds a focused version label: Selective accuracy • final 3m blocked.
- Dashboard version and health endpoint now report Genesis-016.

## Important tracking note

Performance tracking remains automatic while Edge15 is open in a browser. If every device is closed, a future cloud watcher/backend worker will be needed to keep recording and grading commitments in the background.

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
