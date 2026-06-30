# Edge15 Genesis-013

## Focus
Self-evaluation and professional market-data expansion.

## Added
- Commitment Accuracy Tracker for the last 10 completed committed 15-minute windows.
- Automatic comparison of Edge15's locked prediction against completed candle outcome.
- Coinbase Exchange level-2 order book metrics.
- Order-book spread, midpoint, top-depth imbalance, and buy/sell pressure.
- Market Microstructure dashboard panel.
- Health API release label updated to Genesis-013.

## Notes
- Commitment tracking grades the locked minute-9 plan, not later risk warnings.
- Order book data is optional. If it fails, price/candle data still runs.
- Microstructure is evidence, not proof; it should support the decision engine, not override settlement reality.
