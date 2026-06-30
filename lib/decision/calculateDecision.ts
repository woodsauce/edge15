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
  const orderBook = snapshot.orderBook;
  const bookImbalance = orderBook?.imbalance ?? 0;
  const bookPressureScore = orderBook?.pressure === 'BUY'
    ? clamp(54 + Math.max(0, bookImbalance) * 42, 50, 76)
    : orderBook?.pressure === 'SELL'
      ? clamp(46 + Math.min(0, bookImbalance) * 42, 24, 50)
      : 50;

  const trendScore = clamp(50 + emaSpread * 1.15, 0, 100);
  const momentumScore = clamp(50 + momentum5 * 1.15 + momentum15 * 0.25, 0, 100);
  const rsiScore = clamp(rsi, 0, 100);
  const vwapScore = clamp(50 + vwapDistance * 0.95, 0, 100);
  const distanceScore = distance === null ? 50 : clamp(50 + distance / Math.max(atr * 0.35, 8) * 10, 0, 100);

  // Early in the 15-minute window, structure and momentum matter more. Late in
  // the window, distance to the reference price becomes more important.
  // Genesis-014: improve accuracy protection by weighting settlement reality more heavily
  // as the contract matures. Candles can describe direction, but distance/time decide
  // whether the 15-minute contract can actually finish on the predicted side.
  const settlementWeight = 0.18 + countdown.progress * 0.34;
  const structureWeight = 0.30 - countdown.progress * 0.11;
  const momentumWeight = 0.24 - countdown.progress * 0.06;
  const vwapWeight = 0.13;
  const bookWeight = orderBook ? 0.08 : 0.03;
  const rsiWeight = 1 - settlementWeight - structureWeight - momentumWeight - vwapWeight - bookWeight;

  const entryScore = Math.round(
    trendScore * structureWeight +
    momentumScore * momentumWeight +
    vwapScore * vwapWeight +
    rsiScore * rsiWeight +
    distanceScore * settlementWeight +
    bookPressureScore * bookWeight,
  );

  const directionalStrength = Math.abs(entryScore - 50);
  const direction: Decision['direction'] = directionalStrength < 6 ? 'NONE' : entryScore >= 50 ? 'OVER' : 'UNDER';
  const stability = calculateStability(indicators, entryScore, distance);
  const guardrails = buildGuardrails(direction, distance, countdown, indicators, atr);

  const rawConfidence = 40 + directionalStrength * 0.88 + stability * 0.15 - guardrails.confidencePenalty;
  const confidenceCap = countdown.remainingMs <= 60_000 ? 70 : countdown.remainingMs <= 180_000 ? 74 : countdown.remainingMs <= 360_000 ? 82 : 88;
  const confidence = Math.round(clamp(rawConfidence, 0, confidenceCap));

  const rawOpportunity = 20 + directionalStrength * 1.30 + stability * 0.18 - volatilityPenalty(indicators) - guardrails.opportunityPenalty;
  const opportunity = Math.round(clamp(rawOpportunity, 0, 100));

  let action: Decision['action'] = 'WAIT';
  if (guardrails.blockEnter) {
    action = guardrails.forceAvoid ? 'AVOID' : direction === 'NONE' ? 'WAIT' : `WATCH ${direction}` as Decision['action'];
  } else if (direction === 'NONE') action = opportunity < 38 ? 'AVOID' : 'WAIT';
  else if (opportunity >= 90 && confidence >= 80 && stability >= 72 && guardrails.settlement.risk !== 'High' && guardrails.settlement.risk !== 'Extreme') action = `ENTER ${direction}` as Decision['action'];
  else if (opportunity >= 76 && confidence >= 68 && stability >= 60) action = `LEAN ${direction}` as Decision['action'];
  else if (opportunity >= 58 && confidence >= 55) action = `WATCH ${direction}` as Decision['action'];
  else if (opportunity < 34) action = 'AVOID';

  const tone: Decision['tone'] = action.startsWith('ENTER') ? 'good' : action.startsWith('LEAN') || action.startsWith('WATCH') ? 'warn' : action === 'AVOID' ? 'bad' : 'neutral';

  return {
    action,
    tone,
    direction,
    entryScore,
    entryQuality: gradeEntry(entryScore, stability, opportunity),
    opportunity,
    opportunityLabel: opportunity >= 88 ? 'Excellent' : opportunity >= 74 ? 'Good' : opportunity >= 56 ? 'Developing' : opportunity >= 38 ? 'Thin' : 'Poor',
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
  if (opportunity >= 88 && stability >= 76 && strength >= 30) return 'Excellent setup';
  if (opportunity >= 74 && stability >= 64) return 'Good developing edge';
  if (opportunity >= 56) return 'Watch for confirmation';
  if (opportunity < 38) return 'Skip-quality market';
  return 'Not confirmed';
}

