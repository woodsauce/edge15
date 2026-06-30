import type { Countdown } from '@/lib/position/countdown';
import type { Decision } from '@/lib/types/decision';
import type { MarketSnapshot } from '@/lib/types/market';
import type { LockedPosition, PositionAssessment, TradeSide } from '@/lib/types/position';

export const POSITION_STORAGE_KEY = 'edge15.lockedPosition.v1';

export function createLockedPosition(side: TradeSide, snapshot: MarketSnapshot, decision: Decision, countdown: Countdown): LockedPosition {
  return {
    side,
    entryTime: new Date().toISOString(),
    entryWindow: countdown.display,
    entryPrice: snapshot.btcPrice,
    entryStrike: snapshot.strike,
    entryAction: decision.action,
    entryScore: decision.entryScore,
    entryOpportunity: decision.opportunity,
    entryConfidence: decision.confidence,
    entryStability: decision.stability,
    entryGrade: decision.tradeGrade,
  };
}

export function assessPosition(position: LockedPosition, snapshot: MarketSnapshot, decision: Decision, countdown: Countdown): PositionAssessment {
  const currentPrice = snapshot.btcPrice;
  const currentStrike = snapshot.strike ?? position.entryStrike;
  const unrealizedDistance = currentPrice !== null && currentStrike !== null ? currentPrice - currentStrike : null;
  const distanceSinceEntry = currentPrice !== null && position.entryPrice !== null ? currentPrice - position.entryPrice : null;
  const favorableDistance = isFavorableDistance(position.side, unrealizedDistance);
  const favorableMove = isFavorableDistance(position.side, distanceSinceEntry);
  const oppositeDirection = decision.direction !== 'NONE' && decision.direction !== position.side;

  let dangerPoints = 0;
  let cautionPoints = 0;
  const reasons: string[] = [];

  if (oppositeDirection && decision.confidence >= 72 && decision.opportunity >= 62) {
    dangerPoints += 2;
    reasons.push(`Chief read now favors ${decision.direction} with ${decision.confidence}% confidence.`);
  } else if (oppositeDirection) {
    cautionPoints += 1;
    reasons.push(`Live bias is leaning against the locked ${position.side} position, but not strongly enough for danger.`);
  }

  if (unrealizedDistance !== null) {
    if (!favorableDistance && Math.abs(unrealizedDistance) > 45) {
      dangerPoints += 1;
      reasons.push(`BTC is about $${Math.abs(unrealizedDistance).toFixed(0)} on the wrong side of the reference.`);
    } else if (!favorableDistance) {
      cautionPoints += 1;
      reasons.push(`BTC is currently on the wrong side of the reference for ${position.side}.`);
    } else {
      reasons.push(`BTC remains on the favorable side of the reference for ${position.side}.`);
    }
  }

  if (distanceSinceEntry !== null) {
    if (!favorableMove && Math.abs(distanceSinceEntry) > 55) {
      dangerPoints += 1;
      reasons.push(`Price has moved about $${Math.abs(distanceSinceEntry).toFixed(0)} against your entry.`);
    } else if (!favorableMove && Math.abs(distanceSinceEntry) > 20) {
      cautionPoints += 1;
      reasons.push(`Price has moved about $${Math.abs(distanceSinceEntry).toFixed(0)} against your entry.`);
    } else if (favorableMove) {
      reasons.push(`Price has moved about $${Math.abs(distanceSinceEntry).toFixed(0)} in favor of your entry.`);
    }
  }

  if (decision.stability < 42) {
    cautionPoints += 1;
    reasons.push('Signal stability is low, which means the model sees disagreement between inputs.');
  }

  if (countdown.remainingMs <= 90_000 && !favorableDistance) {
    dangerPoints += 1;
    reasons.push('There is less than 90 seconds left and the position is not on the favorable side of the reference.');
  }

  if (!reasons.length) reasons.push('Position is locked and live data is still building enough context.');

  const status: PositionAssessment['status'] = dangerPoints >= 2 ? 'DANGER' : dangerPoints >= 1 || cautionPoints >= 2 ? 'CAUTION' : 'HOLD';
  const tone: PositionAssessment['tone'] = status === 'HOLD' ? 'good' : status === 'CAUTION' ? 'warn' : 'bad';
  const riskLabel = status === 'HOLD' ? 'No major invalidation yet' : status === 'CAUTION' ? 'Watch closely' : 'Position thesis weakening';

  return {
    status,
    tone,
    riskLabel,
    unrealizedDistance,
    distanceSinceEntry,
    reasons: reasons.slice(0, 5),
    story: buildPositionStory(position, status, reasons, countdown),
  };
}

function isFavorableDistance(side: TradeSide, distance: number | null) {
  if (distance === null) return false;
  return side === 'OVER' ? distance >= 0 : distance <= 0;
}

function buildPositionStory(position: LockedPosition, status: PositionAssessment['status'], reasons: string[], countdown: Countdown) {
  const lead = status === 'HOLD'
    ? `Edge15 is tracking your locked ${position.side} position as HOLD.`
    : status === 'CAUTION'
      ? `Edge15 is tracking your locked ${position.side} position as CAUTION.`
      : `Edge15 is tracking your locked ${position.side} position as DANGER.`;
  const entry = position.entryPrice === null ? 'Entry price was unavailable when the position was locked.' : `Entry was near $${position.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}.`;
  return `${lead} ${countdown.display} remains in the window. ${entry} ${reasons[0] ?? ''}`;
}
