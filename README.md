# Edge15 Genesis-028 — Classic 4:30 Decision Helper

This version returns to the older Edge15 helper style: one clean final call, simple live-data cards, manual fallback inputs, result logging, and advanced details hidden by default.

## Main purpose

Genesis-028 is built to make its primary prediction in the **5:00 to 4:00 remaining window**, with the strongest intended read around **4:30 left**.

Before 5:00 remaining, the app stages/leans but should not be counted as the official Genesis-028 call. After 4:00 remaining, it labels the read as late/paper unless the user intentionally wants to track late entries.

## What it uses

- Kalshi active BTC 15-minute market discovery
- Kalshi target, YES/NO bid/ask, orderbook depth, and recent trades
- BTC spot fallback endpoint using Coinbase first, then fallback exchanges
- Coinbase book imbalance and candles
- Binance Futures regime inputs
- Deribit BTC volatility regime
- Manual fallback fields for BTC, target, YES/NO ask, and minutes remaining

## Main labels

- `TAKE YES` / `TAKE NO`: signal, timing, risk, and value agree.
- `WAIT PRICE YES/NO`: direction looks right, but the current ask is too expensive.
- `STAGING YES/NO`: model sees a lean before the 5:00–4:00 decision window.
- `LATE YES/NO / PAPER ONLY`: model sees a side after the target decision window.
- `LEAN YES/NO`: direction exists, but score is not strong enough.
- `SKIP / RISK YES/NO`: signal/value exists, but risk guard blocks it.
- `DATA NEEDED`: missing BTC price, target, or ask price.

## Vercel settings

Use the same working settings from the previous deploy:

```text
Framework Preset: Other
Build Command: npm run vercel-build
Output Directory: public
Install Command: npm install
Node.js Version: 24.x
```

## Upload instructions

1. Unzip this package.
2. Open the folder named `edge15-genesis-028-430-decision`.
3. Select everything inside that folder.
4. Upload those contents into the root of `woodsauce/edge15`.
5. Commit changes.
6. Let Vercel redeploy.
7. Hard refresh the deployed app with `Ctrl + F5`.

## Testing rule

Only count the official Genesis-028 model when the app shows:

```text
DECIDE NOW
LIVE 5:00–4:00 decision window
```

The app automatically saves one local 4:30 snapshot per market during that window. Export CSV/JSON includes both manual results and 4:30 snapshots.

## Important

This app does not place trades. It is a prediction and decision assistant. Prediction markets are risky, short-window BTC markets can reverse quickly, and the model can be wrong.
