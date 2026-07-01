# Edge15 Genesis-024

Edge15 Genesis-024 is the **Adaptive Commit Lab** build.

This version preserves the Genesis-023 live 8:00-left commitment test, but adds a shadow engine that tests a smarter idea: **commit when the setup is ready**, not just when a fixed clock time arrives.

## What changed

- Added **Adaptive Commit Lab**.
- Adaptive shadow mode can commit early, wait into the 8:00–4:00 value zone, confirm near 4:00, or record NO TRADE before the final no-chase zone.
- Adaptive decisions are tracked separately from live trading logic.
- Adaptive records are included in backup/export/restore and pending-result rechecks.
- Tracker Status includes adaptive lab records in stored/pending counts.
- Existing Genesis-019/020/021/022/023 performance, timing, version, and strategy storage remain compatible.

## What did not change

- Live trading logic still uses the Genesis-023 8:00-left test behavior.
- Adaptive Commit Lab is observation-only for now.
- Trade Quality, Entry Value, final-3-minute protection, payout/value gates, auto-tightening, late-flip protection, Commit Timing Lab, Strategy Profile Lab, Performance Tracker, and backup/export are preserved.

## Why this exists

The fixed timing tests showed that 8:00, 6:00, 4:00, and 3:00 remaining each have different strengths. Genesis-024 starts testing whether Edge15 can do better by waiting for the right combination of confidence, trade quality, entry value, stability, low flip risk, and acceptable payout.

## Deploy

Upload the contents of this folder into the GitHub repo root and commit.

Recommended commit message:

```text
Genesis-024: add adaptive commit lab
```
