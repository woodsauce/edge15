# Genesis-005 — Signal Stability + Trade Plan

Genesis-005 stabilizes pre-entry advice so Edge15 does not constantly flip its recommendation during the same 15-minute window.

## Added

- Contract-level signal plan
- NO PLAN / BUILDING / WATCH / LEAN / READY / ENTER ladder
- Signal confirmation points
- Flip protection
- HOLD SIGNAL / CAUTION behavior before trade entry
- Signal Stability meter
- Next Step panel
- Invalidation panel
- Raw model read display
- Local storage persistence for the active signal plan

## Trading behavior

The raw decision engine still updates every refresh, but Genesis-005 smooths that raw output into a trade plan. A single refresh is no longer enough to flip from OVER to UNDER or from ENTER to WAIT.

If a user enters a trade, Genesis-004 position mode remains active and switches the app into HOLD / CAUTION / DANGER management.
