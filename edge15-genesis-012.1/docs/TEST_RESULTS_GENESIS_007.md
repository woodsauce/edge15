# Test Results — Genesis-007

- TypeScript typecheck: pass
- Unit tests: pass
- Next.js production build: pass through page generation; local container may timeout during trace collection depending on environment

Manual checks to run after Vercel deploy:

1. Confirm the header says Genesis-007.
2. Confirm Trade Plan, Entry Score, Opportunity, Trade Grade, Model Trust, and Signal Stability all show helper descriptions.
3. Press Entered OVER or Entered UNDER.
4. Confirm the same trade-context panel remains visible.
5. Confirm Locked Position Mode appears below it.
6. Refresh the page and confirm the locked position and trade context remain visible.
7. Clear the position and confirm entry buttons return.
