import type { Countdown } from '@/lib/position/countdown';
import type { Decision } from '@/lib/types/decision';
import type { MarketSnapshot } from '@/lib/types/market';
import { calculateIndicatorSnapshot, type IndicatorSnapshot } from '@/lib/indicators';

export function calculateDecision(snapshot: MarketSnapshot, countdown: Countdown): Decision {
  const indicators = calculateIndicatorSnapshot(snapshot.candles);
  const price = snapshot.btcPrice;
  const strike = snapshot.strike;
  const distance = price !== null && strike !== null ? price - strike : null;

  const emaSpread = indicators.ema9 !== null && indicators.ema21 !== null ? indicators.ema9 - indicators.ema21 : 0;
  const momentum5 = indicators.momentum5m ?? 0;
  const momentum15 = indicators.momentum15m ?? 0;
  const rsi = indicators.rsi14 ?? 50;
  const vwapDistance = price !== null && indicators.vwap !== null ? price - indicators.vwap : 0;
  const atr = indicators.atr14 ?? 35;

  const trendScore = clamp(50 + emaSpread * 1.15, 0, 100);
  const momentumScore = clamp(50 + momentum5 * 1.15 + momentum15 * 0.25, 0, 100);
  const rsiScore = clamp(rsi, 0, 100);
  const vwapScore = clamp(50 + vwapDistance * 0.95, 0, 100);
  const distanceScore = distance === null ? 50 : clamp(50 + distance / Math.max(atr * 0.35, 8) * 10, 0, 100);

  // Early in the 15-minute window, structure and momentum matter more. Late in
  // the window, distance to the reference price becomes more important.
  const settlementWeight = 0.16 + countdown.progress * 0.22;
  const structureWeight = 0.32 - countdown.progress * 0.08;
  const momentumWeight = 0.26 - countdown.progress * 0.04;
  const vwapWeight = 0.16;
  const rsiWeight = 1 - settlementWeight - structureWeight - momentumWeight - vwapWeight;

  const entryScore = Math.round(
    trendScore * structureWeight +
    momentumScore * momentumWeight +
    vwapScore * vwapWeight +
    rsiScore * rsiWeight +
    distanceScore * settlementWeight,
  );

  const directionalStrength = Math.abs(entryScore - 50);
  const direction: Decision['direction'] = directionalStrength < 6 ? 'NONE' : entryScore >= 50 ? 'OVER' : 'UNDER';
  const stability = calculateStability(indicators, entryScore, distance);
  const guardrails = buildGuardrails(direction, distance, countdown, indicators, atr);

  const rawConfidence = 45 + directionalStrength * 1.05 + stability * 0.18 - guardrails.confidencePenalty;
  const confidenceCap = countdown.remainingMs <= 60_000 ? 84 : countdown.remainingMs <= 120_000 ? 88 : 92;
  const confidence = Math.round(clamp(rawConfidence, 0, confidenceCap));

  const rawOpportunity = 25 + directionalStrength * 1.55 + stability * 0.22 - volatilityPenalty(indicators) - guardrails.opportunityPenalty;
  const opportunity = Math.round(clamp(rawOpportunity, 0, 100));

  let action: Decision['action'] = 'WAIT';
  if (guardrails.blockEnter) {
    action = guardrails.forceAvoid ? 'AVOID' : direction === 'NONE' ? 'WAIT' : `WATCH ${direction}` as Decision['action'];
  } else if (direction === 'NONE') action = opportunity < 34 ? 'AVOID' : 'WAIT';
  else if (opportunity >= 82 && confidence >= 78 && stability >= 62) action = `ENTER ${direction}` as Decision['action'];
  else if (opportunity >= 68 && confidence >= 66) action = `LEAN ${direction}` as Decision['action'];
  else if (opportunity >= 52 && confidence >= 56) action = `WATCH ${direction}` as Decision['action'];
  else if (opportunity < 34) action = 'AVOID';

  const tone: Decision['tone'] = action.startsWith('ENTER') ? 'good' : action.startsWith('LEAN') || action.startsWith('WATCH') ? 'warn' : action === 'AVOID' ? 'bad' : 'neutral';

  return {
    action,
    tone,
    direction,
    entryScore,
    entryQuality: gradeEntry(entryScore, stability, opportunity),
    opportunity,
    opportunityLabel: opportunity >= 82 ? 'Excellent' : opportunity >= 68 ? 'Good' : opportunity >= 52 ? 'Developing' : opportunity >= 34 ? 'Thin' : 'Poor',
    tradeGrade: tradeGrade(opportunity, confidence, stability),
    confidence,
    stability,
    distanceToReference: distance,
    secondsRemaining: Math.ceil(countdown.remainingMs / 1000),
    guardrails: guardrails.messages,
    settlement: guardrails.settlement,
    reason: buildReason(action, indicators, distance, guardrails.messages),
    whyNot: buildWhyNot(action, indicators, distance, stability, opportunity, guardrails.messages),
    story: buildStory(action, indicators, distance, snapshot.health.kalshi, countdown, guardrails.messages),
    indicators,
  };
}

