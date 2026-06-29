import type { Countdown } from '@/lib/position/countdown';
import type { Decision } from '@/lib/types/decision';
import type { MarketSnapshot } from '@/lib/types/market';
import { calculateIndicatorSnapshot } from '@/lib/indicators';

export function calculateDecision(snapshot: MarketSnapshot, countdown: Countdown): Decision {
  const indicators = calculateIndicatorSnapshot(snapshot.candles);
  const price = snapshot.btcPrice;
  const strike = snapshot.strike;
  const distance = price !== null && strike !== null ? price - strike : null;
  const emaBias = indicators.ema9 !== null && indicators.ema21 !== null ? indicators.ema9 - indicators.ema21 : 0;
  const momentum = indicators.momentum15m ?? 0;
  const rsi = indicators.rsi14 ?? 50;
  const distanceScore = distance === null ? 50 : clamp(50 + distance / 4, 0, 100);
  const momentumScore = clamp(50 + momentum / 5, 0, 100);
  const trendScore = clamp(50 + emaBias / 3, 0, 100);
  const rsiScore = clamp(rsi, 0, 100);
  const timeWeight = countdown.progress;

  const entryScore = Math.round(
    trendScore * 0.25 + momentumScore * 0.25 + rsiScore * 0.15 + distanceScore * (0.2 + timeWeight * 0.15)
  );
  const opportunity = Math.round(clamp((Math.abs(entryScore - 50) * 1.7) + 28, 0, 100));
  const direction = entryScore >= 50 ? 'OVER' : 'UNDER';
  const strength = Math.abs(entryScore - 50);

  let action: Decision['action'] = 'WAIT';
  if (strength >= 35 && opportunity >= 80) action = `ENTER ${direction}` as Decision['action'];
  else if (strength >= 25) action = `LEAN ${direction}` as Decision['action'];
  else if (strength >= 14) action = `WATCH ${direction}` as Decision['action'];
  else if (opportunity < 35) action = 'AVOID';

  const tone: Decision['tone'] = action.startsWith('ENTER') ? 'good' : action.startsWith('LEAN') ? 'warn' : action === 'AVOID' ? 'bad' : 'neutral';
  return {
    action,
    tone,
    entryScore,
    entryQuality: entryScore >= 85 || entryScore <= 15 ? 'Excellent setup' : entryScore >= 72 || entryScore <= 28 ? 'Developing edge' : 'Not confirmed',
    opportunity,
    opportunityLabel: opportunity >= 80 ? 'Excellent' : opportunity >= 60 ? 'Good' : opportunity >= 40 ? 'Thin' : 'Poor',
    reason: buildReason(action, indicators, distance),
    story: buildStory(action, indicators, distance, snapshot.health.kalshi),
  };
}

function buildReason(action: Decision['action'], indicators: ReturnType<typeof calculateIndicatorSnapshot>, distance: number | null) {
  if (action === 'WAIT') return 'Evidence is not aligned enough yet.';
  if (action === 'AVOID') return 'Opportunity is too thin for a clean entry.';
  const dist = distance === null ? 'strike not detected' : `${distance >= 0 ? 'above' : 'below'} strike by about $${Math.abs(distance).toFixed(0)}`;
  const rsi = indicators.rsi14 === null ? 'RSI loading' : `RSI ${indicators.rsi14.toFixed(0)}`;
  return `${dist}; ${rsi}.`;
}

function buildStory(action: Decision['action'], indicators: ReturnType<typeof calculateIndicatorSnapshot>, distance: number | null, kalshiHealth: string) {
  const parts = [];
  parts.push(`Edge15 currently reads this market as ${action}.`);
  if (distance !== null) parts.push(`BTC is ${distance >= 0 ? 'above' : 'below'} the detected strike by roughly $${Math.abs(distance).toFixed(0)}.`);
  if (indicators.ema9 !== null && indicators.ema21 !== null) parts.push(indicators.ema9 >= indicators.ema21 ? 'Short-term trend is constructive.' : 'Short-term trend is under pressure.');
  if (indicators.rsi14 !== null) parts.push(`RSI is near ${indicators.rsi14.toFixed(0)}, which helps measure whether momentum is improving or fading.`);
  if (kalshiHealth !== 'ok') parts.push('Kalshi context is optional in Genesis and may be unavailable without breaking price analysis.');
  return parts.join(' ');
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
