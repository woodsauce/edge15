import type { Countdown } from '@/lib/position/countdown';
import type { Decision, Tone } from '@/lib/types/decision';
import type { MarketSnapshot } from '@/lib/types/market';
import type { SignalPlan } from '@/lib/types/signal';

type EngineBias = 'OVER' | 'UNDER' | 'NEUTRAL';

export type EngineVote = {
  id: string;
  name: string;
  role: string;
  bias: EngineBias;
  confidence: number;
  tone: Tone;
  message: string;
  disagreement?: string;
};

export type TradingDesk = {
  engines: EngineVote[];
  chiefSummary: string;
  marketStory: string;
  debate: string[];
  whyNot: string[];
  disagreementCount: number;
  agreementCount: number;
  modelConfidence: number;
};

export function buildTradingDesk(snapshot: MarketSnapshot, decision: Decision, signalPlan: SignalPlan | null, countdown: Countdown): TradingDesk {
  const price = snapshot.btcPrice;
  const strike = snapshot.strike;
  const distance = price !== null && strike !== null ? price - strike : null;
  const side = signalPlan?.direction && signalPlan.direction !== 'NONE' ? signalPlan.direction : decision.direction;
  const engines = [
    trendEngine(decision),
    momentumEngine(decision),
    volatilityEngine(decision),
    meanReversionEngine(decision, distance),
    marketPressureEngine(decision, distance),
    kalshiEngine(snapshot, distance),
    historicalEngine(decision, signalPlan),
  ];

  const directionalEngines = engines.filter((e) => e.bias !== 'NEUTRAL');
  const agreementCount = side === 'NONE' ? 0 : directionalEngines.filter((e) => e.bias === side).length;
  const disagreementCount = side === 'NONE' ? directionalEngines.length : directionalEngines.filter((e) => e.bias !== side).length;
  const avgConfidence = Math.round(engines.reduce((sum, e) => sum + e.confidence, 0) / engines.length);
  const modelConfidence = Math.round(clamp(avgConfidence * 0.42 + decision.stability * 0.30 + Math.max(0, 100 - disagreementCount * 14) * 0.28, 0, 99));

  return {
    engines,
    chiefSummary: buildChiefSummary(side, decision, signalPlan, agreementCount, disagreementCount, modelConfidence),
    marketStory: buildMarketStory(snapshot, decision, signalPlan, countdown, agreementCount, disagreementCount),
    debate: buildDebate(engines, side, signalPlan, decision),
    whyNot: buildDeskWhyNot(decision, signalPlan, engines, distance),
    disagreementCount,
    agreementCount,
    modelConfidence,
  };
}

function trendEngine(decision: Decision): EngineVote {
  const bias = decision.indicators.trendBias === 'bullish' ? 'OVER' : decision.indicators.trendBias === 'bearish' ? 'UNDER' : 'NEUTRAL';
  const confidence = bias === 'NEUTRAL' ? 46 : Math.round(clamp(62 + Math.abs((decision.indicators.ema9 ?? 0) - (decision.indicators.ema21 ?? 0)) * 1.2, 55, 91));
  return {
    id: 'trend',
    name: 'Trend Engine',
    role: 'Structure and EMA alignment',
    bias,
    confidence,
    tone: toneForBias(bias),
    message: bias === 'OVER'
      ? 'EMA structure supports an OVER bias. The bigger picture is constructive unless price loses structure.'
      : bias === 'UNDER'
        ? 'EMA structure supports an UNDER bias. The bigger picture is weak unless buyers reclaim structure.'
        : 'Trend structure is not clean enough to strongly support either side yet.',
  };
}

function momentumEngine(decision: Decision): EngineVote {
  const bias = decision.indicators.momentumBias === 'bullish' ? 'OVER' : decision.indicators.momentumBias === 'bearish' ? 'UNDER' : 'NEUTRAL';
  const momentum = Math.abs(decision.indicators.momentum5m ?? 0);
  const confidence = bias === 'NEUTRAL' ? 45 : Math.round(clamp(58 + momentum * 0.9, 55, 92));
  return {
    id: 'momentum',
    name: 'Momentum Engine',
    role: 'Speed and recent push',
    bias,
    confidence,
    tone: toneForBias(bias),
    message: bias === 'OVER'
      ? 'Recent candles show upside pressure. Momentum is helping the OVER case.'
      : bias === 'UNDER'
        ? 'Recent candles show downside pressure. Momentum is helping the UNDER case.'
        : 'Momentum is still neutral, so this engine is not ready to lead the decision.',
  };
}