function calculateStability(indicators: IndicatorSnapshot, entryScore: number, distance: number | null) {
  let score = 50;
  const side = entryScore >= 50 ? 1 : -1;
  if (indicators.trendBias === (side > 0 ? 'bullish' : 'bearish')) score += 16;
  if (indicators.momentumBias === (side > 0 ? 'bullish' : 'bearish')) score += 14;
  if (indicators.vwapBias === (side > 0 ? 'above' : 'below')) score += 12;
  if (distance !== null && Math.sign(distance) === side) score += 12;
  if (indicators.rsi14 !== null) {
    if (side > 0 && indicators.rsi14 >= 48 && indicators.rsi14 <= 74) score += 8;
    if (side < 0 && indicators.rsi14 <= 52 && indicators.rsi14 >= 26) score += 8;
  }
  return Math.round(clamp(score, 0, 100));
}

function volatilityPenalty(indicators: IndicatorSnapshot) {
  if (indicators.volatilityPct === null) return 0;
  if (indicators.volatilityPct > 0.18) return 14;
  if (indicators.volatilityPct > 0.12) return 7;
  return 0;
}

function gradeEntry(entryScore: number, stability: number, opportunity: number) {
  const strength = Math.abs(entryScore - 50);
  if (opportunity >= 84 && stability >= 72 && strength >= 28) return 'Excellent setup';
  if (opportunity >= 68 && stability >= 58) return 'Good developing edge';
  if (opportunity >= 52) return 'Watch for confirmation';
  if (opportunity < 34) return 'Skip-quality market';
  return 'Not confirmed';
}

function tradeGrade(opportunity: number, confidence: number, stability: number) {
  const composite = opportunity * 0.42 + confidence * 0.34 + stability * 0.24;
  if (composite >= 90) return 'A+';
  if (composite >= 84) return 'A';
  if (composite >= 78) return 'B+';
  if (composite >= 70) return 'B';
  if (composite >= 60) return 'C';
  if (composite >= 48) return 'D';
  return 'F';
}

function buildReason(action: Decision['action'], indicators: IndicatorSnapshot, distance: number | null, guardrails: string[]) {
  if (guardrails.length && !action.startsWith('ENTER')) return guardrails[0];
  if (action === 'WAIT') return 'Evidence is not aligned enough yet.';
  if (action === 'AVOID') return 'Opportunity is too thin for a clean entry.';
  const dist = distance === null ? 'reference still loading' : `${distance >= 0 ? 'above' : 'below'} reference by about $${Math.abs(distance).toFixed(0)}`;
  const rsi = indicators.rsi14 === null ? 'RSI loading' : `RSI ${indicators.rsi14.toFixed(0)}`;
  const vwap = indicators.vwapBias === 'unknown' ? 'VWAP loading' : `price is ${indicators.vwapBias} VWAP`;
  return `${dist}; ${rsi}; ${vwap}.`;
}

