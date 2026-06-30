'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from '@/components/ui/Panel';
import { Metric } from '@/components/ui/Metric';
import type { FeedDiagnostic, MarketSnapshot } from '@/lib/types/market';
import type { LockedPosition, TradeSide } from '@/lib/types/position';
import { calculateDecision } from '@/lib/decision/calculateDecision';
import type { Decision, Tone } from '@/lib/types/decision';
import { buildCountdown, type Countdown } from '@/lib/position/countdown';
import { assessPosition, createLockedPosition, POSITION_STORAGE_KEY } from '@/lib/position/positionManager';
import { SIGNAL_PLAN_STORAGE_KEY, updateSignalPlan } from '@/lib/signal/signalPlan';
import type { SignalDirection, SignalPlan, SignalStatus } from '@/lib/types/signal';
import type { TradeJournalEntry, TradeOutcome, TradeReviewReason } from '@/lib/types/journal';
import { createJournalEntry, outcomeLabel, reviewReasonLabel, summarizeJournal, TRADE_JOURNAL_STORAGE_KEY } from '@/lib/journal/tradeJournal';
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
  recentPeriods: [],
  orderBook: null,
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
const ENGINE_AVERAGE_STORAGE_KEY = 'edge15.engineAverages.v1';
const ACTIVE_JOURNAL_ID_STORAGE_KEY = 'edge15.activeJournalEntryId.v1';
const QUALITY_FILTER_STORAGE_KEY = 'edge15.tradeQualityFilter.v1';
const COMMITMENT_ACCURACY_STORAGE_KEY = 'edge15.commitmentAccuracy.v1';
const DEFAULT_VISIBLE_SECTIONS = {
  aiDesk: true,
  marketStory: true,
  indicators: true,
  whyNot: true,
  dataHealth: true,
  tradeJournal: true,
  genesisStatus: true,
};

type SectionKey = keyof typeof DEFAULT_VISIBLE_SECTIONS;

type ApiTest = {
  health?: string;
  coinbase?: string;
  fallback?: string;
  kalshi?: string;
};

