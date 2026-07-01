# Edge15 Genesis-023

Edge15 Genesis-023 is the **8-Minute Commit Test** build.

This version moves the live commitment checkpoint from the prior 6:00-left area to about **8:00 remaining** while preserving the newer safety guardrails.

## What changed

- Live commitment test point is now **8:00 left**.
- Edge15 still does **not** force a trade at 8:00.
- It can still commit **NO TRADE** if the setup is weak.
- Trade Quality, Entry Value, final-3-minute protection, payout/value gates, auto-tightening, and late-flip protection remain active.
- Commit Timing Lab, Strategy Profile Lab, Performance Tracker, Version Lab, and backup/export data remain compatible.

## Why this exists

The Commit Timing Lab showed that 8:00 remaining may be a valuable earlier decision point. This build tests whether Edge15 can enter earlier while odds may still be better, without becoming reckless.

## Deploy

Upload the contents of this folder into the GitHub repo root and commit.

Recommended commit message:

```text
Genesis-023: test 8-minute commitment timing
```
