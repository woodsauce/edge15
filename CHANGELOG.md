# Changelog

## v25.0.0 — Genesis-025 9:30 Predictor

- Created a separate 9:00–10:00 remaining prediction model.
- Added strict time-window handling for the 10:00 through 9:00 remaining test zone.
- Added model states: staging, live window, post-window, and window passed.
- Added direction-vs-trade separation:
  - `TAKE YES/NO`
  - `PREDICT YES/NO / WAIT PRICE`
  - `PREDICT YES/NO / PAPER ONLY`
  - `SKIP / TOO WEAK`
- Added Kalshi recent trade-pressure scoring.
- Added baseline move scoring from the first tracked print in the current market.
- Added 9:30 signal alignment scoring.
- Added auto 9:30 snapshots saved to local storage once per market during the target window.
- Updated result exports to include model, market age, 9:30 window flag, strength, score, edge, and auto snapshots.
- Kept the v24.0.5 live display fixes and direct endpoint fetching.
