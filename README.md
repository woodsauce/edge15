# Edge15 Genesis-011

Edge15 is an AI-assisted decision support system for 15-minute BTC prediction markets.

## Genesis-011 focus

Genesis-011 is a clarity and safety release built on the working Genesis-010 foundation.

### Added

- Trade Review outcome buttons can be tapped again to unselect
- Trade Review reason buttons can be tapped again to unselect
- Clear / contract ended clears the active review card for the current position
- Entry Gate Checklist explains why a signal is READY instead of ENTER
- Late-entry warning
- Contradiction alert
- Do Not Chase warning
- Contract phase label: Early Read, Middle Confirmation, Settlement Mode, Final Seconds
- Confidence Heat Strip using recent live updates
- Trade Quality Filter: Any, B+ / A, or A-only
- Position Mode now shows whether Edge15 would still enter the same side now

### Not added

- “What Changed?” was intentionally left out per request.

### Still included

- Genesis-010 Trade Review + Learning Log
- Genesis-009 dashboard layout
- Genesis-008 settlement guardrails
- Genesis-007 helper descriptions and persistent trade context
- Genesis-006 AI Trading Desk
- Genesis-005 signal stability/trade plan
- Genesis-004 locked position manager
- Genesis-003 indicator engine
- Genesis-002 live data engine

## Upload to GitHub

Upload the contents of this folder into the root of `woodsauce/edge15` and commit:

```text
Genesis-011: add entry gates and signal clarity tools
```

Then let Vercel redeploy.
