import type { SignalPlan, SignalPlanInput, SignalStatus } from '@/lib/types/signal';
import type { Decision, Tone } from '@/lib/types/decision';

const STATUS_RANK: Record<SignalStatus, number> = {
  'NO PLAN': 0,
  BUILDING: 1,
  WATCH: 2,
  LEAN: 3,
  READY: 4,
  ENTER: 5,
  'HOLD SIGNAL': 4,
  CAUTION: 2,
  CANCELLED: 0,
};

export const SIGNAL_PLAN_STORAGE_KEY = 'edge15.signalPlan.v1';

export function contractKeyFromCountdown(windowStartIso: string) {
  return `15m:${windowStartIso}`;
}

export function updateSignalPlan({ previous, decision, countdown, now }: SignalPlanInput): SignalPlan {
  const contractKey = contractKeyFromCountdown(countdown.windowStart.toISOString());
  const nowIso = now.toISOString();
  const desiredDirection = decision.direction;
  const rawStatus = statusFromDecision(decision);
  const baseTone = toneFromStatus(rawStatus, decision.tone);

  if (!previous || previous.contractKey !== contractKey) {
    return createPlan(contractKey, desiredDirection, rawStatus, decision, countdown, nowIso, baseTone);
  }

  if (desiredDirection === 'NONE') {
    const weakened = previous.direction === 'NONE' ? 'NO PLAN' : previous.status === 'ENTER' || previous.status === 'READY' ? 'HOLD SIGNAL' : 'BUILDING';
    return withNarrative({
      ...previous,
      status: weakened,
      displayAction: displayFor(weakened, previous.direction),
      tone: weakened === 'HOLD SIGNAL' ? 'warn' : 'neutral',
      stability: Math.max(0, Math.round(previous.stability * 0.82)),
      confirmations: Math.max(0, previous.confirmations - 1),
      oppositePressure: 0,
      updatedAt: nowIso,
      rawAction: decision.action,
      rawDirection: decision.direction,
    }, decision, countdown);
  }

  if (previous.direction === 'NONE') {
    return createPlan(contractKey, desiredDirection, rawStatus, decision, countdown, nowIso, baseTone);
  }

  if (desiredDirection === previous.direction) {
    const confirmations = Math.min(20, previous.confirmations + confirmationBump(rawStatus));
    const status = stabilizeStatus(previous.status, rawStatus, confirmations, decision);
    const stability = calculateSignalStability(previous.stability, decision, confirmations, 0);
    const highestStatus = STATUS_RANK[status] > STATUS_RANK[previous.highestStatus] ? status : previous.highestStatus;
    return withNarrative({
      ...previous,
      status,
      displayAction: displayFor(status, previous.direction),
      tone: toneFromStatus(status, decision.tone),
      stability,
      confirmations,
      oppositePressure: Math.max(0, previous.oppositePressure - 1),
      updatedAt: nowIso,
      highestStatus,
      rawAction: decision.action,
      rawDirection: decision.direction,
    }, decision, countdown);
  }

  // Opposite direction detected. Do not flip immediately. Accumulate pressure and
  // only cancel/flip if the reversal is strong for multiple updates.
  const oppositePressure = previous.oppositePressure + oppositePressureBump(rawStatus, decision);
  const strongReversal = oppositePressure >= 8 && decision.confidence >= 74 && decision.opportunity >= 70;

  if (strongReversal) {
    const flipped = createPlan(contractKey, desiredDirection, 'BUILDING', decision, countdown, nowIso, 'warn');
    return withNarrative({
      ...flipped,
      status: 'BUILDING',
      displayAction: `NEW ${desiredDirection} PLAN BUILDING`,
      confirmations: 1,
      oppositePressure: 0,
      planText: `Previous ${previous.direction} plan was cancelled after sustained opposite pressure. New ${desiredDirection} plan is building, not instantly confirmed.`,
    }, decision, countdown);
  }

  const status: SignalStatus = previous.status === 'ENTER' || previous.status === 'READY' ? 'CAUTION' : 'HOLD SIGNAL';
  return withNarrative({
    ...previous,
    status,
    displayAction: displayFor(status, previous.direction),
    tone: 'warn',
    stability: Math.max(0, previous.stability - 8),
    confirmations: Math.max(0, previous.confirmations - 1),
    oppositePressure,
    updatedAt: nowIso,
    rawAction: decision.action,
    rawDirection: decision.direction,
  }, decision, countdown);
}

