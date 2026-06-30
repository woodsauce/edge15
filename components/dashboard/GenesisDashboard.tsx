'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from '@/components/ui/Panel';
import { Metric } from '@/components/ui/Metric';
import type { FeedDiagnostic, MarketSnapshot } from '@/lib/types/market';
import type { LockedPosition, TradeSide } from '@/lib/types/position';
import { calculateDecision } from '@/lib/decision/calculateDecision';
import { buildCountdown } from '@/lib/position/countdown';
import { assessPosition, createLockedPosition, POSITION_STORAGE_KEY } from '@/lib/position/positionManager';
import { SIGNAL_PLAN_STORAGE_KEY, updateSignalPlan } from '@/lib/signal/signalPlan';
import type { SignalDirection, SignalPlan, SignalStatus } from '@/lib/types/signal';
import { buildTradingDesk, type EngineVote } from '@/lib/ai/tradingDesk';

const blankDiagnostic = (message: string): FeedDiagnostic => ({
  status: 'unknown',
  latencyMs: null,
  message,
  updatedAt: null,
});

const DEFAULT_SNAPSHOT: MarketSnapshot = {
  source: 'bootstrap',
  btcPrice: null,
  strike: null,
  candles: [],
  kalshi: null,
  health: { coinbase: 'unknown', kalshi: 'unknown', fallback: 'unknown' },
  diagnostics: {
    coinbase: blankDiagnostic('Waiting for first Coinbase check'),
    fallback: blankDiagnostic('Fallback has not been needed yet'),
    kalshi: blankDiagnostic('Waiting for first Kalshi check'),
  },
  fetchedAt: null,
};

const SECTION_STORAGE_KEY = 'edge15.visibleSections.v1';
const DEFAULT_VISIBLE_SECTIONS = {
  aiDesk: true,
  marketStory: true,
  indicators: true,
  whyNot: true,
  dataHealth: true,
  genesisStatus: true,
};

type SectionKey = keyof typeof DEFAULT_VISIBLE_SECTIONS;

type ApiTest = {
  health?: string;
  coinbase?: string;
  fallback?: string;
  kalshi?: string;
};

