# Edge15 Genesis-019 — Commit Timing Lab

Genesis-019 preserves the Genesis-017/018 live trading logic and adds a shadow commit timing lab.

## Added
- Shadow checkpoints at 12:00, 10:00, 8:00, 6:00, 4:00, and 3:00 remaining.
- Automatic scoring after each 15-minute window closes.
- Timing table with wins, losses, win rate, no-trade counts, and average ask read when available.
- Current-window checkpoint chips so the user can see which timing tests were captured.
- Backup/export now includes timing-lab records.

## Important
This release does not change the live recommendation engine. It only collects evidence about which commitment time performs best.

## Testing
- npm run typecheck
- npm test -- --run
- npm run build
