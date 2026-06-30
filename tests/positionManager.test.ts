import { describe, expect, it } from 'vitest';
import { assessPosition } from '@/lib/position/positionManager';
import type { Decision } from '@/lib/types/decision';
import type { MarketSnapshot } from '@/lib/types/market';
import type { LockedPosition } from '@/lib/types/position';
import type { Countdown } from '@/lib/position/countdown';

const countdown: Countdown = {
  display: '10:00',
  remainingMs: 600000,
  elapsedMs: 300000,
  progress: 1 / 3,
  windowStart: new Date('2026-01-01T00:00:00Z'),
  windowEnd: new Date('2026-01-01T00:15:00Z'),
};

const position: LockedPosition = {
  side: 'OVER',
  entryTime: '2026-01-01T00:05:00Z',
  entryWindow: '10:00',
  entryPrice: 60000,
  entryStrike: 59980,
  entryAction: 'ENTER OVER',
  entryScore: 84,
  entryOpportunity: 86,
  entryConfidence: 82,
  entryStability: 74,
  entryGrade: 'A',
};

const snapshot: MarketSnapshot = {
  source: 'test',
  btcPrice: 60030,
  strike: 59980,
  candles: [],
  kalshi: null,
  health: { coinbase: 'ok', fallback: 'unknown', kalshi: 'ok' },
  diagnostics: {
    coinbase: { status: 'ok', latencyMs: 1, message: 'ok', updatedAt: null },
    fallback: { status: 'unknown', latencyMs: null, message: 'not needed', updatedAt: null },
    kalshi: { status: 'ok', latencyMs: 1, message: 'ok', updatedAt: null },
  },
  fetchedAt: null,
};

const decision: Decision = {
  action: 'ENTER OVER',
  tone: 'good',
  direction: 'OVER',
  entryScore: 82,
  entryQuality: 'Good',
  opportunity: 80,
  opportunityLabel: 'Good',
  tradeGrade: 'A',
  confidence: 80,
  stability: 72,
  reason: 'test',
  whyNot: [],
  story: 'test',
  indicators: {
    rsi14: 58,
    ema9: 60010,
    ema21: 59990,
    trendBias: 'bullish',
    vwap: 60000,
    vwapBias: 'above',
    atr14: 20,
    volatilityPct: 0.03,
    momentum5m: 30,
    momentum15m: 50,
    momentumBias: 'bullish',
  },
};

describe('position manager', () => {
  it('keeps favorable OVER positions in HOLD', () => {
    const result = assessPosition(position, snapshot, decision, countdown);
    expect(result.status).toBe('HOLD');
  });

  it('moves to danger when the live read strongly opposes the position', () => {
    const result = assessPosition(
      position,
      { ...snapshot, btcPrice: 59880 },
      { ...decision, direction: 'UNDER', confidence: 82, opportunity: 75 },
      { ...countdown, remainingMs: 60000, display: '01:00' },
    );
    expect(result.status).toBe('DANGER');
  });
});
