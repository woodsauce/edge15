# Edge15 Genesis-005

Signal Stability + Trade Plan for the Edge15 Genesis foundation.

Upload the **contents** of this folder into the root of `woodsauce/edge15` and commit:

```text
Genesis-005: add signal stability and trade plan
```

Then let Vercel redeploy and test:

- `/`
- `/api/health`
- `/api/market-data`

## Added

- Contract-level signal plan for the active 15-minute window
- NO PLAN / BUILDING / WATCH / LEAN / READY / ENTER ladder
- Signal Stability meter
- Confirmation points before ENTER
- Flip protection so one refresh cannot instantly reverse direction
- HOLD SIGNAL / CAUTION states before entry
- Next Step panel
- Invalidation panel
- Raw model read display
- Local storage persistence for the active signal plan

## Kept from Genesis-004

- Entered OVER / Entered UNDER buttons
- Locked trade snapshot
- Position mode
- HOLD / CAUTION / DANGER after entry
- Clear / contract ended button

## Why this matters

Genesis-005 fixes the pre-entry whipsaw problem. Edge15 still recalculates every refresh, but the dashboard now shows a stabilized trade plan instead of treating every 3-second update as a brand-new recommendation.
