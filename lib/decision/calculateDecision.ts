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
  const confidence = Math.round(clamp(45 + directionalStrength * 1.05 + stability * 0.18, 0, 99));
  const opportunity = Math.round(clamp(25 + directionalStrength * 1.55 + stability * 0.22 - volatilityPenalty(indicators), 0, 100));

  let action: Decision['action'] = 'WAIT';
  if (direction === 'NONE') action = opportunity < 34 ? 'AVOID' : 'WAIT';
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
    reason: buildReason(action, indicators, distance),
    whyNot: buildWhyNot(action, indicators, distance, stability, opportunity),
    story: buildStory(action, indicators, distance, snapshot.health.kalshi, countdown),
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

function buildReason(action: Decision['action'], indicators: IndicatorSnapshot, distance: number | null) {
  if (action === 'WAIT') return 'Evidence is not aligned enough yet.';
  if (action === 'AVOID') return 'Opportunity is too thin for a clean entry.';
  const dist = distance === null ? 'reference still loading' : `${distance >= 0 ? 'above' : 'below'} reference by about $${Math.abs(distance).toFixed(0)}`;
  const rsi = indicators.rsi14 === null ? 'RSI loading' : `RSI ${indicators.rsi14.toFixed(0)}`;
  const vwap = indicators.vwapBias === 'unknown' ? 'VWAP loading' : `price is ${indicators.vwapBias} VWAP`;
  return `${dist}; ${rsi}; ${vwap}.`;
}

function buildWhyNot(action: Decision['action'], indicators: IndicatorSnapshot, distance: number | null, stability: number, opportunity: number) {
  if (action.startsWith('ENTER')) return ['No major blocker detected. Continue watching for sudden volatility expansion.'];
  const needs: string[] = [];
  if (opportunity < 82) needs.push(`Opportunity needs to improve from ${opportunity}% toward 82%+.`);
  if (stability < 62) needs.push(`Stability needs to improve from ${stability}% toward 62%+.`);
  if (indicators.vwapBias === 'below') needs.push('For an OVER setup, BTC needs to reclaim VWAP.');
  if (indicators.vwapBias === 'above') needs.push('For an UNDER setup, BTC needs to lose VWAP.');
  if (indicators.rsi14 !== null && indicators.rsi14 > 45 && indicators.rsi14 < 55) needs.push('RSI is neutral; a stronger momentum push would help.');
  if (distance !== null && Math.abs(distance) < 15) needs.push('Price is close to the reference, so the edge is still thin.');
  return needs.slice(0, 4).length ? needs.slice(0, 4) : ['Waiting for cleaner agreement between trend, momentum, VWAP, and distance to reference.'];
}

function buildStory(action: Decision['action'], indicators: IndicatorSnapshot, distance: number | null, kalshiHealth: string, countdown: Countdown) {
  const parts = [];
  parts.push(`Edge15 currently reads this market as ${action}.`);
  parts.push(`${countdown.display} remains in the active 15-minute window, so the decision engine is balancing structure, momentum, and distance to reference.`);
  if (distance !== null) parts.push(`BTC is ${distance >= 0 ? 'above' : 'below'} the detected reference by roughly $${Math.abs(distance).toFixed(0)}.`);
  if (indicators.trendBias !== 'neutral') parts.push(`Trend bias is ${indicators.trendBias}.`);
  else parts.push('Trend bias is still neutral.');
  if (indicators.momentumBias !== 'neutral') parts.push(`Short-term momentum is ${indicators.momentumBias}.`);
  if (indicators.vwapBias !== 'unknown') parts.push(`Price is trading ${indicators.vwapBias} VWAP.`);
  if (indicators.rsi14 !== null) parts.push(`RSI is near ${indicators.rsi14.toFixed(0)}.`);
  if (kalshiHealth !== 'ok') parts.push('Kalshi context is optional in Genesis and may be unavailable without breaking price analysis.');
  return parts.join(' ');
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