export function GenesisDashboard() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot>(DEFAULT_SNAPSHOT);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [apiTest, setApiTest] = useState<ApiTest>({});
  const [testing, setTesting] = useState(false);
  const [position, setPosition] = useState<LockedPosition | null>(null);
  const [signalPlan, setSignalPlan] = useState<SignalPlan | null>(null);
  const [visibleSections, setVisibleSections] = useState(DEFAULT_VISIBLE_SECTIONS);

  useEffect(() => {
    const saved = window.localStorage.getItem(SECTION_STORAGE_KEY);
    if (!saved) return;
    try {
      setVisibleSections({ ...DEFAULT_VISIBLE_SECTIONS, ...JSON.parse(saved) });
    } catch {
      window.localStorage.removeItem(SECTION_STORAGE_KEY);
    }
  }, []);

  function toggleSection(key: SectionKey) {
    setVisibleSections((previous) => {
      const next = { ...previous, [key]: !previous[key] };
      window.localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(POSITION_STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as LockedPosition;
      if (parsed?.side === 'OVER' || parsed?.side === 'UNDER') setPosition(parsed);
    } catch {
      window.localStorage.removeItem(POSITION_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(SIGNAL_PLAN_STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as SignalPlan;
      if (parsed?.contractKey && parsed?.displayAction) setSignalPlan(parsed);
    } catch {
      window.localStorage.removeItem(SIGNAL_PLAN_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/market-data', { cache: 'no-store' });
        const data = await res.json();
        if (!cancelled && isMarketSnapshot(data)) setSnapshot(data);
        if (!res.ok) {
          if (!cancelled) setError(buildFriendlyError(data));
          return;
        }
        if (!cancelled) setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown market-data error');
      }
    }
    load();
    const timer = window.setInterval(load, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  async function runApiTest() {
    setTesting(true);
    const endpoints = ['health', 'coinbase', 'fallback', 'kalshi'] as const;
    const result: ApiTest = {};
    for (const endpoint of endpoints) {
      try {
        const res = await fetch(`/api/${endpoint}`, { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        result[endpoint] = res.ok ? 'OK' : `Failed: ${body?.error ?? res.status}`;
      } catch (err) {
        result[endpoint] = err instanceof Error ? `Failed: ${err.message}` : 'Failed';
      }
    }
    setApiTest(result);
    setTesting(false);
  }

  const countdown = useMemo(() => buildCountdown(now), [now]);
  const decision = useMemo(() => calculateDecision(snapshot, countdown), [snapshot, countdown]);
  const positionAssessment = useMemo(() => position ? assessPosition(position, snapshot, decision, countdown) : null, [position, snapshot, decision, countdown]);
  const tradingDesk = useMemo(() => buildTradingDesk(snapshot, decision, signalPlan, countdown), [snapshot, decision, signalPlan, countdown]);
  const priceFeedLive = snapshot.btcPrice !== null && snapshot.candles.length >= 10;

  const latestDecisionRef = useRef(decision);
  const latestCountdownRef = useRef(countdown);
  const latestNowRef = useRef(now);
  latestDecisionRef.current = decision;
  latestCountdownRef.current = countdown;
  latestNowRef.current = now;

  useEffect(() => {
    if (position) return;
    setSignalPlan((previous) => {
      const next = updateSignalPlan({
        previous,
        decision: latestDecisionRef.current,
        countdown: latestCountdownRef.current,
        now: latestNowRef.current,
      });
      window.localStorage.setItem(SIGNAL_PLAN_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [snapshot.fetchedAt, position]);

  function lockPosition(side: TradeSide) {
    const locked = createLockedPosition(side, snapshot, decision, countdown);
    setPosition(locked);
    window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(locked));
  }

  function clearPosition() {
    setPosition(null);
    window.localStorage.removeItem(POSITION_STORAGE_KEY);
  }

  const activeSignal = signalPlan;
  const price = snapshot.btcPrice ? `$${snapshot.btcPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : 'Loading';
  const strike = snapshot.strike ? `$${snapshot.strike.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'Detecting';
  const distance = snapshot.btcPrice && snapshot.strike ? snapshot.btcPrice - snapshot.strike : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.38em] text-edge-blue">Genesis-007</div>
          <h1 className="text-3xl font-black tracking-tight">Edge15</h1>
        </div>
        <div className={`rounded-full border px-3 py-2 text-xs ${priceFeedLive ? 'border-edge-green/40 bg-edge-green/10 text-edge-green' : 'border-edge-amber/40 bg-edge-amber/10 text-edge-amber'}`}>
          {priceFeedLive ? 'Price feed live' : 'Price feed degraded'}
        </div>
      </header>

      <Panel className="text-center">
        <div className="text-sm uppercase tracking-[0.22em] text-edge-muted">Time remaining</div>
        <div className="mt-1 text-6xl font-black tracking-tighter sm:text-7xl">{countdown.display}</div>
        <div className="mt-2 text-sm text-edge-muted">Current 15-minute window • live data refreshes every 3 seconds</div>
      </Panel>

      <Panel title="Workspace controls">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {Object.entries(visibleSections).map(([key, visible]) => (
            <button
              key={key}
              onClick={() => toggleSection(key as SectionKey)}
              className={`rounded-xl border px-3 py-2 text-xs font-bold ${visible ? 'border-edge-blue/50 bg-edge-blue/10 text-edge-blue' : 'border-edge-line bg-black/20 text-edge-muted'}`}
            >
              {visible ? 'Hide' : 'Show'} {sectionLabel(key as SectionKey)}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title={position ? "Trade context" : "Entry mode"}>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric
            label="Trade Plan"
            value={activeSignal?.displayAction ?? decision.action}
            detail={activeSignal?.planText ?? decision.reason}
            help={tradePlanHelp(activeSignal?.status, activeSignal?.direction ?? decision.direction)}
            tone={activeSignal?.tone ?? decision.tone}
          />
          <Metric
            label="Entry Score"
            value={`${decision.entryScore}/100`}
            detail={decision.entryQuality}
            help={entryScoreHelp(decision.entryScore)}
            tone={activeSignal?.tone ?? decision.tone}
          />
          <Metric
            label="Opportunity"
            value={`${decision.opportunity}%`}
            detail={decision.opportunityLabel}
            help={opportunityHelp(decision.opportunity)}
            tone={decision.opportunity > 75 ? 'good' : decision.opportunity > 55 ? 'warn' : 'bad'}
          />
          <Metric
            label="Trade Grade"
            value={decision.tradeGrade}
            detail={`${decision.confidence}% confidence`}
            help={tradeGradeHelp(decision.tradeGrade)}
            tone={activeSignal?.tone ?? decision.tone}
          />
          <Metric
            label="Model Trust"
            value={`${tradingDesk.modelConfidence}%`}
            detail="Chief AI self-check"
            help={modelTrustHelp(tradingDesk.modelConfidence)}
            tone={tradingDesk.modelConfidence >= 75 ? 'good' : tradingDesk.modelConfidence >= 58 ? 'warn' : 'bad'}
          />
          <Metric
            label="Signal Stability"
            value={`${activeSignal?.stability ?? decision.stability}%`}
            detail={activeSignal ? `${activeSignal.status} • ${activeSignal.confirmations} confirmations` : 'Building plan'}
            help={signalStabilityHelp(activeSignal?.stability ?? decision.stability)}
            tone={(activeSignal?.stability ?? decision.stability) > 70 ? 'good' : (activeSignal?.stability ?? decision.stability) > 55 ? 'warn' : 'bad'}
          />
        </div>
        {position ? (
          <div className="mt-4 rounded-xl border border-edge-blue/30 bg-edge-blue/10 px-3 py-3 text-xs text-edge-muted">
            Trade context stays visible after entry so you can compare the original plan against the current HOLD / CAUTION / DANGER assessment.
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button onClick={() => lockPosition('OVER')} disabled={!snapshot.btcPrice} className="rounded-2xl border border-edge-green/40 bg-edge-green/10 px-4 py-4 text-lg font-black text-edge-green disabled:opacity-40">Entered OVER</button>
            <button onClick={() => lockPosition('UNDER')} disabled={!snapshot.btcPrice} className="rounded-2xl border border-edge-red/40 bg-edge-red/10 px-4 py-4 text-lg font-black text-edge-red disabled:opacity-40">Entered UNDER</button>
          </div>
        )}
      </Panel>

      {position && positionAssessment ? (
        <Panel title="Locked position mode">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Position" value={position.side} detail={`Locked with ${position.entryWindow} remaining`} help="The side you said you entered. Edge15 now manages the position instead of looking for a new entry." tone="blue" />
            <Metric label="Status" value={positionAssessment.status} detail={positionAssessment.riskLabel} help="HOLD means the trade is still behaving normally. CAUTION means pressure is building. DANGER means the plan may be failing." tone={positionAssessment.tone} />
            <Metric label="Entry" value={position.entryPrice === null ? '—' : `$${position.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} detail={`Grade ${position.entryGrade} • score ${position.entryScore}`} help="Snapshot of the setup when you pressed Entered OVER or Entered UNDER." tone="neutral" />
            <Metric label="Since Entry" value={positionAssessment.distanceSinceEntry === null ? '—' : `${positionAssessment.distanceSinceEntry >= 0 ? '+' : ''}$${positionAssessment.distanceSinceEntry.toFixed(0)}`} detail="BTC move from lock" help="Shows whether BTC has moved with or against your locked side since entry." tone={positionAssessment.distanceSinceEntry === null ? 'neutral' : positionAssessment.distanceSinceEntry >= 0 === (position.side === 'OVER') ? 'good' : 'bad'} />
          </div>
          <div className="mt-4 rounded-2xl border border-edge-line bg-black/20 p-4 text-sm leading-6 text-slate-200">
            {positionAssessment.story}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button onClick={clearPosition} className="rounded-xl border border-edge-line bg-slate-950 px-3 py-3 text-sm font-bold text-white hover:border-edge-blue/60">Clear / contract ended</button>
            <div className="rounded-xl border border-edge-line bg-black/20 px-3 py-3 text-xs text-edge-muted">Entry locked at {new Date(position.entryTime).toLocaleTimeString()} • Edge15 now manages HOLD / CAUTION / DANGER instead of new entry advice.</div>
          </div>
        </Panel>
      ) : null}

      {visibleSections.aiDesk ? (
        <Panel title="AI Trading Desk">
          <div className="rounded-2xl border border-edge-blue/30 bg-edge-blue/10 p-4 text-sm leading-6 text-slate-100">
            {tradingDesk.chiefSummary}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tradingDesk.engines.map((engine) => <EngineCard key={engine.id} engine={engine} />)}
          </div>
          <div className="mt-4 rounded-2xl border border-edge-line bg-black/20 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-edge-muted">AI Debate</div>
            <div className="mt-3 space-y-2 text-sm leading-6 text-slate-200">
              {tradingDesk.debate.map((line) => <div key={line} className="rounded-xl border border-edge-line bg-black/20 p-3">{line}</div>)}
            </div>
          </div>
        </Panel>
      ) : null}

      {visibleSections.marketStory ? (
        <Panel title={position ? 'Position story' : 'Market story'}>
          <p className="text-base leading-7 text-slate-200">{positionAssessment?.story ?? tradingDesk.marketStory}</p>
        </Panel>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Market">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="BTC" value={price} detail={snapshot.source} tone="blue" />
            <Metric label="Reference" value={strike} detail={snapshot.kalshi?.derivedStrike ? 'Derived from 15m window open candle' : snapshot.kalshi?.strikeSource ? `Source: ${snapshot.kalshi.strikeSource}` : snapshot.kalshi?.ticker ?? 'Kalshi optional'} />
            <Metric label="Distance" value={distance === null ? '—' : `${distance >= 0 ? '+' : ''}$${distance.toFixed(0)}`} detail={distance === null ? 'Waiting for reference' : distance >= 0 ? 'Above strike' : 'Below strike'} tone={distance === null ? 'neutral' : distance >= 0 ? 'good' : 'bad'} />
            <Metric label="Candles" value={`${snapshot.candles.length}`} detail="1m candles available" tone={snapshot.candles.length >= 10 ? 'good' : 'warn'} />
          </div>
        </Panel>

        {visibleSections.dataHealth ? (
          <Panel title="Data health">
            <div className="space-y-2 text-sm">
              <HealthRow label="Coinbase" diagnostic={snapshot.diagnostics.coinbase} />
              <HealthRow label="Fallback" diagnostic={snapshot.diagnostics.fallback} />
              <HealthRow label="Kalshi" diagnostic={snapshot.diagnostics.kalshi} />
              <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Kalshi odds</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-slate-500">YES bid</span><div className="font-semibold">{snapshot.kalshi?.yesBid ?? '—'}¢</div></div>
                  <div><span className="text-slate-500">YES ask</span><div className="font-semibold">{snapshot.kalshi?.yesAsk ?? '—'}¢</div></div>
                </div>
                <div className="mt-2 text-xs text-slate-500">Source: {snapshot.kalshi?.oddsSource ?? 'not detected'}</div>
              </div>
              {error ? <div className="rounded-xl border border-edge-amber/40 bg-edge-amber/10 p-3 text-edge-amber">{error}</div> : null}
              <div className="text-xs text-edge-muted">Last update: {snapshot.fetchedAt ? new Date(snapshot.fetchedAt).toLocaleTimeString() : 'not yet'}</div>
              <button onClick={runApiTest} disabled={testing} className="w-full rounded-xl border border-edge-blue/40 bg-edge-blue/10 px-3 py-2 text-sm font-bold text-edge-blue disabled:opacity-60">
                {testing ? 'Testing APIs...' : 'Run API Test'}
              </button>
              {Object.keys(apiTest).length ? <ApiTestResults results={apiTest} /> : null}
            </div>
          </Panel>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {visibleSections.indicators ? (
          <Panel title="Indicators">
            <div className="grid grid-cols-2 gap-3">
              <Metric label="RSI 14" value={formatIndicator(decision.indicators.rsi14, 0)} detail={describeRsi(decision.indicators.rsi14)} tone={indicatorTone(decision.indicators.rsi14)} />
              <Metric label="EMA Bias" value={decision.indicators.trendBias.toUpperCase()} detail={formatEmaSpread(decision.indicators.ema9, decision.indicators.ema21)} tone={biasTone(decision.indicators.trendBias)} />
              <Metric label="VWAP" value={formatPrice(decision.indicators.vwap)} detail={decision.indicators.vwapBias === 'unknown' ? 'Loading' : `Price ${decision.indicators.vwapBias} VWAP`} tone={decision.indicators.vwapBias === 'above' ? 'good' : decision.indicators.vwapBias === 'below' ? 'bad' : 'neutral'} />
              <Metric label="Momentum 5m" value={formatSigned(decision.indicators.momentum5m)} detail={decision.indicators.momentumBias} tone={biasTone(decision.indicators.momentumBias)} />
              <Metric label="ATR 14" value={formatIndicator(decision.indicators.atr14, 1)} detail="1m volatility" tone="blue" />
              <Metric label="Volatility" value={decision.indicators.volatilityPct === null ? '—' : `${decision.indicators.volatilityPct.toFixed(3)}%`} detail="ATR as % of price" tone={decision.indicators.volatilityPct !== null && decision.indicators.volatilityPct > 0.12 ? 'warn' : 'neutral'} />
            </div>
          </Panel>
        ) : null}

        {visibleSections.whyNot ? (
          <Panel title={position ? 'Position warnings' : 'Why not / trade plan?'}>
            <ul className="space-y-2 text-sm text-slate-200">
              {(positionAssessment?.reasons ?? tradingDesk.whyNot).map((item) => (
                <li key={item} className="rounded-xl border border-edge-line bg-black/20 p-3">{item}</li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>

      {visibleSections.genesisStatus ? (
        <Panel title="Genesis-007 status">
          <ul className="list-disc space-y-2 pl-5 text-sm text-edge-muted">
            <li>Entry-mode boxes now include short plain-English explanations for phone use.</li>
            <li>Entry Score, Opportunity, Trade Grade, Model Trust, and Signal Stability explain what their values mean.</li>
            <li>Trade Plan context now remains visible after you tap Entered OVER or Entered UNDER.</li>
            <li>Locked Position Mode adds HOLD / CAUTION / DANGER without hiding the original trade context.</li>
            <li>Genesis-006 AI Trading Desk, Genesis-005 trade-plan stability, and Genesis-004 locked position mode remain intact.</li>
          </ul>
        </Panel>
      ) : null}
    </main>
  );
}

function EngineCard({ engine }: { engine: EngineVote }) {
  return (
    <div className="rounded-2xl border border-edge-line bg-black/18 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-white">{engine.name}</div>
          <div className="mt-1 text-xs text-edge-muted">{engine.role}</div>
        </div>
        <div className={`rounded-full border px-2 py-1 text-xs font-black ${badgeClass(engine.tone)}`}>{engine.bias}</div>
      </div>
      <div className="mt-3 text-2xl font-black">{engine.confidence}%</div>
      <div className="mt-2 text-sm leading-6 text-slate-200">{engine.message}</div>
    </div>
  );
}

function HealthRow({ label, diagnostic }: { label: string; diagnostic: FeedDiagnostic }) {
  const tone = diagnostic.status === 'ok' ? 'text-edge-green' : diagnostic.status === 'unknown' ? 'text-edge-muted' : diagnostic.status === 'degraded' ? 'text-edge-amber' : 'text-edge-red';
  const latency = diagnostic.latencyMs === null ? '' : ` • ${diagnostic.latencyMs}ms`;
  return (
    <div className="rounded-xl border border-edge-line bg-black/15 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <span className={tone}>{diagnostic.status.toUpperCase()}</span>
      </div>
      <div className="mt-1 text-xs text-edge-muted">{diagnostic.message}{latency}</div>
    </div>
  );
}

function ApiTestResults({ results }: { results: ApiTest }) {
  return (
    <div className="rounded-xl border border-edge-line bg-black/20 p-3 text-xs text-edge-muted">
      {Object.entries(results).map(([key, value]) => (
        <div key={key} className="flex justify-between gap-3 py-1">
          <span className="capitalize">{key}</span>
          <span className={value === 'OK' ? 'text-edge-green' : 'text-edge-red'}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function isMarketSnapshot(value: unknown): value is MarketSnapshot {
  return typeof value === 'object' && value !== null && 'health' in value && 'diagnostics' in value;
}

function buildFriendlyError(data: Partial<MarketSnapshot> & { error?: string }) {
  const coinbase = data?.diagnostics?.coinbase?.message;
  const fallback = data?.diagnostics?.fallback?.message;
  if (coinbase || fallback) return `Price feed unavailable. Coinbase: ${coinbase ?? 'not checked'} Fallback: ${fallback ?? 'not checked'}`;
  return data?.error ?? 'Market data request failed';
}

function formatPrice(value: number | null) {
  return value === null ? '—' : `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatIndicator(value: number | null, digits: number) {
  return value === null ? '—' : value.toFixed(digits);
}

function formatSigned(value: number | null) {
  if (value === null) return '—';
  return `${value >= 0 ? '+' : ''}$${value.toFixed(0)}`;
}

function formatEmaSpread(ema9: number | null, ema21: number | null) {
  if (ema9 === null || ema21 === null) return 'Loading EMA 9/21';
  const spread = ema9 - ema21;
  return `${spread >= 0 ? '+' : ''}${spread.toFixed(2)} EMA spread`;
}

function describeRsi(value: number | null) {
  if (value === null) return 'Loading';
  if (value >= 70) return 'Hot / extended';
  if (value >= 55) return 'Bullish momentum';
  if (value <= 30) return 'Oversold';
  if (value <= 45) return 'Bearish momentum';
  return 'Neutral';
}

function indicatorTone(value: number | null): 'neutral' | 'good' | 'warn' | 'bad' | 'blue' {
  if (value === null) return 'neutral';
  if (value >= 55) return 'good';
  if (value <= 45) return 'bad';
  return 'neutral';
}

function biasTone(bias: string): 'neutral' | 'good' | 'warn' | 'bad' | 'blue' {
  if (bias === 'bullish' || bias === 'above') return 'good';
  if (bias === 'bearish' || bias === 'below') return 'bad';
  return 'neutral';
}

function badgeClass(tone: 'neutral' | 'good' | 'warn' | 'bad' | 'blue') {
  if (tone === 'good') return 'border-edge-green/40 bg-edge-green/10 text-edge-green';
  if (tone === 'bad') return 'border-edge-red/40 bg-edge-red/10 text-edge-red';
  if (tone === 'warn') return 'border-edge-amber/40 bg-edge-amber/10 text-edge-amber';
  if (tone === 'blue') return 'border-edge-blue/40 bg-edge-blue/10 text-edge-blue';
  return 'border-edge-line bg-black/20 text-edge-muted';
}


function tradePlanHelp(status: SignalStatus | undefined, direction: SignalDirection) {
  if (!status || status === 'NO PLAN') return 'Market is unclear. Edge15 does not have enough evidence to build an OVER or UNDER plan yet.';
  if (status === 'BUILDING') return `${direction} is starting to form, but the setup still needs more confirmation before entry.`;
  if (status === 'WATCH') return `Possible ${direction} setup. Watch it, but Edge15 is not calling it entry-ready yet.`;
  if (status === 'LEAN') return `${direction} evidence is getting stronger, but the plan is not fully confirmed.`;
  if (status === 'READY') return `${direction} is close to actionable. Edge15 is waiting for final stability before ENTER.`;
  if (status === 'ENTER') return `${direction} has enough confirmation and stability for Edge15 to consider entry now.`;
  if (status === 'HOLD SIGNAL') return `The original ${direction} idea is still alive, but current conditions weakened slightly.`;
  if (status === 'CAUTION') return `${direction} plan is under pressure. Avoid late entry unless the signal recovers.`;
  if (status === 'CANCELLED') return 'The setup broke down. Edge15 does not want to enter that plan now.';
  return 'Current trade-plan stage in the 15-minute signal ladder.';
}

function entryScoreHelp(score: number) {
  if (score >= 82) return 'Strong timing. Conditions are close to entry quality right now.';
  if (score >= 68) return 'Good timing is developing, but Edge15 still wants confirmation.';
  if (score >= 52) return 'Mixed timing. The setup may be forming, but it is not clean yet.';
  return 'Weak timing. Edge15 does not see a clean entry moment.';
}

function opportunityHelp(value: number) {
  if (value >= 82) return 'High-quality 15-minute window. The market has enough movement and structure to be worth attention.';
  if (value >= 68) return 'Good opportunity, but not perfect. Confirmation and stability still matter.';
  if (value >= 52) return 'Developing opportunity. There may be a trade later, but the edge is not strong yet.';
  if (value >= 34) return 'Thin opportunity. Edge15 sees a low-quality or messy setup.';
  return 'Poor opportunity. Skipping this market may be the better decision.';
}

function tradeGradeHelp(grade: string) {
  if (grade === 'A+' || grade === 'A') return 'Premium setup quality. This is the type of trade Edge15 wants to focus on.';
  if (grade === 'B+' || grade === 'B') return 'Good setup, but not elite. Use the trade plan and stability before entering.';
  if (grade === 'C') return 'Average setup. There is some evidence, but the trade is not especially clean.';
  if (grade === 'D') return 'Low-quality setup. Edge15 needs better agreement before trusting it.';
  return 'Very weak setup. Edge15 would generally avoid this market.';
}

function modelTrustHelp(value: number) {
  if (value >= 80) return 'Edge15 trusts its own read because the engines are aligned and the setup is familiar.';
  if (value >= 65) return 'Moderate trust. The model has a usable read, but there is some disagreement.';
  if (value >= 50) return 'Low-to-moderate trust. Treat the recommendation carefully.';
  return 'Low trust. Edge15 is uncertain and the current market is not giving a clean read.';
}

function signalStabilityHelp(value: number) {
  if (value >= 80) return 'Very stable. Edge15 has been consistently favoring this plan instead of flipping around.';
  if (value >= 65) return 'Stable enough to matter, but still watch for sudden weakening.';
  if (value >= 50) return 'Developing stability. Edge15 needs more consistent updates before strong confidence.';
  return 'Unstable. The signal is jumpy or not confirmed enough yet.';
}

function sectionLabel(key: SectionKey) {
  const labels: Record<SectionKey, string> = {
    aiDesk: 'AI Desk',
    marketStory: 'Story',
    indicators: 'Indicators',
    whyNot: 'Why Not',
    dataHealth: 'Data',
    genesisStatus: 'Status',
  };
  return labels[key];
}