function buildWhyNot(action: Decision['action'], indicators: IndicatorSnapshot, distance: number | null, stability: number, opportunity: number, guardrails: string[]) {
  if (action.startsWith('ENTER')) {
    const riskLine = guardrails.find((g) => g.includes('Settlement reality')) ?? 'Failure risk is still present. ENTER means actionable setup, not certainty.';
    return [riskLine, 'No trade is a lock. Keep watching distance to reference, VWAP, and sudden volatility expansion.'];
  }
  const needs: string[] = [...guardrails];
  if (opportunity < 82) needs.push(`Opportunity needs to improve from ${opportunity}% toward 82%+.`);
  if (stability < 62) needs.push(`Stability needs to improve from ${stability}% toward 62%+.`);
  if (indicators.vwapBias === 'below') needs.push('For an OVER setup, BTC needs to reclaim VWAP.');
  if (indicators.vwapBias === 'above') needs.push('For an UNDER setup, BTC needs to lose VWAP.');
  if (indicators.rsi14 !== null && indicators.rsi14 > 45 && indicators.rsi14 < 55) needs.push('RSI is neutral; a stronger momentum push would help.');
  if (distance !== null && Math.abs(distance) < 15) needs.push('Price is close to the reference, so the edge is still thin.');
  return needs.slice(0, 4).length ? needs.slice(0, 4) : ['Waiting for cleaner agreement between trend, momentum, VWAP, and distance to reference.'];
}

function buildStory(action: Decision['action'], indicators: IndicatorSnapshot, distance: number | null, kalshiHealth: string, countdown: Countdown, guardrails: string[]) {
  const parts = [];
  parts.push(`Edge15 currently reads this market as ${action}.`);
  parts.push(`${countdown.display} remains in the active 15-minute window, so the decision engine is balancing structure, momentum, and distance to reference.`);
  if (distance !== null) parts.push(`BTC is ${distance >= 0 ? 'above' : 'below'} the detected reference by roughly $${Math.abs(distance).toFixed(0)}.`);
  if (indicators.trendBias !== 'neutral') parts.push(`Trend bias is ${indicators.trendBias}.`);
  else parts.push('Trend bias is still neutral.');
  if (indicators.momentumBias !== 'neutral') parts.push(`Short-term momentum is ${indicators.momentumBias}.`);
  if (indicators.vwapBias !== 'unknown') parts.push(`Price is trading ${indicators.vwapBias} VWAP.`);
  if (indicators.rsi14 !== null) parts.push(`RSI is near ${indicators.rsi14.toFixed(0)}.`);
  if (guardrails.length) parts.push(`Guardrail active: ${guardrails[0]}`);
  if (kalshiHealth !== 'ok') parts.push('Kalshi context is optional in Genesis and may be unavailable without breaking price analysis.');
  return parts.join(' ');
}


type GuardrailResult = {
  messages: string[];
  blockEnter: boolean;
  forceAvoid: boolean;
  confidencePenalty: number;
  opportunityPenalty: number;
  settlement: Decision['settlement'];
};