function volatilityEngine(decision: Decision): EngineVote {
  const vol = decision.indicators.volatilityPct ?? 0;
  const hot = vol > 0.14;
  const confidence = hot ? 60 : 68;
  return {
    id: 'volatility',
    name: 'Volatility Engine',
    role: 'Risk of sudden move',
    bias: 'NEUTRAL',
    confidence,
    tone: hot ? 'warn' : 'blue',
    message: hot
      ? 'Volatility is elevated. This does not pick a side, but it lowers trust in clean entries and increases reversal risk.'
      : 'Volatility is controlled. That supports cleaner signal interpretation and reduces random whipsaw risk.',
  };
}

function meanReversionEngine(decision: Decision, distance: number | null): EngineVote {
  const rsi = decision.indicators.rsi14 ?? 50;
  const extendedOver = rsi >= 69 || (distance !== null && distance > Math.max(70, Math.abs(distance) * 0.7));
  const extendedUnder = rsi <= 31 || (distance !== null && distance < -Math.max(70, Math.abs(distance) * 0.7));
  const bias: EngineBias = extendedOver ? 'UNDER' : extendedUnder ? 'OVER' : 'NEUTRAL';
  return {
    id: 'mean-reversion',
    name: 'Mean Reversion Engine',
    role: 'Overextension and snapback risk',
    bias,
    confidence: bias === 'NEUTRAL' ? 44 : 63,
    tone: bias === 'NEUTRAL' ? 'neutral' : 'warn',
    message: bias === 'UNDER'
      ? 'Price appears stretched upward. I am warning that a pullback could hurt an OVER entry.'
      : bias === 'OVER'
        ? 'Price appears stretched downward. I am warning that a bounce could hurt an UNDER entry.'
        : 'I do not see a strong overextension signal right now.',
  };
}

function marketPressureEngine(decision: Decision, distance: number | null): EngineVote {
  const aboveVwap = decision.indicators.vwapBias === 'above';
  const belowVwap = decision.indicators.vwapBias === 'below';
  const bias: EngineBias = aboveVwap ? 'OVER' : belowVwap ? 'UNDER' : 'NEUTRAL';
  const pressure = distance === null ? 0 : Math.min(20, Math.abs(distance) / 5);
  return {
    id: 'market-pressure',
    name: 'Market Pressure Engine',
    role: 'VWAP and strike pressure',
    bias,
    confidence: bias === 'NEUTRAL' ? 43 : Math.round(clamp(58 + pressure, 55, 84)),
    tone: toneForBias(bias),
    message: bias === 'OVER'
      ? 'Price is holding above VWAP, which suggests buyers are currently absorbing pressure.'
      : bias === 'UNDER'
        ? 'Price is below VWAP, which suggests sellers currently have control of the pressure line.'
        : 'VWAP pressure is unclear, so I am neutral for now.',
  };
}

function kalshiEngine(snapshot: MarketSnapshot, distance: number | null): EngineVote {
  if (!snapshot.kalshi?.ticker || snapshot.health.kalshi !== 'ok') {
    return {
      id: 'kalshi',
      name: 'Kalshi Engine',
      role: 'Contract context',
      bias: 'NEUTRAL',
      confidence: 35,
      tone: 'neutral',
      message: 'Kalshi context is not fully available. I will not let this break the app, but I am reducing contract-context confidence.',
    };
  }
  const bias: EngineBias = distance === null ? 'NEUTRAL' : distance >= 0 ? 'OVER' : 'UNDER';
  return {
    id: 'kalshi',
    name: 'Kalshi Engine',
    role: 'Target and settlement context',
    bias,
    confidence: distance === null ? 48 : Math.round(clamp(55 + Math.abs(distance) * 0.38, 55, 88)),
    tone: toneForBias(bias),
    message: distance === null
      ? 'The market is detected, but distance to the reference is still loading.'
      : `The contract reference is active. BTC is ${distance >= 0 ? 'above' : 'below'} it by about $${Math.abs(distance).toFixed(0)}.`,
  };
}

function historicalEngine(decision: Decision, signalPlan: SignalPlan | null): EngineVote {
  const bias = signalPlan?.direction && signalPlan.direction !== 'NONE' ? signalPlan.direction : decision.direction;
  const stability = signalPlan?.stability ?? decision.stability;
  if (bias === 'NONE') {
    return {
      id: 'historical',
      name: 'Historical Pattern Engine',
      role: 'Current fingerprint placeholder',
      bias: 'NEUTRAL',
      confidence: 38,
      tone: 'neutral',
      message: 'Historical fingerprint matching is not active yet. For Genesis-006, I use signal stability as a placeholder until replay fingerprints are wired in.',
    };
  }
  return {
    id: 'historical',
    name: 'Historical Pattern Engine',
    role: 'Current fingerprint placeholder',
    bias,
    confidence: Math.round(clamp(48 + stability * 0.42, 45, 86)),
    tone: 'blue',
    message: `Full historical matching comes later. For now, the active ${bias} plan has ${stability}% stability, so the fingerprint placeholder supports the current plan cautiously.`,
  };
}

