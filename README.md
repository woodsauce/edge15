# Edge15 Genesis-014

Edge15 is an AI decision-support dashboard for 15-minute Bitcoin prediction-market analysis.

## Genesis-014 focus

Accuracy and capital protection. This release intentionally makes Edge15 harder to trigger into ENTER. The goal is fewer bad entries, clearer NO TRADE behavior, and stronger protection when price/time/strike reality disagrees with the directional read.

## Genesis-014 changes

- Stricter ENTER thresholds: opportunity, stability, confidence, and settlement risk must all line up.
- Commitment protection: minute-9 commitment now chooses NO TRADE when the setup is weak, on the wrong side of the reference, or carrying High/Extreme settlement risk.
- Settlement Reality Check expanded from the final 2 minutes to the final 6 minutes.
- Wrong-side-of-strike protection during the commitment half of the window.
- Confidence caps lowered so Edge15 does not imply certainty.
- Order-book pressure is included as a small supporting signal, not a primary signal.
- Desktop cleanup: wider horizontal Entry Gate Checklist and compact Confidence Heat Strip.
- Health endpoint now reports Genesis-014.

## Run locally

```bash
npm install
npm run dev
```

## Test

```bash
npm run typecheck
npm test -- --run
npm run build
```
