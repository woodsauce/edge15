# Edge15 Genesis-026

Edge15 Genesis-026 is the **4-Minute Commit + Pre-Commit Preview + Position Exit Engine** build.

This version moves the live commitment checkpoint back to **4:00 remaining**, based on the latest Commit Timing Lab results showing 4 minutes as the strongest live timing zone. It keeps the 8:00, 6:00, 3:00, strategy-profile, and adaptive-commit testing labs running in the background while making 4:00 the live test point.

## What changed

- Live commitment moves to about **4:00 remaining**.
- Added **Pre-Commit Preview** so you can see what Edge15 is leaning toward before the official lock.
- Added **Position Exit Engine** after you press Entered OVER or Entered UNDER.
- Added **Hold Quality** and exit statuses: HOLD, WATCH CLOSELY, DANGER, CASH OUT SIGNAL.
- Long tracking is simplified to **all-time W/L**, no-trades, scored trades, and stored total.
- Removed the 1h / 4h / 12h / 24h rows from the Performance Tracker.
- Entry Value now handles missing Kalshi ask data more clearly with **model-only value** instead of pretending payout edge is known.
- Kalshi-unavailable payout logic no longer blocks early/mid-window reads; it becomes strict in the final 3 minutes.

## What did not change

- Trade Quality guardrails remain active.
- Entry Value remains observation/support unless ask data is available.
- Commit Timing Lab continues collecting timing data.
- Strategy Profile Lab continues collecting profile data.
- Adaptive Commit Lab remains shadow-only.
- Backup/export/restore remains compatible with Genesis-019 through Genesis-024 local storage.

## Deploy

Upload the **contents** of this folder into the GitHub repo root and commit.

Recommended commit message:

```text
Genesis-026: test 4-minute commitment timing
```
