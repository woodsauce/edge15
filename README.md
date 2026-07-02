# Edge15 Genesis-027

Edge15 Genesis-027 is the **Clean Cockpit + Stable Preview** build.

This version keeps the Genesis-026 4-minute live commitment test and the existing tracking/lab engines, but reorganizes the app so the main screen is cleaner and less overwhelming.

## What changed

- Main screen is now focused on a smaller **Clean Cockpit**.
- Tracker Status is hidden by default.
- Commitment Accuracy is hidden by default.
- Backup + Compare is hidden by default.
- Entry Value Engine panel is hidden by default.
- Commit Timing Lab is hidden by default.
- Adaptive Commit Lab is hidden by default.
- Strategy Profile Lab is hidden by default.
- Version Lab is no longer shown in the cockpit.
- Decision details / Entry Gate Checklist are hidden by default.
- Entered OVER / Entered UNDER buttons are hidden by default under **Position Controls**.
- Pre-Commit Preview was changed into a more stable **Stable Lock Candidate** read.

## Stable Lock Candidate

The old preview could change too often because it followed the raw live read. Genesis-027 only shows a playable projected side when several conditions line up:

- mature signal plan
- 2+ confirmations
- stable direction
- Trade Quality at least DECENT
- Entry Value not BAD
- flip risk not HIGH
- settlement risk not HIGH / EXTREME

If those conditions are not met, the preview shows **NO TRADE** instead of bouncing between sides.

## What did not change

- Live commit remains around **4:00 remaining**.
- Entry Value Engine still runs in the background.
- Commit Timing Lab still tracks in the background.
- Strategy Profile Lab still tracks in the background.
- Adaptive Commit Lab still tracks in the background.
- Performance Tracker still stores all-time W/L.
- Position Exit Engine still works after a position is locked.
- Backup/export/restore compatibility is preserved.

## Deploy

Upload the **contents** of this folder into the GitHub repo root and commit.

Recommended commit message:

```text
Genesis-027: clean cockpit and stabilize preview
```
