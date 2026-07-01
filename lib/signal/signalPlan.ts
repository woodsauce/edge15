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

export const SIGNAL_PLAN_STORAGE_KEY = 'edge15.signalPlan.v2.commitment';
const COMMIT_AFTER_MS = 9 * 60 * 1000;

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
    const created = createPlan(contractKey, desiredDirection, rawStatus, decision, countdown, nowIso, baseTone);
    return maybeCommit(created, decision, countdown, nowIso);
  }

  // Once Edge15 commits after minute 9, the prediction side stays fixed for the
  // rest of the contract. The display may move to HOLD/CAUTION/DANGER-style
  // management, but the committed answer does not flip.
  if (previous.commitmentStatus === 'COMMITTED') {
    return updateCommittedPlan(previous, decision, countdown, nowIso);
  }
  if (previous.commitmentStatus === 'NO TRADE') {
    return withNarrative({
      ...previous,
      direction: 'NONE',
      status: 'NO PLAN',
      displayAction: 'NO TRADE COMMITTED',
      tone: 'neutral',
      stability: Math.max(0, Math.round(previous.stability * 0.96)),
      confirmations: previous.confirmations,
      oppositePressure: 0,
      updatedAt: nowIso,
      rawAction: decision.action,
      rawDirection: decision.direction,
    }, decision, countdown);
  }

  let next: SignalPlan;
  if (desiredDirection === 'NONE') {
    const weakened = previous.direction === 'NONE' ? 'NO PLAN' : previous.status === 'ENTER' || previous.status === 'READY' ? 'HOLD SIGNAL' : 'BUILDING';
    next = withNarrative({
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
    return maybeCommit(next, decision, countdown, nowIso);
  }

  if (previous.direction === 'NONE') {
    next = createPlan(contractKey, desiredDirection, rawStatus, decision, countdown, nowIso, baseTone);
    return maybeCommit(next, decision, countdown, nowIso);
  }

  if (desiredDirection === previous.direction) {
    const confirmations = Math.min(20, previous.confirmations + confirmationBump(rawStatus));
    const status = stabilizeStatus(previous.status, rawStatus, confirmations, decision);
    const stability = calculateSignalStability(previous.stability, decision, confirmations, 0);
    const highestStatus = STATUS_RANK[status] > STATUS_RANK[previous.highestStatus] ? status : previous.highestStatus;
    next = withNarrative({
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
    return maybeCommit(next, decision, countdown, nowIso);
  }

  const oppositePressure = previous.oppositePressure + oppositePressureBump(rawStatus, decision);
  const strongReversal = oppositePressure >= 8 && decision.confidence >= 74 && decision.opportunity >= 70;

  if (strongReversal) {
    const flipped = createPlan(contractKey, desiredDirection, 'BUILDING', decision, countdown, nowIso, 'warn');
    next = withNarrative({
      ...flipped,
      status: 'BUILDING',
      displayAction: `NEW ${desiredDirection} PLAN BUILDING`,
      confirmations: 1,
      oppositePressure: 0,
      planText: `Previous ${previous.direction} plan was cancelled after sustained opposite pressure. New ${desiredDirection} plan is building, not instantly confirmed.`,
    }, decision, countdown);
    return maybeCommit(next, decision, countdown, nowIso);
  }

  const status: SignalStatus = previous.status === 'ENTER' || previous.status === 'READY' ? 'CAUTION' : 'HOLD SIGNAL';
  next = withNarrative({
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
  return maybeCommit(next, decision, countdown, nowIso);
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
    commitmentStatus: 'SCOUTING',
    committedDirection: 'NONE',
    committedAt: null,
    commitmentReason: 'Scout Mode: Edge15 has not reached the minute-9 commitment point yet.',
    committedEntryScore: null,
    committedConfidence: null,
    committedTradeGrade: null,
    committedSettlementRisk: null,
    committedPrice: null,
    committedDistance: null,
  }, decision, countdown);
}

function maybeCommit(plan: SignalPlan, decision: Decision, countdown: SignalPlanInput['countdown'], nowIso: string): SignalPlan {
  const elapsedMs = countdown.elapsedMs;
  if (elapsedMs < COMMIT_AFTER_MS) {
    return withNarrative({
      ...plan,
      commitmentStatus: 'SCOUTING',
      committedDirection: 'NONE',
      committedAt: null,
      commitmentReason: `Scout Mode until minute 9. Edge15 is gathering evidence and will not lock the contract prediction yet.`,
    }, decision, countdown);
  }

  const wrongSideAtCommitment = plan.direction === 'OVER'
    ? decision.distanceToReference !== null && decision.distanceToReference < 0
    : plan.direction === 'UNDER'
      ? decision.distanceToReference !== null && decision.distanceToReference > 0
      : false;
  const commitmentTooWeak = decision.opportunity < 62 || decision.confidence < 58 || decision.stability < 58 || decision.entryScore > 44 && decision.entryScore < 56;

  if (plan.direction === 'NONE' || commitmentTooWeak || decision.settlement.risk === 'High' || decision.settlement.risk === 'Extreme' || wrongSideAtCommitment) {
    return withNarrative({
      ...plan,
      direction: 'NONE',
      status: 'NO PLAN',
      displayAction: 'NO TRADE COMMITTED',
      tone: 'neutral',
      commitmentStatus: 'NO TRADE',
      committedDirection: 'NONE',
      committedAt: nowIso,
      commitmentReason: `Minute-9 commitment check did not find a clean, protected edge. Edge15 is intentionally sitting this contract out instead of forcing a side.`,
      committedEntryScore: decision.entryScore,
      committedConfidence: decision.confidence,
      committedTradeGrade: decision.tradeGrade,
      committedSettlementRisk: decision.settlement.risk,
      committedPrice: decision.distanceToReference === null ? null : null,
      committedDistance: decision.distanceToReference,
    }, decision, countdown);
  }

  const committedDirection = plan.direction;
  const status: SignalStatus = plan.status === 'NO PLAN' ? 'BUILDING' : plan.status;
  return withNarrative({
    ...plan,
    direction: committedDirection,
    status,
    displayAction: `COMMITTED ${committedDirection}`,
    tone: plan.tone === 'neutral' ? 'blue' : plan.tone,
    commitmentStatus: 'COMMITTED',
    committedDirection,
    committedAt: nowIso,
    commitmentReason: `At the minute-9 commitment check, Edge15 locked ${committedDirection}. The prediction side will not flip for the rest of this 15-minute contract; only the management status can change.`,
    committedEntryScore: decision.entryScore,
    committedConfidence: decision.confidence,
    committedTradeGrade: decision.tradeGrade,
    committedSettlementRisk: decision.settlement.risk,
    committedPrice: decision.distanceToReference === null ? null : null,
    committedDistance: decision.distanceToReference,
  }, decision, countdown);
}

function updateCommittedPlan(previous: SignalPlan, decision: Decision, countdown: SignalPlanInput['countdown'], nowIso: string): SignalPlan {
  const committedDirection = previous.committedDirection === 'OVER' || previous.committedDirection === 'UNDER' ? previous.committedDirection : previous.direction;
  const currentAgainstCommitment = decision.direction !== 'NONE' && decision.direction !== committedDirection;
  const pressure = currentAgainstCommitment ? previous.oppositePressure + oppositePressureBump(statusFromDecision(decision), decision) : Math.max(0, previous.oppositePressure - 1);
  let status: SignalStatus = 'HOLD SIGNAL';
  let tone: Tone = 'good';
  if (pressure >= 8 || decision.settlement.risk === 'Extreme') {
    status = 'CAUTION';
    tone = 'bad';
  } else if (pressure >= 4 || decision.settlement.risk === 'High') {
    status = 'CAUTION';
    tone = 'warn';
  }
  const stability = Math.round(Math.max(0, Math.min(100, previous.stability * 0.7 + decision.stability * 0.3 - pressure * 1.5)));
  return withNarrative({
    ...previous,
    direction: committedDirection,
    status,
    displayAction: `COMMITTED ${committedDirection} • ${status === 'CAUTION' ? 'CAUTION' : 'HOLD'}`,
    tone,
    stability,
    confirmations: previous.confirmations,
    oppositePressure: pressure,
    updatedAt: nowIso,
    rawAction: decision.action,
    rawDirection: decision.direction,
    commitmentStatus: 'COMMITTED',
    committedDirection,
    commitmentReason: previous.commitmentReason || `Edge15 is committed to ${committedDirection} for this contract.`,
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
    if (confirmations >= 7 && decision.stability >= 70 && decision.opportunity >= 88 && decision.settlement.risk !== 'High' && decision.settlement.risk !== 'Extreme') return 'ENTER';
    if (confirmations >= 5 && decision.stability >= 62 && decision.opportunity >= 74) return 'READY';
    return previousStatus === 'ENTER' ? 'HOLD SIGNAL' : 'LEAN';
  }
  if (rawStatus === 'LEAN') return confirmations >= 5 && decision.opportunity >= 74 ? 'READY' : 'LEAN';
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
  if (plan.commitmentStatus === 'SCOUTING') planText = `Scout Mode: Edge15 is watching the opening 9 minutes. No final contract prediction is locked yet.`;
  if (plan.commitmentStatus === 'NO TRADE') planText = `No Trade is committed for this contract. Edge15 did not see enough edge at the minute-9 check.`;
  if (plan.commitmentStatus === 'COMMITTED') planText = `${plan.committedDirection} is the committed prediction for this contract. Edge15 will keep this side fixed and only change the management status if risk rises.`;
  if (plan.status === 'ENTER' && plan.commitmentStatus !== 'COMMITTED') planText = `${direction} signal is confirmed. This is the first status where Edge15 considers the entry plan actionable.`;
  if (plan.status === 'READY' && plan.commitmentStatus !== 'COMMITTED') planText = `${direction} signal is nearly confirmed. Edge15 is waiting for one more stable push before calling ENTER.`;
  if (plan.status === 'CAUTION' && plan.commitmentStatus !== 'COMMITTED') planText = `${direction} plan is under pressure. Edge15 is not flipping yet, but the opposite side is gaining evidence.`;
  if (plan.status === 'NO PLAN' && plan.commitmentStatus === 'SCOUTING') planText = 'No active plan. Edge15 is waiting for a directional idea to form before the minute-9 commitment check.';

  const effectiveDirection = plan.commitmentStatus === 'COMMITTED' ? plan.committedDirection : direction;
  const invalidation = effectiveDirection === 'OVER'
    ? 'Invalidation: price loses VWAP while 5m momentum turns negative and Entry Score stays below 58 for multiple updates.'
    : effectiveDirection === 'UNDER'
      ? 'Invalidation: price reclaims VWAP while 5m momentum turns positive and Entry Score stays above 42 for multiple updates.'
      : 'Invalidation: none yet because no trade plan is active.';

  const nextStep = buildNextStep(plan, decision, countdown.display);

  return { ...plan, planText, invalidation, nextStep };
}

function buildNextStep(plan: SignalPlan, decision: Decision, display: string) {
  if (plan.commitmentStatus === 'SCOUTING') return `Scout Mode. At about 6:00 remaining, Edge15 will commit to OVER, commit to UNDER, or mark this contract NO TRADE.`;
  if (plan.commitmentStatus === 'NO TRADE') return `No Trade was committed at minute 9. Edge15 will continue showing risk context, but it will not chase a late prediction for this contract.`;
  if (plan.commitmentStatus === 'COMMITTED') return `Committed ${plan.committedDirection}. If you enter, press Entered ${plan.committedDirection}; otherwise use HOLD/CAUTION/DANGER as management context, not a new side flip.`;
  if (plan.status === 'ENTER') return `Entry plan is confirmed with ${display} remaining. If you enter, press Entered ${plan.direction} so Edge15 switches into HOLD / CAUTION / DANGER mode.`;
  if (plan.status === 'READY') return `Wait for the signal to hold one more update, remain on the correct side of the strike, and keep opportunity above 88%.`;
  if (plan.status === 'LEAN') return 'Plan is improving. Look for stability to rise above 70%, opportunity above 88%, and settlement risk to remain below High.';
  if (plan.status === 'WATCH' || plan.status === 'BUILDING') return 'Let the plan build. Edge15 needs more agreement before showing ENTER.';
  if (plan.status === 'CAUTION') return 'Do not add. Wait to see if the original plan recovers or cancels.';
  if (plan.status === 'HOLD SIGNAL') return 'Original signal is weakening but not invalidated. Avoid chasing a fresh entry until it strengthens again.';
  return 'Wait for a cleaner directional plan.';
}
