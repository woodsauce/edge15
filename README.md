# Edge15 Genesis-009

Genesis-009 is a dashboard layout correction release. It keeps the working Genesis-008 decision and settlement guardrails, but reorganizes the main screen into a cleaner dashboard-style interface.

Commit message:

```text
Genesis-009: redesign dashboard layout and hide unreliable period strip
```

## What changed

- New dashboard-style top layout.
- Big countdown and current trade plan now sit together in the primary hero area.
- Market snapshot is beside the main decision area instead of buried lower on the page.
- Decision metrics are grouped into a clear dashboard card.
- Position mode is embedded inside the decision dashboard instead of replacing context.
- The incorrect “last 10 completed 15-minute periods” strip is hidden until period-boundary logic is verified.
- OVER words remain green and UNDER words remain red.
- Genesis-008 settlement guardrails remain intact.
- Genesis-007 helper descriptions, Genesis-006 AI Trading Desk, Genesis-005 stability, and Genesis-004 position mode remain intact.

## How to install

Upload the contents of this folder to the existing `woodsauce/edge15` GitHub repo root.

## How to test

1. Confirm Vercel deployment is Ready.
2. Open the app and confirm the header says Genesis-009.
3. Confirm the dashboard shows: Time Remaining, Current Trade Plan, Market Snapshot, Decision Dashboard, and Market Story.
4. Confirm Entry Score, Opportunity, Trade Grade, Model Trust, Signal Stability, and Settlement Risk still display.
5. Press Entered OVER/UNDER and confirm the locked position panel appears without hiding the decision metrics.
6. Confirm the last-10 completed-period strip is no longer visible.
