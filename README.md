# Edge15 Genesis-007

Genesis-007 is a clarity and usability upgrade for the working Edge15 Genesis line.

## Commit message

```text
Genesis-007: add entry helpers and persistent trade context
```

## What's new

- Entry-mode boxes now include short descriptions directly inside the cards.
- Entry Score, Opportunity, Trade Grade, Model Trust, and Signal Stability explain what they mean.
- Trade Plan context stays visible after pressing Entered OVER or Entered UNDER.
- Locked Position Mode now adds HOLD / CAUTION / DANGER below the trade context instead of replacing it.
- Genesis-006 AI Trading Desk, Genesis-005 signal stability, and Genesis-004 position mode remain intact.

## Upload instructions

Upload the **contents** of this folder into the existing `woodsauce/edge15` GitHub repo root.

Do not upload the outer folder or ZIP.

After Vercel deploys, verify:

- Header says Genesis-007.
- Main metric boxes show descriptions.
- Pressing Entered OVER/UNDER keeps Trade Plan, Entry Score, Opportunity, Trade Grade, Model Trust, and Signal Stability visible.
- Locked Position Mode appears below the trade context.
