# Genesis-026: 4-Minute Commitment Test

Genesis-026 is a live timing experiment based on the growing Commit Timing Lab evidence.

## Main change

- Live commitment checkpoint moves to about **4:00 remaining**.
- Edge15 still does **not** force a trade at 4:00.
- If the setup is not clean, it can still commit **NO TRADE**.

## Why

Recent timing-lab data showed 4:00 remaining carrying the strongest usable blend of win rate, sample size, and no-trade balance. The 3:00 checkpoint remains very accurate in the lab but may be too late or too expensive without strong Entry Value confirmation.

## Preserved

- Pre-Commit Preview.
- Position Exit Engine.
- Entry Value Engine.
- Trade Quality guardrails.
- Commit Timing Lab.
- Strategy Profile Lab.
- Adaptive Commit Lab.
- Tracker Status and recheck controls.
- Backup/export/restore compatibility with Genesis-019+ storage.

## Notes

This is a test model. Compare it side-by-side against Genesis-019/020/021/025 before promoting the 4:00 lock as the main standard.
