# Genesis-001

Codename: Genesis

Goal: establish the Edge15 foundation without overloading the first release.

## Acceptance checklist

- Project installs with `npm install`.
- App runs with `npm run dev`.
- `/api/health` returns `{ ok: true }`.
- `/api/market-data` returns a BTC price from Coinbase or fallback.
- Home screen shows countdown, BTC price, feed health, and starter recommendation.
- Kalshi failure does not break BTC price display.

## Known limits

- This is not the full AI Trading Desk yet.
- Historical Pattern Engine is not active yet.
- Ask AI is not active yet.
- Manual strike override is deferred to Genesis-002.
