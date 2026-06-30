import { describe, expect, it } from 'vitest';
import { updateSignalPlan } from '@/lib/signal/signalPlan';
import type { Decision } from '@/lib/types/decision';
import type { Countdown } from '@/lib/position/countdown';

const countdown: Countdown = {
  windowStart: new Date('2026-06-29T07:45:00Z'),
  windowEnd: new Date('2026-06-29T08:00:00Z'),
  remainingMs: 9 * 60 * 1000,
  elapsedMs: 6 * 60 * 1000,
  display: '9:00',
  progress: 0.4,
};

function decision(action: Decision['action'], direction: Decision['direction'], confidence = 82, opportunity = 84): Decision {
  return {
    action,
    tone: action.startsWith('ENTER') ? 'good' : 'warn',
    direction,
    entryScore: direction === 'UNDER' ? 24 : direction === 'OVER' ? 82 : 50,
    entryQuality: 'Test setup',
    opportunity,
    opportunityLabel: 'Good',
    tradeGrade: 'A',
    confidence,
    stability: 72,
    distanceToReference: direction === 'UNDER' ? -20 : direction === 'OVER' ? 20 : 0,
    secondsRemaining: 540,
    guardrails: [],
    settlement: { mode: 'normal', requiredMove: null, realisticMove: null, risk: 'Low', message: 'normal' },
    reason: 'Test reason',
    whyNot: ['Test why not'],
    story: 'Test story',
    indicators: {
      rsi14: 55,
      ema9: 100,
      ema21: 90,
      vwap: 95,
      atr14: 10,
      volatilityPct: 0.04,
      momentum5m: 12,
      momentum15m: 30,
      trendBias: direction === 'UNDER' ? 'bearish' : direction === 'OVER' ? 'bullish' : 'neutral',
      momentumBias: direction === 'UNDER' ? 'bearish' : direction === 'OVER' ? 'bullish' : 'neutral',
      vwapBias: direction === 'UNDER' ? 'below' : direction === 'OVER' ? 'above' : 'unknown',
    },
  };
}

describe('signal plan', () => {
  it('does not promote raw ENTER to ENTER on the first update', () => {
    const plan = updateSignalPlan({ previous: null, decision: decision('ENTER OVER', 'OVER'), countdown, now: new Date('2026-06-29T07:51:00Z') });
    expect(plan.displayAction).toBe('READY OVER');
  });

  it('requires repeated confirmation before ENTER', () => {
    let plan = updateSignalPlan({ previous: null, decision: decision('ENTER OVER', 'OVER'), countdown, now: new Date('2026-06-29T07:51:00Z') });
    plan = updateSignalPlan({ previous: plan, decision: decision('ENTER OVER', 'OVER'), countdown, now: new Date('2026-06-29T07:51:03Z') });
    expect(['READY OVER', 'ENTER OVER']).toContain(plan.displayAction);
  });

  it('does not instantly flip directions on one opposite read', () => {
    const first = updateSignalPlan({ previous: null, decision: decision('ENTER OVER', 'OVER'), countdown, now: new Date('2026-06-29T07:51:00Z') });
    const next = updateSignalPlan({ previous: first, decision: decision('ENTER UNDER', 'UNDER', 80, 83), countdown, now: new Date('2026-06-29T07:51:03Z') });
    expect(next.direction).toBe('OVER');
    expect(['HOLD OVER SIGNAL', 'CAUTION OVER']).toContain(next.displayAction);
  });
});