function createPlan(contractKey: string, direction: Decision['direction'], rawStatus: SignalStatus, decision: Decision, countdown: SignalPlanInput['countdown'], nowIso: string, tone: Tone): SignalPlan {
  const normalizedStatus: SignalStatus = direction === 'NONE' ? 'NO PLAN' : rawStatus === 'ENTER' ? 'READY' : rawStatus;
  const confirmations = direction === 'NONE' ? 0 : confirmationBump(normalizedStatus);
  return withNarrative({
    contractKey,
    direction,
    status: normalizedStatus,
    displayAction: displayFor(normalizedStatus, direction),
    tone,
    stability: Math.round(Math.max(0, Math.min(100, decision.stability * 0.72 + confirmations * 7))),
    confirmations,
    oppositePressure: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    highestStatus: normalizedStatus,
    planText: '',
    invalidation: '',
    nextStep: '',
    rawAction: decision.action,
    rawDirection: decision.direction,
  }, decision, countdown);
}

function statusFromDecision(decision: Decision): SignalStatus {
  if (decision.action === 'AVOID') return 'NO PLAN';
  if (decision.action === 'WAIT') return decision.direction === 'NONE' ? 'NO PLAN' : 'BUILDING';
  if (decision.action.startsWith('WATCH')) return 'WATCH';
  if (decision.action.startsWith('LEAN')) return 'LEAN';
  if (decision.action.startsWith('ENTER')) return 'ENTER';
  return 'BUILDING';
}

function stabilizeStatus(previousStatus: SignalStatus, rawStatus: SignalStatus, confirmations: number, decision: Decision): SignalStatus {
  if (rawStatus === 'NO PLAN') return previousStatus === 'ENTER' || previousStatus === 'READY' ? 'HOLD SIGNAL' : 'BUILDING';
  if (rawStatus === 'ENTER') {
    if (confirmations >= 6 && decision.stability >= 62 && decision.opportunity >= 76) return 'ENTER';
    if (confirmations >= 4) return 'READY';
    return previousStatus === 'ENTER' ? 'HOLD SIGNAL' : 'LEAN';
  }
  if (rawStatus === 'LEAN') return confirmations >= 4 ? 'READY' : 'LEAN';
  if (rawStatus === 'WATCH') return confirmations >= 3 ? 'LEAN' : 'WATCH';
  if (rawStatus === 'BUILDING') return previousStatus === 'ENTER' || previousStatus === 'READY' ? 'HOLD SIGNAL' : 'BUILDING';
  return rawStatus;
}

function displayFor(status: SignalStatus, direction: Decision['direction']) {
  if (direction === 'NONE' || status === 'NO PLAN') return 'NO PLAN';
  if (status === 'BUILDING') return `${direction} PLAN BUILDING`;
  if (status === 'HOLD SIGNAL') return `HOLD ${direction} SIGNAL`;
  if (status === 'CAUTION') return `CAUTION ${direction}`;
  if (status === 'CANCELLED') return 'CANCEL PLAN';
  return `${status} ${direction}`;
}

function toneFromStatus(status: SignalStatus, fallback: Tone): Tone {
  if (status === 'ENTER' || status === 'READY') return 'good';
  if (status === 'LEAN' || status === 'WATCH' || status === 'BUILDING' || status === 'HOLD SIGNAL' || status === 'CAUTION') return 'warn';
  if (status === 'CANCELLED') return 'bad';
  if (status === 'NO PLAN') return 'neutral';
  return fallback;
}

