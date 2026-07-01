# Edge15 Genesis-023

Genesis-023 is the 8-Minute Commit Test build.

## Main change

- Moves the live commitment checkpoint to about 8:00 remaining.
- Keeps Trade Quality, Entry Value, auto-tightening, final-3-minute protection, late-flip protection, payout/value checks, and NO TRADE behavior active.
- Does not force a side at 8:00. If the setup is not clean enough, Edge15 commits NO TRADE.

## Purpose

The Commit Timing Lab suggested 8:00 remaining could be a useful earlier entry window. Genesis-023 tests whether an earlier commitment can capture better payout opportunity while maintaining enough accuracy.

## Preserved

- Performance Tracker data
- Commit Timing Lab data
- Strategy Profile Lab data
- Version Lab data
- Backup/export compatibility
