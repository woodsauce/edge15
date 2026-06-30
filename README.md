# Edge15 Genesis-004

Countdown + indicator engine for the Genesis live-data foundation.

Upload the contents of this folder into the root of `woodsauce/edge15` and commit:

```text
Genesis-004: add countdown and indicator engine
```

Then let Vercel redeploy and test:

- `/`
- `/api/health`
- `/api/market-data`

## Added

- Bigger 15-minute countdown remains at top.
- Indicator engine output on dashboard:
  - RSI 14
  - EMA 9/21 bias
  - VWAP relationship
  - Momentum 5m
  - ATR 14
  - Volatility percent
- Decision engine now outputs:
  - Entry Score
  - Opportunity
  - Trade Grade
  - Confidence
  - Stability
  - Why Not panel
  - Better Market Story

## Not included yet

This is still Genesis core. Position manager, full AI Debate, historical pattern matching, and hide/show sections come later.


## Genesis-004

Adds locked trade mode and Position Manager: Entered OVER/UNDER, HOLD/CAUTION/DANGER, entry snapshot, post-entry warnings, and Clear / contract ended.