function confirmationBump(status: SignalStatus) {
  if (status === 'ENTER') return 3;
  if (status === 'LEAN' || status === 'READY') return 2;
  if (status === 'WATCH' || status === 'BUILDING') return 1;
  return 0;
}

function oppositePressureBump(status: SignalStatus, decision: Decision) {
  let bump = status === 'ENTER' ? 3 : status === 'LEAN' ? 2 : 1;
  if (decision.confidence >= 78) bump += 1;
  if (decision.opportunity >= 78) bump += 1;
  return bump;
}

function calculateSignalStability(previous: number, decision: Decision, confirmations: number, oppositePressure: number) {
  const target = decision.stability * 0.58 + decision.confidence * 0.18 + Math.min(20, confirmations * 4) - oppositePressure * 7;
  return Math.round(Math.max(0, Math.min(100, previous * 0.62 + target * 0.38)));
}

function withNarrative(plan: SignalPlan, decision: Decision, countdown: SignalPlanInput['countdown']): SignalPlan {
  const direction = plan.direction;
  const dirText = direction === 'NONE' ? 'No directional plan is active yet' : `${direction} remains the active plan`;
  const stableText = plan.stability >= 75 ? 'stable' : plan.stability >= 55 ? 'developing' : 'unstable';
  const confirmationText = plan.confirmations <= 0 ? 'no confirmations yet' : `${plan.confirmations} confirmation point${plan.confirmations === 1 ? '' : 's'}`;

  let planText = `${dirText}. Signal quality is ${stableText} with ${confirmationText}. Edge15 will not flip directions on a single refresh; it will hold, caution, or cancel the plan only if evidence changes enough.`;
  if (plan.status === 'ENTER') planText = `${direction} signal is confirmed. This is the first status where Edge15 considers the entry plan actionable.`;
  if (plan.status === 'READY') planText = `${direction} signal is nearly confirmed. Edge15 is waiting for one more stable push before calling ENTER.`;
  if (plan.status === 'CAUTION') planText = `${direction} plan is under pressure. Edge15 is not flipping yet, but the opposite side is gaining evidence.`;
  if (plan.status === 'NO PLAN') planText = 'No active plan. Edge15 is waiting for a directional idea to form before encouraging any entry.';

  const invalidation = direction === 'OVER'
    ? 'Invalidation: price loses VWAP while 5m momentum turns negative and Entry Score stays below 58 for multiple updates.'
    : direction === 'UNDER'
      ? 'Invalidation: price reclaims VWAP while 5m momentum turns positive and Entry Score stays above 42 for multiple updates.'
      : 'Invalidation: none yet because no trade plan is active.';

  const nextStep = buildNextStep(plan, decision, countdown.display);

  return { ...plan, planText, invalidation, nextStep };
}

function buildNextStep(plan: SignalPlan, decision: Decision, display: string) {
  if (plan.status === 'ENTER') return `Entry plan is confirmed with ${display} remaining. If you enter, press Entered ${plan.direction} so Edge15 switches into HOLD / CAUTION / DANGER mode.`;
  if (plan.status === 'READY') return `Wait for the signal to hold one more update or for Entry Score to stay strong above ${Math.max(76, decision.entryScore)}.`;
  if (plan.status === 'LEAN') return 'Plan is improving. Look for stability to rise above 68% and opportunity to remain above 76%.';
  if (plan.status === 'WATCH' || plan.status === 'BUILDING') return 'Let the plan build. Edge15 needs more agreement before showing ENTER.';
  if (plan.status === 'CAUTION') return 'Do not add. Wait to see if the original plan recovers or cancels.';
  if (plan.status === 'HOLD SIGNAL') return 'Original signal is weakening but not invalidated. Avoid chasing a fresh entry until it strengthens again.';
  return 'Wait for a cleaner directional plan.';
}
