import { describe, expect, it } from 'vitest';
import { updateSignalPlan } from '@/lib/signal/signalPlan';
import type { Decision } from '@/lib/types/decision';
import type { Countdown } from '@/lib/position/countdown';

const countdownAfterCommit: Countdown = {
  windowStart: new Date('2026-06-29T07:45:00Z'),
  windowEnd: new Date('2026-06-29T08:00:00Z'),
  remainingMs: 4 * 60 * 1000,
  elapsedMs: 11 * 60 * 1000,
  display: '4:00',
  progress: 0.73,
};

const scoutCountdown: Countdown = {
  windowStart: new Date('2026-06-29T07:45:00Z'),
  windowEnd: new Date('2026-06-29T08:00:00Z'),
  remainingMs: 13 * 60 * 1000,
  elapsedMs: 2 * 60 * 1000,
  display: '13:00',
  progress: 0.13,
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
  it('stays in scout mode before 4:00-left test point', () => {
    const plan = updateSignalPlan({ previous: null, decision: decision('ENTER OVER', 'OVER'), countdown: scoutCountdown, now: new Date('2026-06-29T07:47:00Z') });
    expect(plan.commitmentStatus).toBe('SCOUTING');
    expect(plan.committedDirection).toBe('NONE');
    expect(plan.displayAction).toBe('READY OVER');
  });

  it('commits at 4:00-left test point when a clean edge exists', () => {
    const plan = updateSignalPlan({ previous: null, decision: decision('ENTER OVER', 'OVER'), countdown: countdownAfterCommit, now: new Date('2026-06-29T07:56:00Z') });
    expect(plan.commitmentStatus).toBe('COMMITTED');
    expect(plan.committedDirection).toBe('OVER');
    expect(plan.displayAction).toBe('COMMITTED OVER');
  });

  it('does not flip committed direction on one opposite read', () => {
    const first = updateSignalPlan({ previous: null, decision: decision('ENTER OVER', 'OVER'), countdown: countdownAfterCommit, now: new Date('2026-06-29T07:56:00Z') });
    const next = updateSignalPlan({ previous: first, decision: decision('ENTER UNDER', 'UNDER', 80, 83), countdown: countdownAfterCommit, now: new Date('2026-06-29T07:56:03Z') });
    expect(next.commitmentStatus).toBe('COMMITTED');
    expect(next.committedDirection).toBe('OVER');
    expect(next.direction).toBe('OVER');
    expect(next.displayAction.startsWith('COMMITTED OVER')).toBe(true);
  });

  it('commits no trade if 4:00-left evidence is weak', () => {
    const plan = updateSignalPlan({ previous: null, decision: decision('WAIT', 'NONE', 45, 38), countdown: countdownAfterCommit, now: new Date('2026-06-29T07:56:00Z') });
    expect(plan.commitmentStatus).toBe('NO TRADE');
    expect(plan.committedDirection).toBe('NONE');
    expect(plan.displayAction).toBe('NO TRADE COMMITTED');
  });
});
