import type { Candle } from '@/lib/types/market';

export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length <= period) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i];
    const prev = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / slice.length;
}
