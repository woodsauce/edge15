# Edge15 Genesis-002.2

Kalshi parser patch for the Genesis live-data engine.

Upload the contents of this folder into the root of `woodsauce/edge15` and commit:

```text
Genesis-002.2: improve Kalshi strike and odds parsing
```

Then redeploy on Vercel and test:

- `/api/market-data`
- `/api/kalshi`
- Dashboard API Test button


## Genesis-002.2 patch

Adds derived reference target support for Kalshi up/down 15-minute BTC markets when Kalshi does not expose a traditional strike.
