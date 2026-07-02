# Changelog

## Genesis-028 v28.0.0

- Returned to the classic Edge helper layout.
- Replaced heavy cockpit UI with a single big final-call panel.
- Added default 4:30 Decision mode.
- Main official decision window is now 5:00–4:00 remaining.
- Before 5:00, the app shows staging/lean reads.
- After 4:00, the app shows late/paper-only reads unless another mode is selected.
- Kept live Kalshi/BTC direct endpoint fetches from the working v24.0.5 path.
- Added manual minutes override for testing the 5:00–4:00 behavior.
- Added one automatic 4:30 snapshot per market.
- Added combined export of result logs and 4:30 snapshots.
- Kept Advanced diagnostics hidden by default.
