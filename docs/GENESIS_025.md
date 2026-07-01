# Genesis-025: 6-Minute Commit + Pre-Commit Preview + Position Exit Engine

Genesis-025 is a focused trading-control release.

## Main changes

- Live commitment checkpoint moved back to 6:00 remaining.
- Pre-Commit Preview added to show the projected pick before lock.
- Position Exit Engine added to help manage active trades after entry.
- Long-term Performance Tracker simplified to all-time W/L and no-trades.
- Entry Value handles Kalshi ask outages with model-only value mode.

## Position Exit statuses

- HOLD: original thesis still healthy.
- WATCH CLOSELY: thesis is weakening, but not broken.
- DANGER: multiple warning signs are present.
- CASH OUT SIGNAL: strong evidence that the original trade thesis is breaking.

## Notes

Genesis-025 does not promote adaptive commit to live mode yet. It preserves the labs and focuses on making the live 6:00 commitment easier to anticipate and manage.
