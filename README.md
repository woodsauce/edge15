# Edge15 Genesis-012

Edge15 is an AI-assisted decision support system for 15-minute Bitcoin prediction markets.

## Genesis-012

This release adds the **Commitment Engine**:

- Scout Mode for the first 3 minutes.
- At minute 3, Edge15 commits to OVER, commits to UNDER, or declares NO TRADE.
- The committed prediction stays fixed for the rest of the 15-minute window.
- Management status can still warn HOLD / CAUTION / DANGER.
- Entry Gate Checklist is now horizontal.

## Upload instructions

Upload the contents of this folder to the root of `woodsauce/edge15` and commit:

```text
Genesis-012: add minute-3 commitment engine
```
