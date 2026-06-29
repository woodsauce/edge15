import type { Candle } from '@/lib/types/market';

export function vwap(candles: Candle[]): number | null {
  let pv = 0;
  let volume = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    volume += c.volume;
  }
  return volume > 0 ? pv / volume : null;
}
