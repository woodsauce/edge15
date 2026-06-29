import type { Candle } from '@/lib/types/market';
import { ema } from './ema';
import { rsi } from './rsi';
import { vwap } from './vwap';
import { atr } from './atr';

export type IndicatorSnapshot = {
  ema9: number | null;
  ema21: number | null;
  rsi14: number | null;
  vwap: number | null;
  atr14: number | null;
  momentum5m: number | null;
  momentum15m: number | null;
  volatilityPct: number | null;
  trendBias: 'bullish' | 'bearish' | 'neutral';
  momentumBias: 'bullish' | 'bearish' | 'neutral';
  vwapBias: 'above' | 'below' | 'unknown';
};

export function calculateIndicatorSnapshot(candles: Candle[]): IndicatorSnapshot {
  const closes = candles.map((c) => c.close);
  const last = closes.at(-1) ?? null;
  const fiveBack = closes.at(-6) ?? closes[0] ?? null;
  const fifteenBack = closes.at(-16) ?? closes[0] ?? null;
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const rsi14 = rsi(closes, 14);
  const vwapValue = vwap(candles);
  const atr14 = atr(candles, 14);
  const momentum5m = last !== null && fiveBack !== null ? last - fiveBack : null;
  const momentum15m = last !== null && fifteenBack !== null ? last - fifteenBack : null;
  const volatilityPct = atr14 !== null && last !== null && last > 0 ? (atr14 / last) * 100 : null;

  return {
    ema9,
    ema21,
    rsi14,
    vwap: vwapValue,
    atr14,
    momentum5m,
    momentum15m,
    volatilityPct,
    trendBias: biasFromSpread(ema9, ema21),
    momentumBias: biasFromMomentum(momentum5m),
    vwapBias: last === null || vwapValue === null ? 'unknown' : last >= vwapValue ? 'above' : 'below',
  };
}

function biasFromSpread(short: number | null, long: number | null): 'bullish' | 'bearish' | 'neutral' {
  if (short === null || long === null) return 'neutral';
  const spread = short - long;
  if (spread > 8) return 'bullish';
  if (spread < -8) return 'bearish';
  return 'neutral';
}

function biasFromMomentum(momentum: number | null): 'bullish' | 'bearish' | 'neutral' {
  if (momentum === null) return 'neutral';
  if (momentum > 12) return 'bullish';
  if (momentum < -12) return 'bearish';
  return 'neutral';
}
