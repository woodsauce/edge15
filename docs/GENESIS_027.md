# Genesis-027: Clean Cockpit + Stable Preview

Genesis-027 is a UI cleanup and preview-stability release.

## Goals

- Reduce dashboard clutter.
- Hide panels the user is not using often.
- Keep labs/tracking running in the background.
- Make the pre-commit read less jumpy.
- Keep Genesis-026 4-minute live commit behavior intact.

## Main changes

- Added a cleaner main cockpit.
- Hid Tracker Status, Commitment Accuracy, Backup + Compare, Entry Value panel, Commit Timing Lab, Adaptive Commit Lab, Strategy Profile Lab, Decision Details, Entry Gate Checklist, and position entry buttons by default.
- Removed Version Lab from the visible dashboard.
- Added show/hide controls for optional panels.
- Changed Pre-Commit Preview to Stable Lock Candidate.

## Stable Lock Candidate rules

The preview only shows OVER or UNDER when the setup is mature enough and stable enough. Otherwise it shows NO TRADE.

A playable preview requires:

- 2+ confirmations
- mature signal plan
- Trade Quality DECENT or STRONG
- Entry Value not BAD
- no High flip risk
- no High/Extreme settlement risk

## Preserved

- 4-minute live commitment test.
- Entry Value Engine background calculations.
- Commit Timing Lab background tracking.
- Strategy Profile Lab background tracking.
- Adaptive Commit Lab background tracking.
- Position Exit Engine.
- Performance Tracker all-time records.
- Backup/export/restore compatibility.
