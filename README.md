# Edge15 Genesis-021

AI decision support for 15-minute BTC prediction markets.

## Genesis-021 focus

Trade Quality + Auto-Tightening.

- Adds a simple Trade Quality score: AVOID / WEAK / DECENT / STRONG.
- Adds auto-tightening when recent Edge15 performance drops.
- Adds a late-market flip detector to reduce final-window chase entries.
- Adds trade replay snapshots for recent completed commitments.
- Keeps Genesis-016 focused cockpit layout.

## Deploy

Upload the contents of this folder to the GitHub repo root and commit.

Suggested commit message:

```text
Genesis-021: add trade quality and auto-tightening
```


## Genesis-021

Performance Backup + Version Comparison release. Core Genesis-017 entry logic is preserved. Adds export, copy, and restore for performance data so results can be saved before cache clears or device/browser changes.


## Genesis-021

Tracker Reliability + Timing Leaderboard release. Adds Tracker Status, Recheck Pending Results, clearer current-window capture visibility, pending-result counts, and preserves Genesis-019 timing/performance storage keys so data carries forward. Core trading logic remains unchanged from Genesis-017/018/019.


## Genesis-021 additions

- Version Lab for manually comparing Genesis builds side by side.
- Strategy Profile Lab for shadow-testing Aggressive, Balanced, Selective, Ultra Selective, Value Only, and No-Chase profiles without changing live trading logic.
- Backup/export now includes Version Lab and Strategy Profile Lab data.
- Core trading logic remains preserved from Genesis-017/020.