function buildChiefSummary(side: Decision['direction'], decision: Decision, signalPlan: SignalPlan | null, agreement: number, disagreement: number, modelConfidence: number) {
  const action = signalPlan?.displayAction ?? decision.action;
  if (side === 'NONE') {
    return `Chief AI: I do not have a strong enough directional plan yet. The current action is ${action}. Model confidence is ${modelConfidence}%, so Edge15 is prioritizing patience over forcing a trade.`;
  }
  const disagreementText = disagreement === 0 ? 'no active engine disagreement' : `${disagreement} engine${disagreement === 1 ? '' : 's'} disagreeing or warning`;
  return `Chief AI: The active plan is ${action}. ${agreement} engine${agreement === 1 ? '' : 's'} support ${side}, with ${disagreementText}. Model confidence is ${modelConfidence}%. I will not flip this plan on a single refresh; I need sustained evidence before changing direction.`;
}

function buildMarketStory(snapshot: MarketSnapshot, decision: Decision, signalPlan: SignalPlan | null, countdown: Countdown, agreement: number, disagreement: number) {
  const action = signalPlan?.displayAction ?? decision.action;
  const referenceText = snapshot.btcPrice !== null && snapshot.strike !== null
    ? `BTC is ${snapshot.btcPrice >= snapshot.strike ? 'above' : 'below'} the reference by roughly $${Math.abs(snapshot.btcPrice - snapshot.strike).toFixed(0)}.`
    : 'Reference distance is still loading.';
  const planText = signalPlan
    ? `The trade plan is ${signalPlan.status.toLowerCase()} with ${signalPlan.confirmations} confirmation point${signalPlan.confirmations === 1 ? '' : 's'} and ${signalPlan.stability}% stability.`
    : 'The trade plan is still forming.';
  return `Market Story: With ${countdown.display} remaining, Edge15 reads the action as ${action}. ${referenceText} Trend is ${decision.indicators.trendBias}, momentum is ${decision.indicators.momentumBias}, and price is ${decision.indicators.vwapBias} VWAP. ${planText} The engine table shows ${agreement} supporting votes and ${disagreement} warnings/disagreements.`;
}

function buildDebate(engines: EngineVote[], side: Decision['direction'], signalPlan: SignalPlan | null, decision: Decision) {
  const lines: string[] = [];
  const lead = engines.filter((e) => side !== 'NONE' && e.bias === side).slice(0, 3);
  const objections = engines.filter((e) => e.bias !== 'NEUTRAL' && side !== 'NONE' && e.bias !== side).slice(0, 2);
  const neutral = engines.filter((e) => e.bias === 'NEUTRAL').slice(0, 2);

  for (const engine of lead) lines.push(`${engine.name}: I support ${side}. ${engine.message}`);
  for (const engine of objections) lines.push(`${engine.name}: I disagree with the current ${side} plan. ${engine.message}`);
  for (const engine of neutral) lines.push(`${engine.name}: I am neutral. ${engine.message}`);

  if (!lines.length) lines.push(`Chief AI: The model is staying patient. Current raw read is ${decision.action}; plan read is ${signalPlan?.displayAction ?? decision.action}.`);
  return lines;
}

function buildDeskWhyNot(decision: Decision, signalPlan: SignalPlan | null, engines: EngineVote[], distance: number | null) {
  const blockers = [...decision.whyNot];
  const disagreeing = engines.filter((e) => e.bias !== 'NEUTRAL' && signalPlan?.direction && signalPlan.direction !== 'NONE' && e.bias !== signalPlan.direction);
  if (disagreeing.length) blockers.unshift(`${disagreeing.length} engine${disagreeing.length === 1 ? '' : 's'} are warning against the active plan: ${disagreeing.map((e) => e.name.replace(' Engine', '')).join(', ')}.`);
  if (signalPlan && signalPlan.status !== 'ENTER') blockers.unshift(signalPlan.nextStep);
  if (distance !== null && Math.abs(distance) < 20) blockers.push('Distance to reference is still thin, so late-window movement can change the setup quickly.');
  return blockers.filter(Boolean).slice(0, 5);
}

function toneForBias(bias: EngineBias): Tone {
  if (bias === 'OVER') return 'good';
  if (bias === 'UNDER') return 'bad';
  return 'neutral';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
