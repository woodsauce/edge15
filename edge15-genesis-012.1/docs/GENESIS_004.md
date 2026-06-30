# Genesis-004 — Position Manager

Genesis-004 adds locked trade mode.

## Added

- `Entered OVER` and `Entered UNDER` buttons in Entry Mode.
- Local locked-position storage with `localStorage`.
- Position Manager that switches from entry advice to:
  - `HOLD`
  - `CAUTION`
  - `DANGER`
- Entry snapshot:
  - side
  - entry time
  - entry price
  - entry strike/reference
  - Entry Score
  - Opportunity
  - Confidence
  - Stability
  - Trade Grade
- Post-entry warnings and Position Story.
- Clear / contract ended button.

## Rule added by behavior

Once a position is locked, Edge15 stops saying ENTER/WATCH/LEAN as the main action. It manages the position instead.

