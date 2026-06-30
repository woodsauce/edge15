# Genesis-002.3 — Route-Level Derived Target Patch

This patch makes `/api/market-data` derive the working 15-minute reference target directly inside the route response when Kalshi returns `strike: null`.

Why this exists:

- Coinbase live price and candles are working.
- Kalshi market detection is working.
- The current Kalshi title, `BTC price up in next 15 mins?`, does not expose a normal numeric strike in the title or market fields.
- Edge15 still needs a working target for distance-to-reference calculations.

The route now derives the target from the 1-minute candle closest to the 15-minute window open:

`derived strike = open price of the candle closest to closeTime - 15 minutes`

This is a trading reference for Edge15, not an official Kalshi settlement value.

Expected `/api/market-data` fields after deployment:

```json
{
  "strike": 59983.3,
  "kalshi": {
    "strike": 59983.3,
    "strikeSource": "derived window open from 1m candles",
    "derivedStrike": true
  }
}
```
