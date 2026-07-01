# Edge15 Genesis-019

AI decision support for 15-minute BTC prediction markets.

## Genesis-019 focus

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
Genesis-019: add trade quality and auto-tightening
```


## Genesis-019

Performance Backup + Version Comparison release. Core Genesis-017 entry logic is preserved. Adds export, copy, and restore for performance data so results can be saved before cache clears or device/browser changes.
