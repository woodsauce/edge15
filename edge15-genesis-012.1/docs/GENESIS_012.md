# Genesis-012.1 — Minute-9 Commitment Engine

Genesis-012.1 updates the contract-level Commitment Engine.

## Added

- Minute-9 Scout Mode / Commitment Mode.
- At roughly 6:00 remaining, Edge15 commits to OVER, commits to UNDER, or declares No Trade.
- Once committed, the prediction side remains locked for the rest of the 15-minute contract.
- After commitment, Edge15 changes only the management status: HOLD / CAUTION / DANGER style context.
- Commitment status card at the top of the trade plan.
- Entry Gate Checklist changed from vertical to horizontal cards.

## Purpose

This fixes the confusing behavior where Edge15 could change its preferred side throughout the same 15-minute window. Genesis-012.1 separates:

- Opening evidence gathering.
- The minute-9 contract prediction.
- Post-commitment risk management.

Edge15 can still warn that a committed call is weakening, but it will not flip the committed prediction side inside the same contract.