type EngineAverage = { average: number; samples: number };
type EngineAverages = Record<string, EngineAverage>;
type QualityFilter = 'ANY' | 'B_PLUS' | 'A_ONLY';
type SignalHistoryPoint = { label: string; action: string; direction: string; confidence: number; entryScore: number };
type CommitmentAccuracyRecord = {
  contractKey: string;
  committedDirection: 'OVER' | 'UNDER' | 'NONE';
  outcome: 'OVER' | 'UNDER' | 'FLAT' | 'UNKNOWN';
  correct: boolean | null;
  committedAt: string | null;
  resolvedAt: string;
  open: number | null;
  close: number | null;
  entryScore: number | null;
  confidence: number | null;
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
  const [engineAverages, setEngineAverages] = useState<EngineAverages>({});
  const [journal, setJournal] = useState<TradeJournalEntry[]>([]);
  const [activeJournalId, setActiveJournalId] = useState<string | null>(null);
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('ANY');
  const [signalHistory, setSignalHistory] = useState<SignalHistoryPoint[]>([]);
  const [commitmentAccuracy, setCommitmentAccuracy] = useState<CommitmentAccuracyRecord[]>([]);

  useEffect(() => {
    const savedAccuracy = window.localStorage.getItem(COMMITMENT_ACCURACY_STORAGE_KEY);
    if (savedAccuracy) {
      try {
        const parsed = JSON.parse(savedAccuracy) as CommitmentAccuracyRecord[];
        if (Array.isArray(parsed)) setCommitmentAccuracy(parsed.slice(0, 10));
      } catch {
        window.localStorage.removeItem(COMMITMENT_ACCURACY_STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    const savedFilter = window.localStorage.getItem(QUALITY_FILTER_STORAGE_KEY) as QualityFilter | null;
    if (savedFilter === 'ANY' || savedFilter === 'B_PLUS' || savedFilter === 'A_ONLY') setQualityFilter(savedFilter);
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(SECTION_STORAGE_KEY);
    if (!saved) return;
    try {
      setVisibleSections({ ...DEFAULT_VISIBLE_SECTIONS, ...JSON.parse(saved) });
    } catch {
      window.localStorage.removeItem(SECTION_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(ENGINE_AVERAGE_STORAGE_KEY);
    if (!saved) return;
    try {
      setEngineAverages(JSON.parse(saved) as EngineAverages);
    } catch {
      window.localStorage.removeItem(ENGINE_AVERAGE_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const savedJournal = window.localStorage.getItem(TRADE_JOURNAL_STORAGE_KEY);
    if (savedJournal) {
      try {
        const parsed = JSON.parse(savedJournal) as TradeJournalEntry[];
        if (Array.isArray(parsed)) setJournal(parsed);
      } catch {
        window.localStorage.removeItem(TRADE_JOURNAL_STORAGE_KEY);
      }
    }
    const savedActive = window.localStorage.getItem(ACTIVE_JOURNAL_ID_STORAGE_KEY);
    if (savedActive) setActiveJournalId(savedActive);
  }, []);

  function toggleSection(key: SectionKey) {
    setVisibleSections((previous) => {
      const next = { ...previous, [key]: !previous[key] };
      window.localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }


  function chooseQualityFilter(filter: QualityFilter) {
    setQualityFilter(filter);
    window.localStorage.setItem(QUALITY_FILTER_STORAGE_KEY, filter);
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
  const journalSummary = useMemo(() => summarizeJournal(journal), [journal]);
  const activeJournalEntry = useMemo(() => activeJournalId ? journal.find((entry) => entry.id === activeJournalId) ?? null : null, [journal, activeJournalId]);
  const priceFeedLive = snapshot.btcPrice !== null && snapshot.candles.length >= 10;

  useEffect(() => {
    if (!snapshot.fetchedAt || !tradingDesk.engines.length) return;
    setEngineAverages((previous) => {
      const next: EngineAverages = { ...previous };
      for (const engine of tradingDesk.engines) {
        const current = next[engine.id] ?? { average: engine.confidence, samples: 0 };
        const samples = Math.min(current.samples + 1, 300);
        const weight = current.samples >= 300 ? 1 / 300 : 1 / samples;
        next[engine.id] = {
          samples,
          average: Math.round((current.average * (1 - weight) + engine.confidence * weight) * 10) / 10,
        };
      }
      window.localStorage.setItem(ENGINE_AVERAGE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  // Intentionally keyed to fetchedAt so rolling averages update once per market-data refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.fetchedAt]);

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
      if (previous && previous.contractKey !== next.contractKey) {
        recordCommitmentOutcome(previous, snapshot.candles);
      }
      window.localStorage.setItem(SIGNAL_PLAN_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [snapshot.fetchedAt, position, snapshot.candles]);

  function recordCommitmentOutcome(plan: SignalPlan, candles: MarketSnapshot['candles']) {
    const record = resolveCommitmentOutcome(plan, candles);
    if (!record) return;
    setCommitmentAccuracy((previous) => {
      if (previous.some((item) => item.contractKey === record.contractKey)) return previous;
      const next = [record, ...previous].slice(0, 10);
      window.localStorage.setItem(COMMITMENT_ACCURACY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }


  useEffect(() => {
    if (!snapshot.fetchedAt) return;
    const action = signalPlan?.displayAction ?? decision.action;
    const direction = signalPlan?.direction ?? decision.direction;
    setSignalHistory((previous) => {
      const next = [
        ...previous,
        {
          label: countdown.display,
          action,
          direction,
          confidence: decision.confidence,
          entryScore: decision.entryScore,
        },
      ].slice(-12);
      return next;
    });
  }, [snapshot.fetchedAt, decision.action, decision.confidence, decision.direction, decision.entryScore, signalPlan?.displayAction, signalPlan?.direction, countdown.display]);

  function lockPosition(side: TradeSide) {
    const locked = createLockedPosition(side, snapshot, decision, countdown);
    const journalEntry = createJournalEntry({ side, snapshot, decision, countdown, modelTrust: tradingDesk.modelConfidence });
    setPosition(locked);
    setActiveJournalId(journalEntry.id);
    window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(locked));
    window.localStorage.setItem(ACTIVE_JOURNAL_ID_STORAGE_KEY, journalEntry.id);
    setJournal((previous) => {
      const next = [journalEntry, ...previous].slice(0, 50);
      window.localStorage.setItem(TRADE_JOURNAL_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function clearPosition() {
    setPosition(null);
    setActiveJournalId(null);
    window.localStorage.removeItem(POSITION_STORAGE_KEY);
    window.localStorage.removeItem(ACTIVE_JOURNAL_ID_STORAGE_KEY);
  }

  function updateJournalEntry(id: string, updates: Partial<Pick<TradeJournalEntry, 'outcome' | 'reviewReason' | 'note'>>) {
    setJournal((previous) => {
      const next = previous.map((entry) => entry.id === id ? { ...entry, ...updates, updatedAt: new Date().toISOString() } : entry);
      window.localStorage.setItem(TRADE_JOURNAL_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function markActiveTrade(outcome: TradeOutcome) {
    if (!activeJournalEntry) return;
    updateJournalEntry(activeJournalEntry.id, { outcome: activeJournalEntry.outcome === outcome ? null : outcome });
  }

  function setActiveReviewReason(reason: TradeReviewReason) {
    if (!activeJournalEntry) return;
    updateJournalEntry(activeJournalEntry.id, { reviewReason: activeJournalEntry.reviewReason === reason ? null : reason });
  }

  const activeSignal = signalPlan;
  const entryGates = useMemo(() => buildEntryGates(decision, activeSignal, countdown, qualityFilter), [decision, activeSignal, countdown, qualityFilter]);
  const lateWarning = useMemo(() => buildLateEntryWarning(decision, countdown), [decision, countdown]);
  const contradiction = useMemo(() => buildContradictionAlert(decision, activeSignal, countdown), [decision, activeSignal, countdown]);
  const doNotChase = useMemo(() => buildDoNotChaseWarning(decision, activeSignal, countdown), [decision, activeSignal, countdown]);
  const stillEnter = useMemo(() => position ? wouldStillEnterNow(position.side, decision, activeSignal, qualityFilter) : null, [position, decision, activeSignal, qualityFilter]);
  const price = snapshot.btcPrice ? `$${snapshot.btcPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : 'Loading';
  const strike = snapshot.strike ? `$${snapshot.strike.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'Detecting';
  const distance = snapshot.btcPrice && snapshot.strike ? snapshot.btcPrice - snapshot.strike : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.38em] text-edge-blue">Genesis-014</div>
          <h1 className="text-3xl font-black tracking-tight">Edge15</h1>
        </div>
        <div className={`rounded-full border px-3 py-2 text-xs ${priceFeedLive ? 'border-edge-green/40 bg-edge-green/10 text-edge-green' : 'border-edge-amber/40 bg-edge-amber/10 text-edge-amber'}`}>
          {priceFeedLive ? 'Price feed live' : 'Price feed degraded'}
        </div>
      </header>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Panel className="overflow-hidden bg-gradient-to-br from-slate-950 via-edge-panel to-black">
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div className="rounded-3xl border border-edge-line bg-black/25 p-5 text-center">
              <div className="text-sm uppercase tracking-[0.22em] text-edge-muted">Time remaining</div>
              <div className="mt-2 text-6xl font-black tracking-tighter sm:text-7xl">{countdown.display}</div>
              <div className="mt-3 text-xs text-edge-muted">Current 15-minute window • refreshes every 3 seconds</div>
            </div>
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-[0.22em] text-edge-muted">Current trade plan</div>
              <div className={`rounded-3xl border px-5 py-6 ${badgeClass(activeSignal?.tone ?? decision.tone)}`}>
                <div className="text-4xl font-black tracking-tight sm:text-5xl">{highlightText(activeSignal?.displayAction ?? decision.action)}</div>
                <div className="mt-3 text-sm leading-6 text-slate-300">{highlightText(activeSignal?.planText ?? decision.reason)}</div>
                <div className="mt-4 rounded-2xl border border-edge-line bg-black/20 px-3 py-3 text-xs leading-5 text-slate-400">
                  {highlightText(tradePlanHelp(activeSignal?.status, activeSignal?.direction ?? decision.direction))}
                </div>
                {activeSignal ? <CommitmentStatusCard signal={activeSignal} countdown={countdown} /> : null}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Market snapshot">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="BTC" value={price} detail={snapshot.source} tone="blue" />
            <Metric label="Reference" value={strike} detail={snapshot.kalshi?.derivedStrike ? 'Derived 15m open' : snapshot.kalshi?.strikeSource ? `Source: ${snapshot.kalshi.strikeSource}` : snapshot.kalshi?.ticker ?? 'Kalshi optional'} />
            <Metric label="Distance" value={distance === null ? '—' : `${distance >= 0 ? '+' : ''}$${distance.toFixed(0)}`} detail={distance === null ? 'Waiting for reference' : distance >= 0 ? 'Above strike' : 'Below strike'} tone={distance === null ? 'neutral' : distance >= 0 ? 'good' : 'bad'} />
            <Metric label="Settlement Risk" value={decision.settlement.risk} detail={decision.settlement.mode === 'settlement' ? 'Final 2m reality check' : 'Normal mode'} help={decision.settlement.message} tone={decision.settlement.risk === 'Low' ? 'good' : decision.settlement.risk === 'Medium' ? 'warn' : 'bad'} />
            <Metric label="Contract Phase" value={contractPhaseLabel(countdown)} detail={contractPhaseDetail(countdown)} help="Edge15 changes emphasis through the 15-minute window: early structure, middle confirmation, then settlement reality near the end." tone={countdown.remainingMs <= 120000 ? 'warn' : 'blue'} />
          </div>
          <div className="mt-3 rounded-2xl border border-edge-line bg-black/20 p-3 text-xs leading-5 text-edge-muted">
            The previous “last 10 periods” strip is temporarily hidden because it was not matching the real 15-minute outcomes reliably. We will re-add it only after the period boundaries are verified.
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <CommitmentAccuracyPanel records={commitmentAccuracy} activeSignal={activeSignal} />
        <MicrostructurePanel orderBook={snapshot.orderBook} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
        <Panel title={position ? "Trade context + position" : "Decision dashboard"}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Metric label="Entry Score" value={`${decision.entryScore}/100`} detail={decision.entryQuality} help={entryScoreHelp(decision.entryScore)} tone={activeSignal?.tone ?? decision.tone} />
            <Metric label="Opportunity" value={`${decision.opportunity}%`} detail={decision.opportunityLabel} help={opportunityHelp(decision.opportunity)} tone={decision.opportunity > 75 ? 'good' : decision.opportunity > 55 ? 'warn' : 'bad'} />
            <Metric label="Trade Grade" value={decision.tradeGrade} detail={`${decision.confidence}% confidence`} help={tradeGradeHelp(decision.tradeGrade)} tone={activeSignal?.tone ?? decision.tone} />
            <Metric label="Model Trust" value={`${tradingDesk.modelConfidence}%`} detail="Chief AI self-check" help={modelTrustHelp(tradingDesk.modelConfidence)} tone={tradingDesk.modelConfidence >= 75 ? 'good' : tradingDesk.modelConfidence >= 58 ? 'warn' : 'bad'} />
            <Metric label="Signal Stability" value={`${activeSignal?.stability ?? decision.stability}%`} detail={activeSignal ? `${activeSignal.status} • ${activeSignal.confirmations} confirmations` : 'Building plan'} help={signalStabilityHelp(activeSignal?.stability ?? decision.stability)} tone={(activeSignal?.stability ?? decision.stability) > 70 ? 'good' : (activeSignal?.stability ?? decision.stability) > 55 ? 'warn' : 'bad'} />
            <Metric label="Candles" value={`${snapshot.candles.length}`} detail="1m candles available" help="More candle history gives Edge15 a stronger indicator read." tone={snapshot.candles.length >= 10 ? 'good' : 'warn'} />
          </div>


          <div className="mt-4 grid gap-3">
            <EntryGateChecklist gates={entryGates} activeSignal={activeSignal} decision={decision} qualityFilter={qualityFilter} onQualityFilter={chooseQualityFilter} />
            <div className="grid gap-3 xl:grid-cols-[0.7fr_1.3fr]">
              <ConfidenceHeatStrip history={signalHistory} />
              <div className="grid gap-3 lg:grid-cols-3">
                {lateWarning ? <AlertCard title="Late-entry warning" message={lateWarning} tone="warn" /> : null}
                {contradiction ? <AlertCard title="Contradiction alert" message={contradiction} tone="bad" /> : null}
                {doNotChase ? <AlertCard title="Do not chase" message={doNotChase} tone="warn" /> : null}
              </div>
            </div>
          </div>

          {position && positionAssessment ? (
            <div className="mt-4 rounded-3xl border border-edge-blue/30 bg-edge-blue/10 p-4">
              <div className="mb-3 text-xs uppercase tracking-[0.22em] text-edge-muted">Locked position mode</div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Position" value={position.side} detail={`Locked with ${position.entryWindow} remaining`} help="The side you said you entered. Edge15 now manages the position instead of looking for a new entry." tone="blue" />
                <Metric label="Status" value={positionAssessment.status} detail={positionAssessment.riskLabel} help="HOLD means the trade is still behaving normally. CAUTION means pressure is building. DANGER means the plan may be failing." tone={positionAssessment.tone} />
                <Metric label="Entry" value={position.entryPrice === null ? '—' : `$${position.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} detail={`Grade ${position.entryGrade} • score ${position.entryScore}`} help="Snapshot of the setup when you pressed Entered OVER or Entered UNDER." tone="neutral" />
                <Metric label="Since Entry" value={positionAssessment.distanceSinceEntry === null ? '—' : `${positionAssessment.distanceSinceEntry >= 0 ? '+' : ''}$${positionAssessment.distanceSinceEntry.toFixed(0)}`} detail="BTC move from lock" help="Shows whether BTC has moved with or against your locked side since entry." tone={positionAssessment.distanceSinceEntry === null ? 'neutral' : positionAssessment.distanceSinceEntry >= 0 === (position.side === 'OVER') ? 'good' : 'bad'} />
              </div>
              <div className="mt-4 rounded-2xl border border-edge-line bg-black/20 p-4 text-sm leading-6 text-slate-200">{positionAssessment.story}</div>
              {stillEnter ? <div className={`mt-3 rounded-2xl border p-4 text-sm leading-6 ${stillEnter.tone === 'good' ? 'border-edge-green/30 bg-edge-green/10 text-edge-green' : stillEnter.tone === 'bad' ? 'border-edge-red/30 bg-edge-red/10 text-edge-red' : 'border-edge-amber/30 bg-edge-amber/10 text-edge-amber'}`}><span className="font-black">Would Edge15 still enter now? {stillEnter.answer}.</span> {stillEnter.reason}</div> : null}
              <button onClick={clearPosition} className="mt-4 w-full rounded-xl border border-edge-line bg-slate-950 px-3 py-3 text-sm font-bold text-white hover:border-edge-blue/60">Clear / contract ended</button>
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button onClick={() => lockPosition('OVER')} disabled={!snapshot.btcPrice} className="rounded-2xl border border-edge-green/40 bg-edge-green/10 px-4 py-4 text-lg font-black text-edge-green disabled:opacity-40">Entered OVER</button>
              <button onClick={() => lockPosition('UNDER')} disabled={!snapshot.btcPrice} className="rounded-2xl border border-edge-red/40 bg-edge-red/10 px-4 py-4 text-lg font-black text-edge-red disabled:opacity-40">Entered UNDER</button>
            </div>
          )}

          {activeJournalEntry ? (
            <TradeReviewCard
              entry={activeJournalEntry}
              onOutcome={markActiveTrade}
              onReason={setActiveReviewReason}
            />
          ) : null}
        </Panel>

        <Panel title={position ? 'Position story' : 'Market story'}>
          <p className="text-base leading-7 text-slate-200">{positionAssessment?.story ?? tradingDesk.marketStory}</p>
        </Panel>
      </section>

      {visibleSections.tradeJournal ? (
        <Panel title="Trade Review + Learning Log">
          <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
            <JournalSummaryCard summary={journalSummary} />
            <RecentTrades entries={journal.slice(0, 10)} onSelect={(id) => setActiveJournalId(id)} activeId={activeJournalId} />
          </div>
        </Panel>
      ) : null}

      <Panel title="View controls">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {Object.entries(visibleSections).map(([key, visible]) => (
            <button key={key} onClick={() => toggleSection(key as SectionKey)} className={`rounded-xl border px-3 py-2 text-xs font-bold ${visible ? 'border-edge-blue/50 bg-edge-blue/10 text-edge-blue' : 'border-edge-line bg-black/20 text-edge-muted'}`}>
              {visible ? 'Hide' : 'Show'} {sectionLabel(key as SectionKey)}
            </button>
          ))}
        </div>
      </Panel>

      {visibleSections.aiDesk ? (
        <Panel title="AI Trading Desk">
          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-edge-blue/30 bg-edge-blue/10 p-4 text-sm leading-6 text-slate-100">{tradingDesk.chiefSummary}</div>
            <div className="rounded-2xl border border-edge-line bg-black/20 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-edge-muted">AI Debate</div>
              <div className="mt-3 space-y-2 text-sm leading-6 text-slate-200">
                {tradingDesk.debate.map((line) => <div key={line} className="rounded-xl border border-edge-line bg-black/20 p-3">{highlightText(line)}</div>)}
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tradingDesk.engines.map((engine) => <EngineCard key={engine.id} engine={engine} average={engineAverages[engine.id]} />)}
          </div>
        </Panel>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
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
              {(positionAssessment?.reasons ?? tradingDesk.whyNot).map((item) => <li key={item} className="rounded-xl border border-edge-line bg-black/20 p-3">{highlightText(item)}</li>)}
            </ul>
          </Panel>
        ) : null}
      </section>

      {visibleSections.dataHealth ? (
        <Panel title="Data health">
          <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
            <div className="space-y-2 text-sm">
              <HealthRow label="Coinbase" diagnostic={snapshot.diagnostics.coinbase} />
              <HealthRow label="Fallback" diagnostic={snapshot.diagnostics.fallback} />
              <HealthRow label="Kalshi" diagnostic={snapshot.diagnostics.kalshi} />
              {error ? <div className="rounded-xl border border-edge-amber/40 bg-edge-amber/10 p-3 text-edge-amber">{error}</div> : null}
              <div className="text-xs text-edge-muted">Last update: {snapshot.fetchedAt ? new Date(snapshot.fetchedAt).toLocaleTimeString() : 'not yet'}</div>
            </div>
            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Kalshi odds</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-slate-500">YES bid</span><div className="font-semibold">{snapshot.kalshi?.yesBid ?? '—'}¢</div></div>
                  <div><span className="text-slate-500">YES ask</span><div className="font-semibold">{snapshot.kalshi?.yesAsk ?? '—'}¢</div></div>
                </div>
                <div className="mt-2 text-xs text-slate-500">Source: {snapshot.kalshi?.oddsSource ?? 'not detected'}</div>
              </div>
              <button onClick={runApiTest} disabled={testing} className="w-full rounded-xl border border-edge-blue/40 bg-edge-blue/10 px-3 py-2 text-sm font-bold text-edge-blue disabled:opacity-60">{testing ? 'Testing APIs...' : 'Run API Test'}</button>
              {Object.keys(apiTest).length ? <ApiTestResults results={apiTest} /> : null}
            </div>
          </div>
        </Panel>
      ) : null}

      {visibleSections.genesisStatus ? (
        <Panel title="Genesis-014 status">
          <ul className="list-disc space-y-2 pl-5 text-sm text-edge-muted">
            <li>Commitment Accuracy Tracker grades Edge15's locked contract predictions for the last 10 completed windows.</li>
            <li>Market microstructure now uses Coinbase level-2 order book spread, depth, and imbalance as another professional-style data read.</li>
            <li>Genesis-012.1 minute-9 commitment behavior remains intact.</li>
            <li>Genesis-011 entry gates, filters, heat strip, and caution alerts remain intact.</li>
          </ul>
        </Panel>
      ) : null}
    </main>
  );
}

function TradeReviewCard({
  entry,
  onOutcome,
  onReason,
}: {
  entry: TradeJournalEntry;
  onOutcome: (outcome: TradeOutcome) => void;
  onReason: (reason: TradeReviewReason) => void;
}) {
  const outcomes: Array<{ value: TradeOutcome; label: string; tone: string }> = [
    { value: 'WON', label: 'Won', tone: 'border-edge-green/40 bg-edge-green/10 text-edge-green' },
    { value: 'LOST', label: 'Lost', tone: 'border-edge-red/40 bg-edge-red/10 text-edge-red' },
    { value: 'SKIPPED', label: 'Skipped', tone: 'border-edge-line bg-black/20 text-edge-muted' },
    { value: 'BAD_SIGNAL', label: 'Bad Signal', tone: 'border-edge-amber/40 bg-edge-amber/10 text-edge-amber' },
    { value: 'GOOD_SIGNAL_BAD_ENTRY', label: 'Good Signal / Bad Entry', tone: 'border-edge-blue/40 bg-edge-blue/10 text-edge-blue' },
  ];
  const reasons: Array<{ value: TradeReviewReason; label: string }> = [
    { value: 'late_reversal', label: 'Late reversal' },
    { value: 'wrong_side_reference', label: 'Wrong side reference' },
    { value: 'entered_too_late', label: 'Entered too late' },
    { value: 'signal_flipped', label: 'Signal flipped' },
    { value: 'too_close_to_reference', label: 'Too close to reference' },
    { value: 'momentum_failed', label: 'Momentum failed' },
  ];

  return (
    <div className="mt-4 rounded-3xl border border-edge-line bg-black/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-edge-muted">Trade review</div>
          <div className="mt-1 text-sm text-slate-300">Mark how this locked signal turned out so Edge15 can be tuned from real results.</div>
        </div>
        <div className={`rounded-full border px-3 py-1 text-xs font-black ${entry.outcome === 'WON' ? 'border-edge-green/40 bg-edge-green/10 text-edge-green' : entry.outcome === 'LOST' || entry.outcome === 'BAD_SIGNAL' ? 'border-edge-red/40 bg-edge-red/10 text-edge-red' : 'border-edge-line bg-black/20 text-edge-muted'}`}>
          {outcomeLabel(entry.outcome)}
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-5">
        {outcomes.map((item) => (
          <button key={item.value} onClick={() => onOutcome(item.value)} className={`rounded-xl border px-3 py-2 text-xs font-black ${entry.outcome === item.value ? item.tone : 'border-edge-line bg-slate-950 text-slate-300 hover:border-edge-blue/50'}`}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-4 text-xs uppercase tracking-[0.18em] text-edge-muted">What went wrong? Optional</div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {reasons.map((reason) => (
          <button key={reason.value} onClick={() => onReason(reason.value)} className={`rounded-xl border px-3 py-2 text-xs font-bold ${entry.reviewReason === reason.value ? 'border-edge-amber/40 bg-edge-amber/10 text-edge-amber' : 'border-edge-line bg-black/20 text-slate-400 hover:border-edge-amber/40'}`}>
            {reason.label}
          </button>
        ))}
      </div>
      <div className="mt-3 text-xs text-edge-muted">Selected reason: {reviewReasonLabel(entry.reviewReason)}</div>
    </div>
  );
}

function JournalSummaryCard({ summary }: { summary: ReturnType<typeof summarizeJournal> }) {
  return (
    <div className="rounded-2xl border border-edge-line bg-black/20 p-4">
      <div className="text-xs uppercase tracking-[0.22em] text-edge-muted">Daily / browser summary</div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Metric label="Reviewed" value={`${summary.totalReviewed}`} detail="Marked outcomes" help="Trades you marked as won, lost, skipped, bad signal, or good signal / bad entry." tone="blue" />
        <Metric label="Win Rate" value={summary.winRate === null ? '—' : `${summary.winRate}%`} detail="Won vs lost only" help="Skipped and review-only labels are excluded from win-rate math." tone={summary.winRate === null ? 'neutral' : summary.winRate >= 60 ? 'good' : summary.winRate >= 50 ? 'warn' : 'bad'} />
        <Metric label="Wins" value={`${summary.wins}`} detail="Marked won" tone="good" />
        <Metric label="Losses" value={`${summary.losses}`} detail="Marked lost" tone="bad" />
        <Metric label="Bad Signals" value={`${summary.badSignals}`} detail="Model problem" tone="warn" />
        <Metric label="Bad Entry" value={`${summary.goodSignalBadEntry}`} detail="Timing problem" tone="blue" />
      </div>
    </div>
  );
}

function RecentTrades({ entries, activeId, onSelect }: { entries: TradeJournalEntry[]; activeId: string | null; onSelect: (id: string) => void }) {
  if (!entries.length) {
    return (
      <div className="rounded-2xl border border-edge-line bg-black/20 p-4 text-sm leading-6 text-edge-muted">
        No saved trades yet. Press Entered OVER or Entered UNDER to create the first journal snapshot.
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-edge-line bg-black/20 p-4">
      <div className="text-xs uppercase tracking-[0.22em] text-edge-muted">Last 10 Edge15 signals</div>
      <div className="mt-3 space-y-2">
        {entries.map((entry) => (
          <button key={entry.id} onClick={() => onSelect(entry.id)} className={`w-full rounded-xl border p-3 text-left text-sm ${activeId === entry.id ? 'border-edge-blue/50 bg-edge-blue/10' : 'border-edge-line bg-black/20 hover:border-edge-blue/40'}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="font-black">{highlightText(`${entry.side} • Grade ${entry.tradeGrade}`)}</div>
              <div className={entry.outcome === 'WON' ? 'text-edge-green' : entry.outcome === 'LOST' || entry.outcome === 'BAD_SIGNAL' ? 'text-edge-red' : 'text-edge-muted'}>{outcomeLabel(entry.outcome)}</div>
            </div>
            <div className="mt-1 text-xs text-edge-muted">
              {entry.entryWindow} left • score {entry.entryScore} • opportunity {entry.opportunity}% • distance {entry.entryDistance === null ? '—' : `${entry.entryDistance >= 0 ? '+' : ''}$${entry.entryDistance.toFixed(0)}`}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}




function CommitmentAccuracyPanel({ records, activeSignal }: { records: CommitmentAccuracyRecord[]; activeSignal: SignalPlan | null }) {
  const resolved = records.filter((record) => record.correct !== null);
  const correct = resolved.filter((record) => record.correct).length;
  const accuracy = resolved.length ? Math.round((correct / resolved.length) * 100) : null;
  const last = records.slice(0, 10);
  return (
    <Panel title="Commitment accuracy">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Last 10" value={last.length ? `${correct}/${resolved.length}` : '—'} detail="Resolved commitments" help="This grades Edge15's locked minute-9 prediction, not later live recommendations." tone={accuracy === null ? 'neutral' : accuracy >= 60 ? 'good' : accuracy >= 50 ? 'warn' : 'bad'} />
        <Metric label="Accuracy" value={accuracy === null ? '—' : `${accuracy}%`} detail="Won / resolved" help="No Trade and unresolved windows are not counted as wins or losses." tone={accuracy === null ? 'neutral' : accuracy >= 60 ? 'good' : accuracy >= 50 ? 'warn' : 'bad'} />
        <Metric label="Current lock" value={activeSignal?.commitmentStatus === 'COMMITTED' ? activeSignal.committedDirection : activeSignal?.commitmentStatus === 'NO TRADE' ? 'NO TRADE' : 'SCOUTING'} detail="This contract" help="Edge15 records this automatically when the contract rolls into the next 15-minute window." tone={activeSignal?.commitmentStatus === 'COMMITTED' ? 'blue' : 'neutral'} />
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {last.length ? last.map((record) => (
          <div key={record.contractKey} title={commitmentRecordTitle(record)} className={`min-w-[64px] rounded-xl border px-3 py-2 text-center text-xs font-black ${record.correct === true ? 'border-edge-green/40 bg-edge-green/10 text-edge-green' : record.correct === false ? 'border-edge-red/40 bg-edge-red/10 text-edge-red' : 'border-edge-line bg-black/20 text-edge-muted'}`}>
            <div>{record.correct === true ? '✅' : record.correct === false ? '❌' : '—'}</div>
            <div className="mt-1">{highlightText(record.committedDirection)}</div>
            <div className="mt-1 text-[10px] opacity-80">{record.outcome}</div>
          </div>
        )) : <div className="rounded-xl border border-edge-line bg-black/20 p-3 text-sm text-edge-muted">Waiting for completed committed contracts. This will fill automatically after the next window rolls.</div>}
      </div>
      <div className="mt-3 text-xs leading-5 text-edge-muted">Automatic tracker: Edge15 compares the committed plan to the completed 15-minute candle window. It is a model scorecard, not a guarantee of future results.</div>
    </Panel>
  );
}

function MicrostructurePanel({ orderBook }: { orderBook: MarketSnapshot['orderBook'] }) {
  if (!orderBook) {
    return <Panel title="Market microstructure"><div className="rounded-2xl border border-edge-line bg-black/20 p-4 text-sm leading-6 text-edge-muted">Order book data is unavailable on this refresh. Edge15 keeps the main price/candle feed running and treats microstructure as optional.</div></Panel>;
  }
  const pressureTone = orderBook.pressure === 'BUY' ? 'good' : orderBook.pressure === 'SELL' ? 'bad' : 'neutral';
  const imbalancePct = orderBook.imbalance === null ? null : Math.round(orderBook.imbalance * 100);
  return (
    <Panel title="Market microstructure">
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Book Pressure" value={orderBook.pressure} detail={`${orderBook.levelsUsed} levels`} help="Uses top Coinbase level-2 bid and ask depth. BUY means bid depth is meaningfully stronger; SELL means ask depth is stronger." tone={pressureTone} />
        <Metric label="Imbalance" value={imbalancePct === null ? '—' : `${imbalancePct >= 0 ? '+' : ''}${imbalancePct}%`} detail="Bid depth vs ask depth" help="Positive imbalance means more visible bid depth than ask depth. Negative means more visible ask depth than bid depth." tone={pressureTone} />
        <Metric label="Spread" value={orderBook.spread === null ? '—' : `$${orderBook.spread.toFixed(2)}`} detail={orderBook.spreadBps === null ? 'bps unavailable' : `${orderBook.spreadBps.toFixed(2)} bps`} help="Tighter spreads usually mean cleaner execution and more reliable short-term reads." tone={orderBook.spreadBps !== null && orderBook.spreadBps > 2 ? 'warn' : 'blue'} />
        <Metric label="Mid Price" value={formatPrice(orderBook.midPrice)} detail={orderBook.source} help="Midpoint between best bid and best ask." tone="blue" />
      </div>
      <div className="mt-3 text-xs leading-5 text-edge-muted">Common bot-style market data added: order book spread, depth, and imbalance. These are microstructure signals used alongside candles, not replacements for the commitment engine.</div>
    </Panel>
  );
}

function resolveCommitmentOutcome(plan: SignalPlan, candles: MarketSnapshot['candles']): CommitmentAccuracyRecord | null {
  if (plan.commitmentStatus !== 'COMMITTED' && plan.commitmentStatus !== 'NO TRADE') return null;
  const startIso = plan.contractKey.replace('15m:', '');
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return null;
  const endMs = startMs + 15 * 60 * 1000;
  const windowCandles = candles.slice().sort((a, b) => a.time - b.time).filter((c) => c.time >= startMs && c.time < endMs);
  if (windowCandles.length < 2) {
    return {
      contractKey: plan.contractKey,
      committedDirection: plan.committedDirection,
      outcome: 'UNKNOWN',
      correct: null,
      committedAt: plan.committedAt,
      resolvedAt: new Date().toISOString(),
      open: null,
      close: null,
      entryScore: null,
      confidence: null,
    };
  }
  const first = windowCandles[0];
  const last = windowCandles[windowCandles.length - 1];
  const change = last.close - first.open;
  const outcome: CommitmentAccuracyRecord['outcome'] = Math.abs(change) < 0.01 ? 'FLAT' : change > 0 ? 'OVER' : 'UNDER';
  const correct = plan.committedDirection === 'NONE' ? null : outcome === plan.committedDirection;
  return {
    contractKey: plan.contractKey,
    committedDirection: plan.committedDirection,
    outcome,
    correct,
    committedAt: plan.committedAt,
    resolvedAt: new Date().toISOString(),
    open: first.open,
    close: last.close,
    entryScore: null,
    confidence: null,
  };
}

function commitmentRecordTitle(record: CommitmentAccuracyRecord) {
  const change = record.open !== null && record.close !== null ? `Open ${record.open.toFixed(2)} → Close ${record.close.toFixed(2)}` : 'No candle resolution yet';
  return `${record.committedDirection} committed • outcome ${record.outcome} • ${record.correct === true ? 'correct' : record.correct === false ? 'incorrect' : 'not scored'} • ${change}`;
}

function CommitmentStatusCard({ signal, countdown }: { signal: SignalPlan; countdown: Countdown }) {
  const elapsedSeconds = Math.floor(countdown.elapsedMs / 1000);
  const secondsToCommit = Math.max(0, 540 - elapsedSeconds);
  const toneClass = signal.commitmentStatus === 'COMMITTED'
    ? signal.committedDirection === 'OVER'
      ? 'border-edge-green/40 bg-edge-green/10 text-edge-green'
      : 'border-edge-red/40 bg-edge-red/10 text-edge-red'
    : signal.commitmentStatus === 'NO TRADE'
      ? 'border-edge-line bg-black/20 text-edge-muted'
      : 'border-edge-blue/40 bg-edge-blue/10 text-edge-blue';
  const label = signal.commitmentStatus === 'COMMITTED'
    ? `Locked Prediction: ${signal.committedDirection}`
    : signal.commitmentStatus === 'NO TRADE'
      ? 'Locked Prediction: No Trade'
      : `Scout Mode: commitment in ${Math.floor(secondsToCommit / 60)}:${String(secondsToCommit % 60).padStart(2, '0')}`;

  return (
    <div className={`mt-3 rounded-2xl border px-3 py-3 text-xs leading-5 ${toneClass}`}>
      <div className="font-black uppercase tracking-[0.16em]">{highlightText(label)}</div>
      <div className="mt-1 opacity-90">{highlightText(signal.commitmentReason)}</div>
    </div>
  );
}

function EngineCard({ engine, average }: { engine: EngineVote; average?: EngineAverage }) {
  const avg = average?.average ?? engine.confidence;
  const delta = Math.round((engine.confidence - avg) * 10) / 10;
  const deltaText = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} vs avg`;
  const avgSamples = average?.samples ?? 1;
  return (
    <div className="rounded-2xl border border-edge-line bg-black/18 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-white">{engine.name}</div>
          <div className="mt-1 text-xs text-edge-muted">{engine.role}</div>
        </div>
        <div className={`rounded-full border px-2 py-1 text-xs font-black ${biasBadgeClass(engine.bias, engine.tone)}`}>{engine.bias}</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-edge-muted">Current</div>
          <div className="text-2xl font-black">{engine.confidence}%</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-edge-muted">Rolling avg</div>
          <div className="text-2xl font-black text-edge-blue">{avg.toFixed(1)}%</div>
        </div>
      </div>
      <div className={`mt-2 rounded-xl border px-2 py-1 text-xs font-bold ${delta >= 8 ? 'border-edge-green/30 bg-edge-green/10 text-edge-green' : delta <= -8 ? 'border-edge-red/30 bg-edge-red/10 text-edge-red' : 'border-edge-line bg-black/20 text-edge-muted'}`}>
        {deltaText} • {avgSamples} sample{avgSamples === 1 ? '' : 's'} in this browser
      </div>
      <div className="mt-2 text-sm leading-6 text-slate-200">{engine.message}</div>
    </div>
  );
}


type EntryGate = {
  label: string;
  passed: boolean;
  detail: string;
  severity?: 'ok' | 'warn' | 'block';
};

function EntryGateChecklist({
  gates,
  activeSignal,
  decision,
  qualityFilter,
  onQualityFilter,
}: {
  gates: EntryGate[];
  activeSignal: SignalPlan | null;
  decision: Decision;
  qualityFilter: QualityFilter;
  onQualityFilter: (filter: QualityFilter) => void;
}) {
  const blockers = gates.filter((gate) => !gate.passed);
  const readyReason = activeSignal?.status === 'READY'
    ? blockers.length
      ? `READY, not ENTER because ${blockers[0].detail.toLowerCase()}`
      : 'READY is waiting for one more stable refresh before ENTER.'
    : activeSignal?.status === 'ENTER'
      ? 'ENTER because the active trade plan passed the main entry gates.'
      : activeSignal?.nextStep ?? decision.reason;

  return (
    <div className="rounded-2xl border border-edge-line bg-black/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-edge-muted">Entry gate checklist</div>
          <div className="mt-2 text-sm leading-6 text-slate-200">{highlightText(readyReason)}</div>
        </div>
        <div className="rounded-full border border-edge-blue/40 bg-edge-blue/10 px-3 py-1 text-xs font-black text-edge-blue">
          {gates.filter((gate) => gate.passed).length}/{gates.length} passed
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {gates.map((gate) => (
          <div key={gate.label} className="flex min-h-[92px] items-start gap-2 rounded-xl border border-edge-line bg-slate-950/70 p-3 text-sm">
            <span className={gate.passed ? 'text-edge-green' : gate.severity === 'block' ? 'text-edge-red' : 'text-edge-amber'}>{gate.passed ? '✅' : gate.severity === 'block' ? '⛔' : '⚠️'}</span>
            <div>
              <div className="font-bold text-slate-100">{gate.label}</div>
              <div className="mt-1 text-xs leading-5 text-edge-muted">{highlightText(gate.detail)}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-2xl border border-edge-line bg-black/20 p-3">
        <div className="text-xs uppercase tracking-[0.18em] text-edge-muted">Trade quality filter</div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {([
            ['ANY', 'Any'],
            ['B_PLUS', 'B+ / A'],
            ['A_ONLY', 'A only'],
          ] as Array<[QualityFilter, string]>).map(([value, label]) => (
            <button key={value} onClick={() => onQualityFilter(value)} className={`rounded-xl border px-2 py-2 text-xs font-black ${qualityFilter === value ? 'border-edge-blue/50 bg-edge-blue/10 text-edge-blue' : 'border-edge-line bg-black/20 text-edge-muted'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="mt-2 text-xs leading-5 text-edge-muted">This does not change the market read. It controls how picky Edge15 should be before treating ENTER as actionable.</div>
      </div>
    </div>
  );
}

function ConfidenceHeatStrip({ history }: { history: SignalHistoryPoint[] }) {
  if (!history.length) {
    return <AlertCard title="Confidence heat strip" message="Waiting for live updates to build the current-window signal history." tone="blue" />;
  }
  return (
    <div className="rounded-2xl border border-edge-line bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.22em] text-edge-muted">Confidence heat strip</div>
        <div className="text-xs text-edge-muted">last {history.length} updates</div>
      </div>
      <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
        {history.map((point, index) => (
          <div key={`${point.label}-${index}`} title={`${point.label} • ${point.action} • confidence ${point.confidence}% • entry ${point.entryScore}`} className={`h-7 min-w-7 rounded-md border ${point.direction === 'OVER' ? 'border-edge-green/40 bg-edge-green/20' : point.direction === 'UNDER' ? 'border-edge-red/40 bg-edge-red/20' : 'border-edge-line bg-slate-900'} flex items-center justify-center text-[9px] font-black`}>
            {point.confidence}
          </div>
        ))}
      </div>
      <div className="mt-1 text-[11px] leading-4 text-edge-muted">Green = OVER, red = UNDER. Smooth is healthier than jumpy.</div>
    </div>
  );
}

function AlertCard({ title, message, tone }: { title: string; message: string; tone: 'warn' | 'bad' | 'blue' }) {
  const cls = tone === 'bad'
    ? 'border-edge-red/40 bg-edge-red/10 text-edge-red'
    : tone === 'warn'
      ? 'border-edge-amber/40 bg-edge-amber/10 text-edge-amber'
      : 'border-edge-blue/40 bg-edge-blue/10 text-edge-blue';
  return (
    <div className={`rounded-2xl border p-4 ${cls}`}>
      <div className="text-xs font-black uppercase tracking-[0.18em] opacity-80">{title}</div>
      <div className="mt-2 text-sm leading-6">{highlightText(message)}</div>
    </div>
  );
}

function buildEntryGates(decision: Decision, activeSignal: SignalPlan | null, countdown: Countdown, qualityFilter: QualityFilter): EntryGate[] {
  const direction = activeSignal?.direction ?? decision.direction;
  const stability = activeSignal?.stability ?? decision.stability;
  const confirmations = activeSignal?.confirmations ?? 0;
  const gradeValue = gradeRank(decision.tradeGrade);
  const neededGrade = qualityFilter === 'A_ONLY' ? 5 : qualityFilter === 'B_PLUS' ? 4 : 0;
  const distance = decision.distanceToReference;
  const onCorrectSide = direction === 'OVER'
    ? distance !== null && distance >= 0
    : direction === 'UNDER'
      ? distance !== null && distance <= 0
      : false;

  return [
    {
      label: 'Direction bias',
      passed: direction === 'OVER' || direction === 'UNDER',
      detail: direction === 'NONE' ? 'No OVER or UNDER plan has formed yet.' : `${direction} plan exists.`,
      severity: 'block',
    },
    {
      label: 'Entry Score',
      passed: decision.entryScore >= 72,
      detail: `${decision.entryScore}/100. ${decision.entryScore >= 72 ? 'Timing is strong enough to consider entry.' : 'Timing is not strong enough yet.'}`,
    },
    {
      label: 'Signal Stability',
      passed: stability >= 68,
      detail: `${stability}%. ${stability >= 68 ? 'The plan is stable enough to matter.' : 'The plan is still too jumpy.'}`,
    },
    {
      label: 'Confirmation count',
      passed: confirmations >= 3,
      detail: `${confirmations}/3 confirmations. ${confirmations >= 3 ? 'The signal has survived multiple refreshes.' : 'Needs more confirming updates.'}`,
    },
    {
      label: 'Price / strike reality',
      passed: countdown.remainingMs > 120000 || onCorrectSide || decision.settlement.risk === 'Low',
      detail: distance === null ? 'Waiting for reference price.' : `${direction} is ${onCorrectSide ? 'on the correct side of the reference' : 'on the wrong side of the reference'} with ${countdown.display} remaining.`,
      severity: countdown.remainingMs <= 120000 && !onCorrectSide ? 'block' : 'warn',
    },
    {
      label: 'Settlement risk',
      passed: decision.settlement.risk === 'Low',
      detail: `${decision.settlement.risk}. Clean ENTER needs Low settlement risk in Genesis-014. ${decision.settlement.message}`,
      severity: decision.settlement.risk === 'Extreme' || decision.settlement.risk === 'High' ? 'block' : 'warn',
    },
    {
      label: 'Quality filter',
      passed: gradeValue >= neededGrade,
      detail: qualityFilter === 'ANY' ? `Filter allows any grade. Current grade is ${decision.tradeGrade}.` : `Filter requires ${qualityFilter === 'A_ONLY' ? 'A or better' : 'B+ or better'}. Current grade is ${decision.tradeGrade}.`,
    },
  ];
}

function buildLateEntryWarning(decision: Decision, countdown: Countdown) {
  if (countdown.remainingMs > 360000) return null;
  if (decision.settlement.risk === 'Low' && decision.entryScore >= 82) return null;
  const required = decision.settlement.requiredMove === null ? 'unknown' : `$${decision.settlement.requiredMove.toFixed(0)}`;
  const realistic = decision.settlement.realisticMove === null ? 'unknown' : `$${decision.settlement.realisticMove.toFixed(0)}`;
  return `Only ${countdown.display} remains. Required move is ${required}; realistic short-window move is about ${realistic}. Late entries need extra caution.`;
}

function buildContradictionAlert(decision: Decision, activeSignal: SignalPlan | null, countdown: Countdown) {
  const direction = activeSignal?.direction ?? decision.direction;
  const distance = decision.distanceToReference;
  if (direction === 'NONE' || distance === null) return null;
  const wrongSide = direction === 'OVER' ? distance < 0 : direction === 'UNDER' ? distance > 0 : false;
  if (wrongSide && countdown.remainingMs <= 120000) {
    return `${direction} plan conflicts with settlement reality: price is ${distance > 0 ? 'above' : 'below'} the reference by $${Math.abs(distance).toFixed(0)} with ${countdown.display} left.`;
  }
  if (decision.indicators.trendBias !== 'neutral' && decision.indicators.momentumBias !== 'neutral' && decision.indicators.trendBias !== decision.indicators.momentumBias) {
    return `Trend and momentum disagree. Trend is ${decision.indicators.trendBias}, but momentum is ${decision.indicators.momentumBias}.`;
  }
  return null;
}

function buildDoNotChaseWarning(decision: Decision, activeSignal: SignalPlan | null, countdown: Countdown) {
  const direction = activeSignal?.direction ?? decision.direction;
  if (direction === 'NONE') return null;
  const rsi = decision.indicators.rsi14;
  const momentum = decision.indicators.momentum5m;
  const extendedUnder = direction === 'UNDER' && rsi !== null && rsi <= 32 && momentum !== null && momentum < -90;
  const extendedOver = direction === 'OVER' && rsi !== null && rsi >= 68 && momentum !== null && momentum > 90;
  if ((extendedUnder || extendedOver) && decision.entryScore < 74) {
    return `${direction} may be directionally right, but the move already looks extended. Do not chase unless timing improves.`;
  }
  if (countdown.remainingMs <= 180000 && decision.entryScore < 78) {
    return `The window is nearly over and Entry Score is only ${decision.entryScore}/100. Avoid chasing a late signal.`;
  }
  return null;
}

function wouldStillEnterNow(side: TradeSide, decision: Decision, activeSignal: SignalPlan | null, qualityFilter: QualityFilter): { answer: 'YES' | 'NO' | 'BORDERLINE'; reason: string; tone: Tone } {
  const direction = activeSignal?.direction ?? decision.direction;
  const stability = activeSignal?.stability ?? decision.stability;
  const qualityOk = gradeRank(decision.tradeGrade) >= (qualityFilter === 'A_ONLY' ? 5 : qualityFilter === 'B_PLUS' ? 4 : 0);
  if (direction === side && decision.entryScore >= 74 && stability >= 62 && qualityOk && decision.settlement.risk !== 'High' && decision.settlement.risk !== 'Extreme') {
    return { answer: 'YES', tone: 'good', reason: `The current read still supports ${side} with acceptable timing and risk.` };
  }
  if (direction === side && decision.entryScore >= 55 && decision.settlement.risk !== 'Extreme') {
    return { answer: 'BORDERLINE', tone: 'warn', reason: `The ${side} idea is still alive, but timing or risk is no longer clean.` };
  }
  return { answer: 'NO', tone: 'bad', reason: `Edge15 would not open a fresh ${side} trade under the current conditions.` };
}

function contractPhaseLabel(countdown: Countdown) {
  if (countdown.remainingMs <= 30000) return 'Final Seconds';
  if (countdown.remainingMs <= 120000) return 'Settlement Mode';
  if (countdown.remainingMs <= 600000) return 'Middle Confirmation';
  return 'Early Read';
}

function contractPhaseDetail(countdown: Countdown) {
  if (countdown.remainingMs <= 30000) return 'Reality check dominates';
  if (countdown.remainingMs <= 120000) return 'Distance and velocity matter most';
  if (countdown.remainingMs <= 600000) return 'Confirmation matters most';
  return 'Bias is still forming';
}

function gradeRank(grade: string) {
  const ranks: Record<string, number> = { 'A+': 6, A: 5, 'B+': 4, B: 3, C: 2, D: 1, F: 0 };
  return ranks[grade] ?? 0;
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

function biasBadgeClass(bias: EngineVote['bias'], tone: 'neutral' | 'good' | 'warn' | 'bad' | 'blue') {
  if (bias === 'OVER') return 'border-edge-green/40 bg-edge-green/10 text-edge-green';
  if (bias === 'UNDER') return 'border-edge-red/40 bg-edge-red/10 text-edge-red';
  return badgeClass(tone);
}

function highlightText(text: string) {
  const parts = text.split(/(OVER|UNDER)/g);
  return parts.map((part, index) => {
    if (part === 'OVER') return <span key={`${part}-${index}`} className="text-edge-green">OVER</span>;
    if (part === 'UNDER') return <span key={`${part}-${index}`} className="text-edge-red">UNDER</span>;
    return <span key={`${part}-${index}`}>{part}</span>;
  });
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
    tradeJournal: 'Journal',
    genesisStatus: 'Status',
  };
  return labels[key];
}
