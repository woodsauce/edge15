# Notes for Next Build

Genesis-025 should be judged separately from the normal Edge15 model.

Recommended test protocol:

1. Start the app early in the 15-minute market.
2. Only count predictions made from 10:00 through 9:00 remaining.
3. Track directional prediction accuracy separately from actual trade result.
4. After 50+ samples, compare:
   - 9:30 Predictor
   - 9:30 Aggressive
   - 9:30 Conservative
   - Value Hunter
   - Paper Test
5. Use the exported JSON/CSV to tune score, edge, and risk thresholds.

Potential v25.1 upgrades:

- Store the exact 10:00, 9:30, and 9:00 snapshots separately.
- Add a final settlement auto-check if authenticated Kalshi history is available.
- Add a confidence calibration chart for 9:30 predictions.
- Add a mode that only logs predictions and never shows trade language.
