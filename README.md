# Edge15 Genesis-008

Genesis-008 is a safety correction and market-context upgrade for the working Edge15 Genesis line.

## Commit message

```text
Genesis-008: add settlement guardrails and 15m context
```

## What's new

- Settlement Reality Check stops bad late entries when price/time/distance do not support the side.
- Late signals are labeled through risk instead of using a blind final-minute lockout.
- Confidence is capped so Edge15 does not imply certainty.
- OVER wording is highlighted green and UNDER wording red across trade-plan context.
- Engine cards show current confidence versus a rolling in-browser average.
- Top dashboard now shows the last 10 completed 15-minute periods as UP/DOWN context.
- Genesis-007 helper descriptions and persistent trade context remain intact.

## Upload instructions

Upload the **contents** of this folder into the existing `woodsauce/edge15` GitHub repo root.

Do not upload the outer folder or ZIP.

After Vercel deploys, verify:

- Header says Genesis-008.
- Last 10 completed 15-minute periods show near the top.
- Settlement Risk shows normal/settlement mode and a late-entry risk message.
- Engine cards show Current vs Rolling avg.
- OVER words appear green and UNDER words red in trade-plan context.
- Pressing Entered OVER/UNDER keeps the trade context visible and adds Locked Position Mode below it.
