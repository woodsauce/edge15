import type { Candle } from '@/lib/types/market';
import { ema } from './ema';
import { rsi } from './rsi';
import { vwap } from './vwap';
import { atr } from './atr';

export function calculateIndicatorSnapshot(candles: Candle[]) {
  const closes = candles.map((c) => c.close);
  const last = closes.at(-1) ?? null;
  const firstWindow = closes.at(-15) ?? closes[0] ?? null;
  const momentum = last !== null && firstWindow !== null ? last - firstWindow : null;
  return {
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    rsi14: rsi(closes, 14),
    vwap: vwap(candles),
    atr14: atr(candles, 14),
    momentum15m: momentum,
  };
}
