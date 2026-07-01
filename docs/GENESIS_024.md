# Genesis-024: Adaptive Commit Lab

## Purpose

Genesis-024 tests whether Edge15 can outperform fixed commitment times by committing when the setup becomes ready.

## Added

- Adaptive Commit Lab panel.
- Shadow adaptive commit records.
- Adaptive W/L, win rate, no-trade count, and recent records.
- Adaptive result resolution after the 15-minute window closes.
- Backup/export/restore support for adaptive commit records.
- Recheck Pending Results support for adaptive records.

## Adaptive commit modes

- EARLY_CLEAN: clean signal before the fixed 8:00 point.
- VALUE_ZONE: quality/value alignment between 8:00 and 4:00 remaining.
- FOUR_MINUTE_CONFIRM: final confirmation near the strongest observed usable timing zone.
- FINAL_EXCEPTION: rare final-window commit only when value is exceptional.
- NO_TRADE: no clean setup before final no-chase conditions.

## Preserved

- Genesis-023 live 8:00-left commitment test.
- Trade Quality.
- Entry Value.
- Commit Timing Lab.
- Strategy Profile Lab.
- Performance Tracker.
- Tracker Status.
- Backup/export compatibility.

## Important

Adaptive Commit Lab is shadow-only. It does not replace live trading logic yet.
