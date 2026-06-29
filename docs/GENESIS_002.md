# Genesis-002: Live Data Engine

Genesis-002 upgrades Edge15 from a static foundation into a feed-aware live market shell.

## Added

- Coinbase Exchange as the primary BTC-USD ticker and 1-minute candle feed.
- Binance.US as a fallback feed if Coinbase fails.
- Kalshi KXBTC15M market lookup as optional context.
- `/api/health` now checks real feed status.
- `/api/market-data` returns detailed diagnostics.
- `/api/coinbase`, `/api/fallback`, and `/api/kalshi` test routes.
- Home-screen API Test button.
- Feed-specific status messages instead of generic `Data Error`.

## Design rule

Kalshi may be unavailable without breaking the price dashboard. Edge15 only enters a degraded state if both primary and fallback price feeds fail.
