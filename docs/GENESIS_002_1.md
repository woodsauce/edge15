# Genesis-002.1 — Kalshi Parser Patch

Purpose: improve Kalshi market-context extraction without touching the working price/candle path.

Changes:
- Added defensive strike extraction from common market fields.
- Added text-based strike fallback from title/subtitle/rules/ticker.
- Added Kalshi orderbook lookup for YES/NO bid data.
- Infers YES ask from NO bid when Kalshi only returns bids.
- Adds `strikeSource` and `oddsSource` so the dashboard can show where values came from.
- Keeps Kalshi optional: missing strike/odds should never break BTC price data.

Test after deploy:
- `/api/market-data`
- `/api/kalshi`
- In-app API Test button

Good result:
- `kalshi.ticker` is not null.
- `kalshi.yesBid` or `kalshi.yesAsk` is populated when orderbook has liquidity.
- `kalshi.strike` is populated when Kalshi exposes a target/threshold field or includes it in text.
