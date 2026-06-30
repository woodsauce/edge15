# Edge15 Genesis-015

## Focus

Automatic performance tracking and late-window protection.

## Changes

- Added running/all-time Edge15 wins, losses, win rate, resolved count, and NO TRADE count.
- Added rolling windows for the last 1 hour, 4 hours, 12 hours, and 24 hours.
- Increased local commitment result storage to 500 records.
- Added final-3-minute chaos guard to block fresh late entries.
- Added payout-value gate so late expensive entries are rejected when the upside is too small.
- Preserved Genesis-014 accuracy and capital-protection behavior.

## Tracking limitation

The browser can automatically score observed commitments while Edge15 is open. A backend watcher is required for true 24/7 scoring when all devices are closed.
