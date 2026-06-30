import { describe, expect, it } from 'vitest';
import { ema } from '@/lib/indicators/ema';
import { rsi } from '@/lib/indicators/rsi';

const prices = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16];

describe('indicator basics', () => {
  it('calculates EMA when enough values exist', () => {
    expect(ema(prices, 9)).not.toBeNull();
  });

  it('returns null when EMA has too few values', () => {
    expect(ema([1, 2], 9)).toBeNull();
  });

  it('calculates RSI for rising prices', () => {
    const value = rsi(prices, 14);
    expect(value).not.toBeNull();
    expect(value ?? 0).toBeGreaterThan(90);
  });
});
