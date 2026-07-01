# Edge15 Genesis-022

Entry Value Engine + Early Entry Lab.

## Added

- Entry Value Engine: BAD / FAIR / GOOD / GREAT.
- Estimated win probability compared against current Kalshi ask when available.
- Estimated edge read: Edge15 probability minus market ask.
- Risk/reward display: ask cost, upside, and risk.
- Early Entry Lab: tracks clean early setup idea without changing live logic.
- Commit Timing Lab now shows average ask and estimated timing edge when available.
- Timing leaderboard now separates best accuracy, best value, and best balance.
- UI overflow cleanup for Current Lock / SCOUT state.

## Preserved

- Genesis-017/018/019/020/021 trading logic.
- Commit Timing Lab storage keys.
- Performance Tracker storage keys.
- Version Lab and Strategy Profile Lab storage keys.

## Principle

A correct prediction can still be a bad trade if the entry price is too expensive. Genesis-022 starts measuring whether the trade is worth paying for, not just whether the side is likely correct.
