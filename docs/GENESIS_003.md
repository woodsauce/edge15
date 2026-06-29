# Genesis-003: Countdown + Indicator Engine

Genesis-003 builds on the confirmed live-data route from Genesis-002.

## Scope

- 15-minute countdown remains synced to the current UTC 15-minute window.
- Indicator snapshot is calculated from 1-minute candles.
- Decision engine uses structure, momentum, VWAP, RSI, volatility, and distance to reference.
- Dashboard exposes the major calculated values so errors are easier to spot.

## Constitution checks

- Edge15 explains recommendations with Market Story and Why Not.
- Kalshi is still optional and cannot break price analysis.
- No ENTER recommendation is produced without confidence, stability, and opportunity checks.