function buildGuardrails(direction: Decision['direction'], distance: number | null, countdown: Countdown, indicators: IndicatorSnapshot, atr: number): GuardrailResult {
  const messages: string[] = [];
  let blockEnter = false;
  let forceAvoid = false;
  let confidencePenalty = 0;
  let opportunityPenalty = 0;
  const seconds = Math.ceil(countdown.remainingMs / 1000);
  const cushion = Math.max(12, atr * 0.22);
  const momentum5 = indicators.momentum5m ?? 0;
  const recentVelocityPerSecond = Math.abs(momentum5) / 300;
  const volatilityAllowance = Math.max(6, atr * Math.sqrt(Math.max(seconds, 1) / 60) * 0.45);
  const alignedVelocityAllowance = recentVelocityPerSecond * seconds * 1.15;
  const unalignedVelocityAllowance = recentVelocityPerSecond * seconds * 0.25;
  const mode: Decision['settlement']['mode'] = seconds <= 120 ? 'settlement' : 'normal';
  let requiredMove: number | null = null;
  let realisticMove: number | null = null;
  let risk: Decision['settlement']['risk'] = 'Low';
  let settlementMessage = 'Normal mode. Edge15 is still balancing structure, momentum, VWAP, and distance to reference.';

  if (mode === 'settlement' && direction !== 'NONE' && distance !== null) {
    const correctSide = (direction === 'OVER' && distance > 0) || (direction === 'UNDER' && distance < 0);
    const wrongSide = !correctSide;
    const momentumAligned = (direction === 'OVER' && momentum5 > 0) || (direction === 'UNDER' && momentum5 < 0);
    const absDistance = Math.abs(distance);

    requiredMove = wrongSide ? absDistance + cushion * 0.5 : Math.max(0, cushion - absDistance);
    realisticMove = volatilityAllowance + (momentumAligned ? alignedVelocityAllowance : unalignedVelocityAllowance);

    const moveRatio = requiredMove <= 0 ? 0 : requiredMove / Math.max(realisticMove, 1);
    const lateLabel = seconds <= 45 ? 'final seconds' : seconds <= 75 ? 'late window' : 'settlement window';

    if (wrongSide) {
      if (!momentumAligned || moveRatio > 1.25) {
        blockEnter = true;
        confidencePenalty += seconds <= 45 ? 34 : 25;
        opportunityPenalty += seconds <= 45 ? 42 : 32;
        risk = seconds <= 45 ? 'Extreme' : 'High';
        settlementMessage = `Settlement reality check: ${direction} needs about $${requiredMove.toFixed(0)} in ${seconds}s, but recent velocity/volatility only supports roughly $${realisticMove.toFixed(0)}. Late / risky / avoid.`;
        messages.push(settlementMessage);
        if (seconds <= 30) forceAvoid = true;
      } else {
        confidencePenalty += 10;
        opportunityPenalty += 14;
        risk = 'High';
        settlementMessage = `Settlement reality check: BTC is on the wrong side for ${direction}, but recent velocity/volatility could cover about $${realisticMove.toFixed(0)} versus $${requiredMove.toFixed(0)} needed. Late reversal possible, but risky.`;
        messages.push(settlementMessage);
      }
    } else {
      if (requiredMove > 0 && moveRatio > 1.1) {
        blockEnter = seconds <= 75;
        confidencePenalty += 12;
        opportunityPenalty += 18;
        risk = 'Medium';
        settlementMessage = `Settlement reality check: ${direction} is on the correct side, but cushion is thin in the ${lateLabel}. Edge15 wants roughly $${cushion.toFixed(0)} of cushion before a clean ENTER.`;
        messages.push(settlementMessage);
      } else {
        risk = requiredMove > 0 ? 'Medium' : 'Low';
        settlementMessage = `Settlement reality check: ${direction} is on the correct side of the reference with ${seconds}s remaining. Failure risk still exists, but distance/time are acceptable.`;
        if (seconds <= 75) messages.push(settlementMessage);
      }
    }
  }

  if (seconds <= 120 && direction !== 'NONE' && indicators.volatilityPct !== null && indicators.volatilityPct > 0.14) {
    confidencePenalty += 8;
    opportunityPenalty += 10;
    if (risk === 'Low') risk = 'Medium';
    messages.push('Late volatility is elevated, so Edge15 reduces confidence and avoids treating the setup like a lock.');
  }

  return {
    messages: messages.slice(0, 3),
    blockEnter,
    forceAvoid,
    confidencePenalty,
    opportunityPenalty,
    settlement: {
      mode,
      requiredMove,
      realisticMove,
      risk,
      message: settlementMessage,
    },
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