function tradeGrade(opportunity: number, confidence: number, stability: number) {
  const composite = opportunity * 0.42 + confidence * 0.34 + stability * 0.24;
  if (composite >= 92) return 'A+';
  if (composite >= 86) return 'A';
  if (composite >= 80) return 'B+';
  if (composite >= 72) return 'B';
  if (composite >= 62) return 'C';
  if (composite >= 50) return 'D';
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
  const cushion = Math.max(18, atr * 0.34);
  const momentum5 = indicators.momentum5m ?? 0;
  const recentVelocityPerSecond = Math.abs(momentum5) / 300;
  const volatilityAllowance = Math.max(5, atr * Math.sqrt(Math.max(seconds, 1) / 60) * 0.38);
  const alignedVelocityAllowance = recentVelocityPerSecond * seconds * 0.95;
  const unalignedVelocityAllowance = recentVelocityPerSecond * seconds * 0.16;
  const mode: Decision['settlement']['mode'] = seconds <= 360 ? 'settlement' : 'normal';
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
    const lateLabel = seconds <= 45 ? 'final seconds' : seconds <= 120 ? 'late window' : 'commitment window';

    if (wrongSide) {
      if (!momentumAligned || moveRatio > 0.85) {
        blockEnter = true;
        confidencePenalty += seconds <= 45 ? 42 : seconds <= 120 ? 34 : 24;
        opportunityPenalty += seconds <= 45 ? 52 : seconds <= 120 ? 42 : 28;
        risk = seconds <= 45 ? 'Extreme' : 'High';
        settlementMessage = `Settlement reality check: ${direction} needs about $${requiredMove.toFixed(0)} in ${seconds}s, but recent velocity/volatility only supports roughly $${realisticMove.toFixed(0)}. Late / risky / avoid.`;
        messages.push(settlementMessage);
        if (seconds <= 90 || moveRatio > 1.25) forceAvoid = true;
      } else {
        blockEnter = seconds <= 120;
        confidencePenalty += 18;
        opportunityPenalty += 22;
        risk = 'High';
        settlementMessage = `Settlement reality check: BTC is on the wrong side for ${direction}, but recent velocity/volatility could cover about $${realisticMove.toFixed(0)} versus $${requiredMove.toFixed(0)} needed. Late reversal possible, but risky.`;
        messages.push(settlementMessage);
      }
    } else {
      if (requiredMove > 0 && moveRatio > 1.1) {
        blockEnter = seconds <= 180;
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

  if (seconds <= 360 && direction !== 'NONE' && indicators.volatilityPct !== null && indicators.volatilityPct > 0.14) {
    confidencePenalty += 8;
    opportunityPenalty += 10;
    if (risk === 'Low') risk = 'Medium';
    messages.push('Late volatility is elevated, so Edge15 reduces confidence and avoids treating the setup like a lock.');
  }

  // Genesis-015: the last three minutes have produced too many late flips and poor
  // payout-to-risk entries. Edge15 should manage an existing committed idea here,
  // not open fresh late trades unless a future value engine explicitly proves the payout is worth it.
  if (seconds <= 180 && direction !== 'NONE') {
    blockEnter = true;
    confidencePenalty += seconds <= 60 ? 24 : 16;
    opportunityPenalty += seconds <= 60 ? 34 : 24;
    if (risk === 'Low') risk = 'Medium';
    messages.push('Final-3-minute chaos guard: Edge15 will not open a fresh entry this late. The market can flip fast and the payout is often too small for the risk.');
  }

  if (direction !== 'NONE' && distance !== null && seconds <= 540) {
    const correctSide = (direction === 'OVER' && distance > 0) || (direction === 'UNDER' && distance < 0);
    const absDistance = Math.abs(distance);
    if (!correctSide && seconds <= 540) {
      blockEnter = true;
      confidencePenalty += seconds <= 360 ? 18 : 10;
      opportunityPenalty += seconds <= 360 ? 24 : 12;
      if (risk === 'Low') risk = 'Medium';
      messages.push(`${direction} is still on the wrong side of the reference during the commitment half of the window. Edge15 will not call a clean ENTER until price confirms the side.`);
    }
    if (correctSide && seconds <= 360 && absDistance < cushion * 0.75) {
      blockEnter = true;
      confidencePenalty += 10;
      opportunityPenalty += 14;
      if (risk === 'Low') risk = 'Medium';
      messages.push(`${direction} is on the correct side, but cushion is too thin for a high-quality entry. Avoid paying for a fragile signal.`);
    }
  }

  return {
    messages: messages.slice(0, 4),
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
