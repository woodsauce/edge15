# Genesis-002.2 — Derived Target Patch

Kalshi's KXBTC15M "BTC price up in next 15 mins?" market may not expose a normal strike field. For this market style, Edge15 now derives a working reference target from the 1-minute candle closest to the contract open time.

## What changed

- Keeps Coinbase and fallback feeds unchanged.
- Keeps Kalshi market detection unchanged.
- When `kalshi.strike` is null, derives a reference from `closeTime - 15 minutes`.
- Uses the nearest 1-minute candle open within a 2-minute tolerance.
- Labels the value as a derived reference, not an official Kalshi settlement value.
- Updates dashboard language from Strike to Reference for this market type.

## Test

Open `/api/market-data`. You should now see:

```json
"strike": 59983.3,
"kalshi": {
  "strikeSource": "derived window open from 1m candles",
  "derivedStrike": true
}
```

The exact value will depend on the live 15-minute market window.
