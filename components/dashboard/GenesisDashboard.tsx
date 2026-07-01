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

const SECTION_STORAGE_KEY = 'edge15.visibleSections.v2.focus';
const ENGINE_AVERAGE_STORAGE_KEY = 'edge15.engineAverages.v1';
const ACTIVE_JOURNAL_ID_STORAGE_KEY = 'edge15.activeJournalEntryId.v1';
const QUALITY_FILTER_STORAGE_KEY = 'edge15.tradeQualityFilter.v1';
const COMMITMENT_ACCURACY_STORAGE_KEY = 'edge15.commitmentAccuracy.v3.replay';
const COMMIT_TIMING_LAB_STORAGE_KEY = 'edge15.commitTimingLab.v1';
const VERSION_LAB_STORAGE_KEY = 'edge15.versionLab.v1';
const STRATEGY_PROFILE_LAB_STORAGE_KEY = 'edge15.strategyProfileLab.v1';
const DEFAULT_VISIBLE_SECTIONS = {
  aiDesk: false,
  indicators: false,
  whyNot: false,
  dataHealth: false,
  genesisStatus: false,
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
  tradeGrade?: string | null;
  settlementRisk?: Decision['settlement']['risk'] | null;
  priceAtCommit?: number | null;
  distanceAtCommit?: number | null;
  flipRiskAtCommit?: string | null;
  tradeQualityAtCommit?: string | null;
  source: 'auto_observed' | 'auto_recovered';
};

type AutoTighteningProfile = {
  mode: 'NORMAL' | 'STRICT' | 'MAX';
  recentWinRate: number | null;
  recentResolved: number;
  extraScoreNeeded: number;
  message: string;
  tone: Tone;
};

type FlipRisk = {
  level: 'Low' | 'Medium' | 'High';
  flips: number;
  recentFlip: boolean;
  message: string;
  tone: Tone;
};

type TradeQuality = {
  label: 'AVOID' | 'WEAK' | 'DECENT' | 'STRONG';
  score: number;
  message: string;
  tone: Tone;
};

type EntryValue = {
  label: 'BAD' | 'FAIR' | 'GOOD' | 'GREAT';
  side: 'OVER' | 'UNDER' | 'NONE';
  score: number;
  estimatedWinProbability: number | null;
  askCents: number | null;
  edgePct: number | null;
  grossProfitCents: number | null;
  riskCents: number | null;
  message: string;
  timingRead: string;
  profileRead: string;
  tone: Tone;
};

type TimingLabRow = {
  label: string;
  wins: number;
  losses: number;
  noTrades: number;
  resolved: number;
  winRate: number | null;
  avgAsk: number | null;
  valueEdge: number | null;
  valueRead: string;
  valueScore: number;
};

type PerformanceWindow = {
  label: string;
  hours: number | null;
  wins: number;
  losses: number;
  noTrades: number;
  resolved: number;
  winRate: number | null;
};

type VersionLabRecord = {
  id: string;
  version: string;
  wins: number;
  losses: number;
  noTrades: number;
  sampleWindow: string;
  notes: string;
  updatedAt: string;
};

type StrategyProfile = {
  id: string;
  label: string;
  description: string;
};

type StrategyProfileRecord = {
  id: string;
  contractKey: string;
  profileId: string;
  profileLabel: string;
  capturedAt: string;
  committedDirection: 'OVER' | 'UNDER' | 'NONE';
  entryScore: number;
  confidence: number;
  opportunity: number;
  stability: number;
  tradeGrade: string;
  settlementRisk: Decision['settlement']['risk'];
  payoutAsk: number | null;
  outcome: 'OVER' | 'UNDER' | 'FLAT' | 'UNKNOWN';
  correct: boolean | null;
  open: number | null;
  close: number | null;
  resolvedAt: string | null;
  note: string;
};

type TrackerStatus = {
  tabStatus: 'Visible' | 'Background';
  tracking: 'Active' | 'Background' | 'Delayed';
  currentWindowCaptured: boolean;
  timingCaptured: number;
  timingTotal: number;
  pendingCommitments: number;
  pendingTiming: number;
  lastDataPullAt: string | null;
  lastGradedAt: string | null;
  recordsStored: number;
  message: string;
};

type CommitTimingCheckpoint = {
  id: string;
  label: string;
  targetRemainingSeconds: number;
  targetElapsedMs: number;
};

type CommitTimingRecord = {
  id: string;
  contractKey: string;
  timingLabel: string;
  targetRemainingSeconds: number;
  targetElapsedMs: number;
  capturedAt: string;
  committedDirection: 'OVER' | 'UNDER' | 'NONE';
  decisionAction: Decision['action'];
  entryScore: number;
  confidence: number;
  opportunity: number;
  stability: number;
  tradeGrade: string;
  settlementRisk: Decision['settlement']['risk'];
  distanceToReference: number | null;
  payoutAsk: number | null;
  outcome: 'OVER' | 'UNDER' | 'FLAT' | 'UNKNOWN';
  correct: boolean | null;
  open: number | null;
  close: number | null;
  resolvedAt: string | null;
  note: string;
};

const COMMIT_TIMING_CHECKPOINTS: CommitTimingCheckpoint[] = [
  { id: '12m', label: '12:00 left', targetRemainingSeconds: 12 * 60, targetElapsedMs: 3 * 60 * 1000 },
  { id: '10m', label: '10:00 left', targetRemainingSeconds: 10 * 60, targetElapsedMs: 5 * 60 * 1000 },
  { id: '8m', label: '8:00 left', targetRemainingSeconds: 8 * 60, targetElapsedMs: 7 * 60 * 1000 },
  { id: '6m', label: '6:00 left', targetRemainingSeconds: 6 * 60, targetElapsedMs: 9 * 60 * 1000 },
  { id: '4m', label: '4:00 left', targetRemainingSeconds: 4 * 60, targetElapsedMs: 11 * 60 * 1000 },
  { id: '3m', label: '3:00 left', targetRemainingSeconds: 3 * 60, targetElapsedMs: 12 * 60 * 1000 },
];

const TIMING_CAPTURE_WINDOW_MS = 45 * 1000;

const STRATEGY_PROFILES: StrategyProfile[] = [
  { id: 'aggressive', label: 'Aggressive', description: 'Takes earlier/more frequent reads when the direction is clean enough.' },
  { id: 'balanced', label: 'Balanced', description: 'Middle ground: requires decent confidence, opportunity, and stability.' },
  { id: 'selective', label: 'Selective', description: 'Higher-quality setups only, similar to the versions that are no-trading more often.' },
  { id: 'ultra', label: 'Ultra Selective', description: 'Very strict. Meant to chase the 85%+ goal by skipping many windows.' },
  { id: 'value', label: 'Value Only', description: 'Requires a playable ask price so correct calls are still worth entering.' },
  { id: 'no_chase', label: 'No-Chase', description: 'Blocks late/high-flip setups and avoids forced final-window entries.' },
];

const STRATEGY_CAPTURE_ELAPSED_MS = 9 * 60 * 1000;
const STRATEGY_CAPTURE_WINDOW_MS = 60 * 1000;


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
  const [commitTimingLab, setCommitTimingLab] = useState<CommitTimingRecord[]>([]);
  const [versionLab, setVersionLab] = useState<VersionLabRecord[]>([]);
  const [strategyProfileLab, setStrategyProfileLab] = useState<StrategyProfileRecord[]>([]);
  const [backupStatus, setBackupStatus] = useState<string>('Ready');
  const [lastDataPullAt, setLastDataPullAt] = useState<string | null>(null);
  const [recheckStatus, setRecheckStatus] = useState<string>('Ready');
  const [tabStatus, setTabStatus] = useState<'Visible' | 'Background'>(() => (typeof document !== 'undefined' && document.hidden ? 'Background' : 'Visible'));
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const savedAccuracy = window.localStorage.getItem(COMMITMENT_ACCURACY_STORAGE_KEY);
    if (savedAccuracy) {
      try {
        const parsed = JSON.parse(savedAccuracy) as CommitmentAccuracyRecord[];
        if (Array.isArray(parsed)) setCommitmentAccuracy(parsed.slice(0, 500));
      } catch {
        window.localStorage.removeItem(COMMITMENT_ACCURACY_STORAGE_KEY);
      }
    }
    const savedTimingLab = window.localStorage.getItem(COMMIT_TIMING_LAB_STORAGE_KEY);
    if (savedTimingLab) {
      try {
        const parsed = JSON.parse(savedTimingLab) as CommitTimingRecord[];
        if (Array.isArray(parsed)) setCommitTimingLab(parsed.slice(0, 1000));
      } catch {
        window.localStorage.removeItem(COMMIT_TIMING_LAB_STORAGE_KEY);
      }
    }
    const savedVersionLab = window.localStorage.getItem(VERSION_LAB_STORAGE_KEY);
    if (savedVersionLab) {
      try {
        const parsed = JSON.parse(savedVersionLab) as VersionLabRecord[];
        if (Array.isArray(parsed)) setVersionLab(parsed.slice(0, 100));
      } catch {
        window.localStorage.removeItem(VERSION_LAB_STORAGE_KEY);
      }
    }
    const savedStrategyLab = window.localStorage.getItem(STRATEGY_PROFILE_LAB_STORAGE_KEY);
    if (savedStrategyLab) {
      try {
        const parsed = JSON.parse(savedStrategyLab) as StrategyProfileRecord[];
        if (Array.isArray(parsed)) setStrategyProfileLab(parsed.slice(0, 1000));
      } catch {
        window.localStorage.removeItem(STRATEGY_PROFILE_LAB_STORAGE_KEY);
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
    const updateVisibility = () => setTabStatus(document.hidden ? 'Background' : 'Visible');
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
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
        if (!cancelled) setLastDataPullAt(new Date().toISOString());
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
  const rawDecision = useMemo(() => calculateDecision(snapshot, countdown), [snapshot, countdown]);
  const autoTightening = useMemo(() => buildAutoTighteningProfile(commitmentAccuracy), [commitmentAccuracy]);
  const flipRisk = useMemo(() => buildLateFlipRisk(signalHistory, countdown), [signalHistory, countdown]);
  const decision = useMemo(() => applyGenesis17Protection(rawDecision, autoTightening, flipRisk, countdown), [rawDecision, autoTightening, flipRisk, countdown]);
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
      const existingIndex = previous.findIndex((item) => item.contractKey === record.contractKey);
      let next: CommitmentAccuracyRecord[];
      if (existingIndex >= 0) {
        const existing = previous[existingIndex];
        if (existing.correct !== null || record.correct === null) return previous;
        next = previous.map((item, index) => index === existingIndex ? record : item);
      } else {
        next = [record, ...previous].slice(0, 500);
      }
      window.localStorage.setItem(COMMITMENT_ACCURACY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }



  function buildPerformanceBackup() {
    return {
      app: 'Edge15',
      release: 'Genesis-022',
      exportedAt: new Date().toISOString(),
      storageKeys: {
        commitmentAccuracy: COMMITMENT_ACCURACY_STORAGE_KEY,
        signalPlan: SIGNAL_PLAN_STORAGE_KEY,
        tradeJournal: TRADE_JOURNAL_STORAGE_KEY,
        engineAverages: ENGINE_AVERAGE_STORAGE_KEY,
        qualityFilter: QUALITY_FILTER_STORAGE_KEY,
        commitTimingLab: COMMIT_TIMING_LAB_STORAGE_KEY,
        versionLab: VERSION_LAB_STORAGE_KEY,
        strategyProfileLab: STRATEGY_PROFILE_LAB_STORAGE_KEY,
      },
      commitmentAccuracy,
      commitTimingLab,
      versionLab,
      strategyProfileLab,
      signalPlan,
      journal,
      engineAverages,
      qualityFilter,
    };
  }

  function exportPerformanceData() {
    const backup = buildPerformanceBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `edge15-genesis-022-performance-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setBackupStatus(`Exported ${commitmentAccuracy.length} performance records and ${commitTimingLab.length} timing tests`);
  }

  function backupToClipboard() {
    navigator.clipboard.writeText(JSON.stringify(buildPerformanceBackup(), null, 2))
      .then(() => setBackupStatus('Backup copied to clipboard'))
      .catch(() => setBackupStatus('Clipboard blocked. Use Export Results instead.'));
  }

  function triggerRestore() {
    restoreInputRef.current?.click();
  }

  async function restorePerformanceData(file: File | null) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<ReturnType<typeof buildPerformanceBackup>>;
      const restoredRecords = Array.isArray(parsed.commitmentAccuracy) ? parsed.commitmentAccuracy.slice(0, 500) as CommitmentAccuracyRecord[] : [];
      setCommitmentAccuracy(restoredRecords);
      window.localStorage.setItem(COMMITMENT_ACCURACY_STORAGE_KEY, JSON.stringify(restoredRecords));
      const restoredTiming = Array.isArray(parsed.commitTimingLab) ? parsed.commitTimingLab.slice(0, 1000) as CommitTimingRecord[] : [];
      if (restoredTiming.length) {
        setCommitTimingLab(restoredTiming);
        window.localStorage.setItem(COMMIT_TIMING_LAB_STORAGE_KEY, JSON.stringify(restoredTiming));
      }
      if (Array.isArray(parsed.versionLab)) {
        const restoredVersionLab = parsed.versionLab.slice(0, 100) as VersionLabRecord[];
        setVersionLab(restoredVersionLab);
        window.localStorage.setItem(VERSION_LAB_STORAGE_KEY, JSON.stringify(restoredVersionLab));
      }
      if (Array.isArray(parsed.strategyProfileLab)) {
        const restoredStrategyLab = parsed.strategyProfileLab.slice(0, 1000) as StrategyProfileRecord[];
        setStrategyProfileLab(restoredStrategyLab);
        window.localStorage.setItem(STRATEGY_PROFILE_LAB_STORAGE_KEY, JSON.stringify(restoredStrategyLab));
      }
      if (parsed.signalPlan) {
        setSignalPlan(parsed.signalPlan as SignalPlan);
        window.localStorage.setItem(SIGNAL_PLAN_STORAGE_KEY, JSON.stringify(parsed.signalPlan));
      }
      if (Array.isArray(parsed.journal)) {
        setJournal(parsed.journal as TradeJournalEntry[]);
        window.localStorage.setItem(TRADE_JOURNAL_STORAGE_KEY, JSON.stringify(parsed.journal));
      }
      if (parsed.engineAverages && typeof parsed.engineAverages === 'object') {
        setEngineAverages(parsed.engineAverages as EngineAverages);
        window.localStorage.setItem(ENGINE_AVERAGE_STORAGE_KEY, JSON.stringify(parsed.engineAverages));
      }
      setBackupStatus(`Restored ${restoredRecords.length} performance records from backup`);
    } catch {
      setBackupStatus('Restore failed. The selected file was not a valid Edge15 backup.');
    } finally {
      if (restoreInputRef.current) restoreInputRef.current.value = '';
    }
  }


  function addVersionLabRecord(record: Omit<VersionLabRecord, 'id' | 'updatedAt'>) {
    const nextRecord: VersionLabRecord = {
      ...record,
      id: `${record.version}:${Date.now()}`,
      updatedAt: new Date().toISOString(),
    };
    setVersionLab((previous) => {
      const next = [nextRecord, ...previous].slice(0, 100);
      window.localStorage.setItem(VERSION_LAB_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function deleteVersionLabRecord(id: string) {
    setVersionLab((previous) => {
      const next = previous.filter((record) => record.id !== id);
      window.localStorage.setItem(VERSION_LAB_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }


  function recheckPendingResults() {
    let resolvedCommitments = 0;
    let resolvedTiming = 0;
    let resolvedProfiles = 0;
    setCommitmentAccuracy((previous) => {
      const next = previous.map((record) => {
        const resolved = resolveCommitmentAccuracyRecord(record, snapshot.candles);
        if (record.correct === null && resolved.correct !== null) resolvedCommitments += 1;
        return resolved;
      });
      window.localStorage.setItem(COMMITMENT_ACCURACY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setCommitTimingLab((previous) => {
      const next = previous.map((record) => {
        const resolved = resolveCommitTimingRecord(record, snapshot.candles);
        if (record.correct === null && resolved.correct !== null) resolvedTiming += 1;
        return resolved;
      });
      window.localStorage.setItem(COMMIT_TIMING_LAB_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setStrategyProfileLab((previous) => {
      const next = previous.map((record) => {
        const resolved = resolveStrategyProfileRecord(record, snapshot.candles);
        if (record.correct === null && resolved.correct !== null) resolvedProfiles += 1;
        return resolved;
      });
      window.localStorage.setItem(STRATEGY_PROFILE_LAB_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setRecheckStatus(`Rechecked pending results: ${resolvedCommitments} commitment, ${resolvedTiming} timing, ${resolvedProfiles} profile updates`);
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


  useEffect(() => {
    if (!snapshot.fetchedAt) return;
    setCommitTimingLab((previous) => {
      const nextMap = new Map<string, CommitTimingRecord>();
      for (const record of previous) {
        const resolved = resolveCommitTimingRecord(record, snapshot.candles);
        nextMap.set(record.id, resolved);
      }

      const contractKey = `15m:${countdown.windowStart.toISOString()}`;
      for (const checkpoint of COMMIT_TIMING_CHECKPOINTS) {
        const captureKey = `${contractKey}:${checkpoint.id}`;
        const alreadyCaptured = nextMap.has(captureKey);
        const elapsed = countdown.elapsedMs;
        const inCaptureWindow = elapsed >= checkpoint.targetElapsedMs && elapsed <= checkpoint.targetElapsedMs + TIMING_CAPTURE_WINDOW_MS;
        if (!alreadyCaptured && inCaptureWindow) {
          nextMap.set(captureKey, createCommitTimingRecord({ checkpoint, contractKey, decision, snapshot, now }));
        }
      }

      const next = Array.from(nextMap.values())
        .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))
        .slice(0, 1000);
      window.localStorage.setItem(COMMIT_TIMING_LAB_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [snapshot.fetchedAt, snapshot.candles, countdown.elapsedMs, countdown.windowStart, decision, snapshot, now]);

  useEffect(() => {
    if (!snapshot.fetchedAt) return;
    const elapsed = countdown.elapsedMs;
    const inCaptureWindow = elapsed >= STRATEGY_CAPTURE_ELAPSED_MS && elapsed <= STRATEGY_CAPTURE_ELAPSED_MS + STRATEGY_CAPTURE_WINDOW_MS;
    if (!inCaptureWindow) return;
    setStrategyProfileLab((previous) => {
      const nextMap = new Map<string, StrategyProfileRecord>();
      for (const record of previous) {
        const resolved = resolveStrategyProfileRecord(record, snapshot.candles);
        nextMap.set(record.id, resolved);
      }
      const contractKey = `15m:${countdown.windowStart.toISOString()}`;
      for (const profile of STRATEGY_PROFILES) {
        const id = `${contractKey}:${profile.id}`;
        if (!nextMap.has(id)) {
          nextMap.set(id, createStrategyProfileRecord({ profile, contractKey, decision, snapshot, countdown, flipRisk, now }));
        }
      }
      const next = Array.from(nextMap.values())
        .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))
        .slice(0, 1000);
      window.localStorage.setItem(STRATEGY_PROFILE_LAB_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [snapshot.fetchedAt, snapshot.candles, countdown.elapsedMs, countdown.windowStart, decision, snapshot, countdown, flipRisk, now]);

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
  const tradeQuality = useMemo(() => buildTradeQuality(decision, activeSignal, countdown, snapshot, autoTightening, flipRisk), [decision, activeSignal, countdown, snapshot, autoTightening, flipRisk]);
  const entryValue = useMemo(() => buildEntryValue(decision, activeSignal, countdown, snapshot, tradeQuality, autoTightening, flipRisk, commitTimingLab, strategyProfileLab), [decision, activeSignal, countdown, snapshot, tradeQuality, autoTightening, flipRisk, commitTimingLab, strategyProfileLab]);
  const entryGates = useMemo(() => buildEntryGates(decision, activeSignal, countdown, qualityFilter, snapshot, autoTightening, flipRisk, tradeQuality), [decision, activeSignal, countdown, qualityFilter, snapshot, autoTightening, flipRisk, tradeQuality]);
  const lateWarning = useMemo(() => buildLateEntryWarning(decision, countdown), [decision, countdown]);
  const contradiction = useMemo(() => buildContradictionAlert(decision, activeSignal, countdown), [decision, activeSignal, countdown]);
  const doNotChase = useMemo(() => buildDoNotChaseWarning(decision, activeSignal, countdown), [decision, activeSignal, countdown]);
  const stillEnter = useMemo(() => position ? wouldStillEnterNow(position.side, decision, activeSignal, qualityFilter) : null, [position, decision, activeSignal, qualityFilter]);
  const price = snapshot.btcPrice ? `$${snapshot.btcPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : 'Loading';
  const strike = snapshot.strike ? `$${snapshot.strike.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'Detecting';
  const distance = snapshot.btcPrice && snapshot.strike ? snapshot.btcPrice - snapshot.strike : null;
  const trackerStatus = useMemo(() => buildTrackerStatus({
    tabStatus,
    lastDataPullAt,
    signalPlan: activeSignal,
    countdown,
    commitmentAccuracy,
    commitTimingLab,
    strategyProfileLab,
  }), [tabStatus, lastDataPullAt, activeSignal, countdown, commitmentAccuracy, commitTimingLab, strategyProfileLab]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.38em] text-edge-blue">Genesis-022</div>
          <h1 className="text-3xl font-black tracking-tight">Edge15</h1>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className={`rounded-full border px-3 py-2 text-xs ${priceFeedLive ? 'border-edge-green/40 bg-edge-green/10 text-edge-green' : 'border-edge-amber/40 bg-edge-amber/10 text-edge-amber'}`}>
            {priceFeedLive ? 'Price feed live' : 'Price feed degraded'}
          </div>
          <div className="hidden rounded-full border border-edge-line bg-black/20 px-3 py-1 text-[11px] text-edge-muted sm:block">Tracker reliability • logic unchanged</div>
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
            <Metric label="Settlement Risk" value={decision.settlement.risk} detail={decision.settlement.mode === 'settlement' ? 'Final 6m reality check' : 'Normal mode'} help={decision.settlement.message} tone={decision.settlement.risk === 'Low' ? 'good' : decision.settlement.risk === 'Medium' ? 'warn' : 'bad'} />
            <Metric label="Contract Phase" value={contractPhaseLabel(countdown)} detail={contractPhaseDetail(countdown)} help="Edge15 changes emphasis through the 15-minute window: early structure, middle confirmation, then settlement reality near the end." tone={countdown.remainingMs <= 120000 ? 'warn' : 'blue'} />
          </div>
          <div className="mt-3 rounded-2xl border border-edge-line bg-black/20 p-3 text-xs leading-5 text-edge-muted">
            The previous “last 10 periods” strip is temporarily hidden because it was not matching the real 15-minute outcomes reliably. We will re-add it only after the period boundaries are verified.
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr_1fr_1fr]">
        <TrackerStatusPanel status={trackerStatus} recheckStatus={recheckStatus} onRecheck={recheckPendingResults} />
        <TradeQualityPanel quality={tradeQuality} autoTightening={autoTightening} flipRisk={flipRisk} />
        <PerformanceTrackerPanel records={commitmentAccuracy} />
        <CommitmentAccuracyPanel records={commitmentAccuracy} activeSignal={activeSignal} />
        <PerformanceBackupPanel records={commitmentAccuracy} status={backupStatus} onExport={exportPerformanceData} onCopy={backupToClipboard} onRestore={triggerRestore} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.78fr_1.22fr]">
        <EntryValuePanel value={entryValue} />
        <EarlyEntryLabPanel entryValue={entryValue} timingRecords={commitTimingLab} profileRecords={strategyProfileLab} countdown={countdown} />
      </section>

      <CommitTimingLabPanel records={commitTimingLab} countdown={countdown} />
      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <VersionLabPanel records={versionLab} onAdd={addVersionLabRecord} onDelete={deleteVersionLabRecord} />
        <StrategyProfileLabPanel records={strategyProfileLab} />
      </section>
      <input ref={restoreInputRef} type="file" accept="application/json" className="hidden" onChange={(event) => restorePerformanceData(event.target.files?.[0] ?? null)} />

      <TradeReplayPanel records={commitmentAccuracy} />

      <section className="grid gap-4">
        <Panel title={position ? "Trade context + position" : "Focused decision dashboard"}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Metric label="Entry Score" value={`${decision.entryScore}/100`} detail={decision.entryQuality} help={entryScoreHelp(decision.entryScore)} tone={activeSignal?.tone ?? decision.tone} />
            <Metric label="Opportunity" value={`${decision.opportunity}%`} detail={decision.opportunityLabel} help={opportunityHelp(decision.opportunity)} tone={decision.opportunity > 75 ? 'good' : decision.opportunity > 55 ? 'warn' : 'bad'} />
            <Metric label="Trade Grade" value={decision.tradeGrade} detail={`${decision.confidence}% confidence`} help={tradeGradeHelp(decision.tradeGrade)} tone={activeSignal?.tone ?? decision.tone} />
            <Metric label="Trade Quality" value={tradeQuality.label} detail={`${tradeQuality.score}/100`} help={tradeQuality.message} tone={tradeQuality.tone} />
            <Metric label="Signal Stability" value={`${activeSignal?.stability ?? decision.stability}%`} detail={activeSignal ? `${activeSignal.status} • ${activeSignal.confirmations} confirmations` : 'Building plan'} help={signalStabilityHelp(activeSignal?.stability ?? decision.stability)} tone={(activeSignal?.stability ?? decision.stability) > 70 ? 'good' : (activeSignal?.stability ?? decision.stability) > 55 ? 'warn' : 'bad'} />
            <Metric label="Candles" value={`${snapshot.candles.length}`} detail="1m candles available" help="More candle history gives Edge15 a stronger indicator read." tone={snapshot.candles.length >= 10 ? 'good' : 'warn'} />
          </div>


          <div className="mt-4 grid gap-3">
            <EntryGateChecklist gates={entryGates} activeSignal={activeSignal} decision={decision} qualityFilter={qualityFilter} onQualityFilter={chooseQualityFilter} />
            <div className="grid gap-3 lg:grid-cols-3">
              {lateWarning ? <AlertCard title="Late-entry warning" message={lateWarning} tone="warn" /> : null}
              {contradiction ? <AlertCard title="Contradiction alert" message={contradiction} tone="bad" /> : null}
              {doNotChase ? <AlertCard title="Do not chase" message={doNotChase} tone="warn" /> : null}
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

        </Panel>
      </section>

      <Panel title="Advanced tools hidden by default">
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
          <div className="rounded-2xl border border-edge-blue/30 bg-edge-blue/10 p-4 text-sm leading-6 text-slate-100">{tradingDesk.chiefSummary}</div>
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
        <Panel title="Genesis-022 status">
          <ul className="list-disc space-y-2 pl-5 text-sm text-edge-muted">
            <li>Commitment Accuracy Tracker grades Edge15's locked contract predictions for the last 10 completed windows.</li>
            <li>Market microstructure now uses Coinbase level-2 order book spread, depth, and imbalance as another professional-style data read.</li>
            <li>Genesis-012.1 minute-9 commitment behavior remains intact.</li>
            <li>Genesis-022 preserves the Genesis-017 trade logic and adds performance backup, restore, and version-comparison support.</li>
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








function VersionLabPanel({ records, onAdd, onDelete }: { records: VersionLabRecord[]; onAdd: (record: Omit<VersionLabRecord, 'id' | 'updatedAt'>) => void; onDelete: (id: string) => void }) {
  const [version, setVersion] = useState('Genesis-017');
  const [wins, setWins] = useState('');
  const [losses, setLosses] = useState('');
  const [noTrades, setNoTrades] = useState('');
  const [sampleWindow, setSampleWindow] = useState('Last 10');
  const [notes, setNotes] = useState('');
  const rows = buildVersionLabRows(records);
  const bestBalance = rows
    .filter((row) => row.scored >= 3)
    .sort((a, b) => b.balanceScore - a.balanceScore || b.winRate - a.winRate || b.scored - a.scored)[0] ?? null;

  function submit() {
    const parsedWins = Math.max(0, Number.parseInt(wins || '0', 10) || 0);
    const parsedLosses = Math.max(0, Number.parseInt(losses || '0', 10) || 0);
    const parsedNoTrades = Math.max(0, Number.parseInt(noTrades || '0', 10) || 0);
    if (!version.trim() || parsedWins + parsedLosses + parsedNoTrades === 0) return;
    onAdd({ version: version.trim(), wins: parsedWins, losses: parsedLosses, noTrades: parsedNoTrades, sampleWindow: sampleWindow.trim() || 'Manual', notes: notes.trim() });
    setWins('');
    setLosses('');
    setNoTrades('');
    setNotes('');
  }

  return (
    <Panel title="Version Lab">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Best Balance" value={bestBalance ? bestBalance.version : 'Collecting'} detail={bestBalance ? `${bestBalance.winRate}% • ${bestBalance.wins}-${bestBalance.losses} • ${bestBalance.noTrades} skips` : 'Need 3+ scored'} help="Compares manually entered version test results. Balance rewards win rate, sample size, and useful selectivity." tone={bestBalance && bestBalance.winRate >= 75 ? 'good' : 'blue'} />
        <Metric label="Tracked Versions" value={`${rows.length}`} detail="Manual rows" help="Use this for side-by-side testing like Genesis-014 vs 015 vs 017 without relying on memory." tone="neutral" />
        <Metric label="Rule" value="Do not overfit" detail="Sample size matters" help="A 4/4 version is promising, but not proof. Edge15 labels small samples so we do not chase lucky runs." tone="warn" />
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-6">
        <input value={version} onChange={(event) => setVersion(event.target.value)} className="rounded-xl border border-edge-line bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-edge-blue sm:col-span-2" placeholder="Genesis-017" />
        <input value={wins} onChange={(event) => setWins(event.target.value)} className="rounded-xl border border-edge-line bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-edge-green" placeholder="Wins" inputMode="numeric" />
        <input value={losses} onChange={(event) => setLosses(event.target.value)} className="rounded-xl border border-edge-line bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-edge-red" placeholder="Losses" inputMode="numeric" />
        <input value={noTrades} onChange={(event) => setNoTrades(event.target.value)} className="rounded-xl border border-edge-line bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-edge-blue" placeholder="No trades" inputMode="numeric" />
        <button onClick={submit} className="rounded-xl border border-edge-blue/40 bg-edge-blue/10 px-3 py-2 text-xs font-black text-edge-blue hover:border-edge-blue">Add</button>
        <input value={sampleWindow} onChange={(event) => setSampleWindow(event.target.value)} className="rounded-xl border border-edge-line bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-edge-blue sm:col-span-2" placeholder="Last 10 / last hour" />
        <input value={notes} onChange={(event) => setNotes(event.target.value)} className="rounded-xl border border-edge-line bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-edge-blue sm:col-span-4" placeholder="Notes, like: 7 no trades, cleaner UI, too aggressive, etc." />
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-edge-line">
        <div className="grid grid-cols-[92px_78px_74px_88px_1fr_28px] gap-2 bg-black/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-edge-muted">
          <div>Version</div><div>W/L</div><div>Rate</div><div>No trade</div><div>Read</div><div />
        </div>
        {rows.length ? rows.map((row) => (
          <div key={row.id} className="grid grid-cols-[92px_78px_74px_88px_1fr_28px] gap-2 border-t border-edge-line px-3 py-2 text-xs">
            <div className="font-black text-slate-100">{row.version}</div>
            <div className="text-slate-300">{row.wins}-{row.losses}</div>
            <div className={row.winRate >= 75 ? 'font-black text-edge-green' : row.winRate >= 60 ? 'font-black text-edge-amber' : 'font-black text-edge-red'}>{row.scored ? `${row.winRate}%` : '—'}</div>
            <div className="text-edge-muted">{row.noTrades}</div>
            <div className="text-edge-muted">{row.sampleLabel} • {row.notes || row.sampleWindow}</div>
            <button onClick={() => onDelete(row.id)} className="text-edge-muted hover:text-edge-red">×</button>
          </div>
        )) : <div className="border-t border-edge-line px-3 py-4 text-sm text-edge-muted">Add the results you are seeing across Genesis versions. This panel is manual on purpose, so it can compare different tabs/devices.</div>}
      </div>
    </Panel>
  );
}

function buildVersionLabRows(records: VersionLabRecord[]) {
  return records.map((record) => {
    const scored = record.wins + record.losses;
    const winRate = scored ? Math.round((record.wins / scored) * 100) : 0;
    const total = scored + record.noTrades;
    const selectivity = total ? Math.round((record.noTrades / total) * 100) : 0;
    const sampleLabel = scored < 5 ? 'Too early' : scored < 15 ? 'Building sample' : scored < 40 ? 'Useful sample' : 'Strong sample';
    const balanceScore = winRate + Math.min(scored, 30) * 0.7 + Math.min(selectivity, 60) * 0.15;
    return { ...record, scored, total, winRate, selectivity, sampleLabel, balanceScore };
  });
}

function StrategyProfileLabPanel({ records }: { records: StrategyProfileRecord[] }) {
  const rows = buildStrategyProfileRows(records);
  const best = rows.filter((row) => row.resolved >= 5).sort((a, b) => b.balanceScore - a.balanceScore || b.resolved - a.resolved)[0] ?? null;
  return (
    <Panel title="Strategy Profile Lab">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Best Profile" value={best ? best.label : 'Collecting'} detail={best ? `${best.winRate}% • ${best.wins}-${best.losses}` : 'Need 5+ scored'} help="Shadow-tests trading styles once per window. It does not change the live recommendation." tone={best && (best.winRate ?? 0) >= 75 ? 'good' : 'blue'} />
        <Metric label="Profiles" value={`${STRATEGY_PROFILES.length}`} detail="Shadow tested" help="Aggressive, balanced, selective, ultra-selective, value-only, and no-chase profiles are graded separately." tone="neutral" />
        <Metric label="Live Logic" value="Unchanged" detail="Observation only" help="Genesis-022 adds testing and comparison. It does not alter the working Genesis-017/020 entry engine." tone="blue" />
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-edge-line">
        <div className="grid grid-cols-[96px_72px_64px_74px_1fr] gap-2 bg-black/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-edge-muted">
          <div>Profile</div><div>W/L</div><div>Rate</div><div>No trade</div><div>Read</div>
        </div>
        {rows.map((row) => (
          <div key={row.id} className="grid grid-cols-[96px_72px_64px_74px_1fr] gap-2 border-t border-edge-line px-3 py-2 text-xs">
            <div className="font-black text-slate-100">{row.label}</div>
            <div className="text-slate-300">{row.wins}-{row.losses}</div>
            <div className={row.winRate === null ? 'text-edge-muted' : row.winRate >= 75 ? 'font-black text-edge-green' : row.winRate >= 60 ? 'font-black text-edge-amber' : 'font-black text-edge-red'}>{row.winRate === null ? '—' : `${row.winRate}%`}</div>
            <div className="text-edge-muted">{row.noTrades}</div>
            <div className="text-edge-muted">{row.sampleLabel} • {row.description}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-2xl border border-edge-line bg-black/20 p-3 text-xs leading-5 text-edge-muted">
        Captures happen around the same minute-9 decision point. Later, we can combine this with the Commit Timing Lab to pick the best timing and the best profile together.
      </div>
    </Panel>
  );
}

function buildStrategyProfileRows(records: StrategyProfileRecord[]) {
  return STRATEGY_PROFILES.map((profile) => {
    const group = records.filter((record) => record.profileId === profile.id);
    const scored = group.filter((record) => record.correct !== null);
    const wins = scored.filter((record) => record.correct === true).length;
    const losses = scored.filter((record) => record.correct === false).length;
    const noTrades = group.filter((record) => record.committedDirection === 'NONE').length;
    const resolved = wins + losses;
    const winRate = resolved ? Math.round((wins / resolved) * 100) : null;
    const total = resolved + noTrades;
    const selectivity = total ? Math.round((noTrades / total) * 100) : 0;
    const sampleLabel = resolved < 5 ? `Need ${5 - resolved} more scored` : resolved < 15 ? 'Building sample' : resolved < 40 ? 'Useful sample' : 'Strong sample';
    const balanceScore = (winRate ?? 0) + Math.min(resolved, 30) * 0.8 + Math.min(selectivity, 65) * 0.1;
    return { ...profile, wins, losses, noTrades, resolved, winRate, selectivity, sampleLabel, balanceScore };
  });
}

function PerformanceBackupPanel({
  records,
  status,
  onExport,
  onCopy,
  onRestore,
}: {
  records: CommitmentAccuracyRecord[];
  status: string;
  onExport: () => void;
  onCopy: () => void;
  onRestore: () => void;
}) {
  const windows = buildPerformanceWindows(records);
  const allTime = windows[0];
  const recent = windows.find((window) => window.label === '1 hour') ?? allTime;
  const bestLabel = allTime.winRate === null ? 'Waiting' : allTime.winRate >= 75 ? 'Strong' : allTime.winRate >= 60 ? 'Mixed' : 'Tighten';
  const bestTone: Tone = allTime.winRate === null ? 'neutral' : allTime.winRate >= 75 ? 'good' : allTime.winRate >= 60 ? 'warn' : 'bad';
  return (
    <Panel title="Backup + compare">
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
        <Metric label="Current version" value="Genesis-022" detail="Logic preserved" help="Genesis-022 does not change the core Genesis-017 trading engine. It protects your results and makes side-by-side testing easier." tone="blue" />
        <Metric label="All-time read" value={bestLabel} detail={allTime.winRate === null ? 'No scored records' : `${allTime.winRate}% • ${allTime.wins}-${allTime.losses}`} help="Quick version-comparison label from this browser's stored performance records." tone={bestTone} />
        <Metric label="Last hour" value={recent.winRate === null ? '—' : `${recent.winRate}%`} detail={`W/L ${recent.wins}-${recent.losses}`} help="Useful when comparing multiple Genesis versions side by side over the same test window." tone={recent.winRate === null ? 'neutral' : recent.winRate >= 75 ? 'good' : recent.winRate >= 60 ? 'warn' : 'bad'} />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
        <button onClick={onExport} className="rounded-xl border border-edge-blue/40 bg-edge-blue/10 px-3 py-3 text-xs font-black text-edge-blue hover:border-edge-blue">Export Results</button>
        <button onClick={onCopy} className="rounded-xl border border-edge-line bg-black/20 px-3 py-3 text-xs font-black text-white hover:border-edge-blue/50">Copy Backup</button>
        <button onClick={onRestore} className="rounded-xl border border-edge-amber/40 bg-edge-amber/10 px-3 py-3 text-xs font-black text-edge-amber hover:border-edge-amber">Restore</button>
      </div>
      <div className="mt-3 rounded-2xl border border-edge-line bg-black/20 p-3 text-xs leading-5 text-edge-muted">
        {status}. Stored records: {records.length}. Use Export before clearing cache, switching browsers, or comparing PC vs phone.
      </div>
    </Panel>
  );
}

function TradeQualityPanel({ quality, autoTightening, flipRisk }: { quality: TradeQuality; autoTightening: AutoTighteningProfile; flipRisk: FlipRisk }) {
  return (
    <Panel title="Trade quality">
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
        <Metric label="Quality" value={quality.label} detail={`${quality.score}/100`} help={quality.message} tone={quality.tone} />
        <Metric label="Auto-tightening" value={autoTightening.mode} detail={autoTightening.recentWinRate === null ? 'Waiting for history' : `${autoTightening.recentWinRate}% last ${autoTightening.recentResolved}`} help={autoTightening.message} tone={autoTightening.tone} />
        <Metric label="Late Flip Risk" value={flipRisk.level} detail={`${flipRisk.flips} recent flips`} help={flipRisk.message} tone={flipRisk.tone} />
      </div>
      <div className="mt-3 rounded-2xl border border-edge-line bg-black/20 p-3 text-xs leading-5 text-edge-muted">
        Genesis-022 uses this score as the cockpit read: prediction strength is not enough unless value, stability, flip risk, and recent model performance are acceptable.
      </div>
    </Panel>
  );
}

function TradeReplayPanel({ records }: { records: CommitmentAccuracyRecord[] }) {
  const recent = records.slice(0, 5);
  if (!recent.length) return null;
  return (
    <Panel title="Trade replay snapshots">
      <div className="grid gap-2 lg:grid-cols-5">
        {recent.map((record) => (
          <div key={record.contractKey} className="rounded-2xl border border-edge-line bg-black/20 p-3 text-xs leading-5">
            <div className={`font-black ${record.correct === true ? 'text-edge-green' : record.correct === false ? 'text-edge-red' : 'text-edge-muted'}`}>{record.correct === true ? 'WIN' : record.correct === false ? 'LOSS' : record.committedDirection === 'NONE' ? 'NO TRADE' : 'PENDING'}</div>
            <div className="mt-1 text-slate-200">{highlightText(`${record.committedDirection} → ${record.outcome}`)}</div>
            <div className="mt-2 text-edge-muted">Score {record.entryScore ?? '—'} • Conf {record.confidence ?? '—'}%</div>
            <div className="text-edge-muted">Grade {record.tradeGrade ?? '—'} • Risk {record.settlementRisk ?? '—'}</div>
            <div className="text-edge-muted">Move {record.open !== null && record.close !== null ? `${record.open.toFixed(0)} → ${record.close.toFixed(0)}` : 'not resolved'}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs leading-5 text-edge-muted">Replay records help identify bad setups without manual buttons. Older records may not have every Genesis-022 snapshot field until new commitments are created.</div>
    </Panel>
  );
}

function buildAutoTighteningProfile(records: CommitmentAccuracyRecord[]): AutoTighteningProfile {
  const scored = records.filter((record) => record.correct !== null).slice(0, 10);
  const wins = scored.filter((record) => record.correct === true).length;
  const losses = scored.filter((record) => record.correct === false).length;
  const resolved = wins + losses;
  const winRate = resolved ? Math.round((wins / resolved) * 100) : null;
  if (resolved >= 8 && winRate !== null && winRate < 60) {
    return {
      mode: 'MAX',
      recentWinRate: winRate,
      recentResolved: resolved,
      extraScoreNeeded: 10,
      tone: 'bad',
      message: `Recent win rate is only ${winRate}% over ${resolved} scored commitments. Edge15 shifts into MAX protection: fewer entries, stronger cushion, and more NO TRADE calls.`,
    };
  }
  if (resolved >= 5 && winRate !== null && winRate < 70) {
    return {
      mode: 'STRICT',
      recentWinRate: winRate,
      recentResolved: resolved,
      extraScoreNeeded: 6,
      tone: 'warn',
      message: `Recent win rate is ${winRate}% over ${resolved} scored commitments. Edge15 tightens entry standards until performance improves.`,
    };
  }
  return {
    mode: 'NORMAL',
    recentWinRate: winRate,
    recentResolved: resolved,
    extraScoreNeeded: 0,
    tone: winRate !== null && winRate >= 75 ? 'good' : 'blue',
    message: resolved ? `Recent win rate is ${winRate}% over ${resolved} scored commitments. Normal guardrails stay active.` : 'Waiting for enough scored commitments before auto-tightening performance gates.',
  };
}

function buildLateFlipRisk(history: SignalHistoryPoint[], countdown: Countdown): FlipRisk {
  const directional = history.filter((point) => point.direction === 'OVER' || point.direction === 'UNDER');
  let flips = 0;
  for (let i = 1; i < directional.length; i += 1) {
    if (directional[i].direction !== directional[i - 1].direction) flips += 1;
  }
  const recentFlip = directional.length >= 2 && directional[directional.length - 1].direction !== directional[directional.length - 2].direction;
  const late = countdown.remainingMs <= 300000;
  if (late && (flips >= 3 || (flips >= 2 && recentFlip))) {
    return { level: 'High', flips, recentFlip, tone: 'bad', message: `High flip risk: ${flips} direction changes in the recent signal history${recentFlip ? ', including the latest refresh' : ''}. Late-window flips are a major reason Edge15 has been losing.` };
  }
  if (flips >= 2 || (late && recentFlip)) {
    return { level: 'Medium', flips, recentFlip, tone: 'warn', message: `Medium flip risk: ${flips} recent direction changes. Edge15 should be selective and avoid chasing.` };
  }
  return { level: 'Low', flips, recentFlip, tone: 'good', message: `Low flip risk: ${flips} recent direction changes. Signal history is not overly jumpy.` };
}

function applyGenesis17Protection(decision: Decision, autoTightening: AutoTighteningProfile, flipRisk: FlipRisk, countdown: Countdown): Decision {
  const messages: string[] = [];
  let confidencePenalty = 0;
  let opportunityPenalty = 0;
  let forceAvoid = false;
  let blockEnter = false;

  if (autoTightening.mode === 'STRICT') {
    confidencePenalty += 4;
    opportunityPenalty += 6;
    if (decision.entryScore < 78) blockEnter = true;
    messages.push('Auto-tightening is STRICT because recent performance is below target. Edge15 requires a stronger setup before ENTER.');
  }
  if (autoTightening.mode === 'MAX') {
    confidencePenalty += 8;
    opportunityPenalty += 12;
    if (decision.entryScore < 84 || decision.settlement.risk !== 'Low') blockEnter = true;
    messages.push('Auto-tightening is MAX because recent performance is poor. Edge15 should skip anything that is not extremely clean.');
  }
  if (flipRisk.level === 'High' && countdown.remainingMs <= 300000) {
    confidencePenalty += 10;
    opportunityPenalty += 16;
    blockEnter = true;
    forceAvoid = countdown.remainingMs <= 180000;
    messages.push('Late flip detector is HIGH. Edge15 blocks fresh entries because the signal is changing too much near settlement.');
  }

  if (!messages.length) return decision;

  const confidence = Math.max(0, decision.confidence - confidencePenalty);
  const opportunity = Math.max(0, decision.opportunity - opportunityPenalty);
  let action = decision.action;
  if (blockEnter && action.startsWith('ENTER')) action = decision.direction === 'NONE' ? 'WAIT' : `WATCH ${decision.direction}` as Decision['action'];
  if (forceAvoid) action = 'AVOID';
  const tone: Tone = action === 'AVOID' ? 'bad' : action.startsWith('WATCH') || action.startsWith('LEAN') ? 'warn' : decision.tone;
  const guardrails = [...messages, ...decision.guardrails].slice(0, 5);
  return {
    ...decision,
    action,
    tone,
    confidence,
    opportunity,
    opportunityLabel: opportunity >= 88 ? 'Excellent' : opportunity >= 74 ? 'Good' : opportunity >= 56 ? 'Developing' : opportunity >= 38 ? 'Thin' : 'Poor',
    guardrails,
    reason: guardrails[0] ?? decision.reason,
    whyNot: [...guardrails, ...decision.whyNot].slice(0, 5),
  };
}

function buildTradeQuality(decision: Decision, activeSignal: SignalPlan | null, countdown: Countdown, snapshot: MarketSnapshot, autoTightening: AutoTighteningProfile, flipRisk: FlipRisk): TradeQuality {
  const direction = activeSignal?.direction ?? decision.direction;
  const distance = Math.abs(decision.distanceToReference ?? 0);
  const oddsAsk = direction === 'OVER' ? snapshot.kalshi?.yesAsk ?? null : direction === 'UNDER' ? snapshot.kalshi?.noAsk ?? null : null;
  const payoutPenalty = oddsAsk === null ? (countdown.remainingMs <= 240000 ? 16 : 6) : oddsAsk >= 92 ? 24 : oddsAsk >= 88 ? 14 : oddsAsk >= 82 ? 6 : 0;
  const settlementPenalty = decision.settlement.risk === 'Extreme' ? 34 : decision.settlement.risk === 'High' ? 24 : decision.settlement.risk === 'Medium' ? 10 : 0;
  const flipPenalty = flipRisk.level === 'High' ? 24 : flipRisk.level === 'Medium' ? 10 : 0;
  const tighteningPenalty = autoTightening.mode === 'MAX' ? 14 : autoTightening.mode === 'STRICT' ? 7 : 0;
  const latePenalty = countdown.remainingMs <= 180000 ? 18 : countdown.remainingMs <= 300000 ? 8 : 0;
  const distanceBonus = decision.distanceToReference === null ? 0 : Math.min(12, distance / 5);
  const base = decision.entryScore * 0.34 + decision.opportunity * 0.24 + decision.confidence * 0.18 + decision.stability * 0.16 + distanceBonus;
  const score = Math.round(Math.max(0, Math.min(100, base - payoutPenalty - settlementPenalty - flipPenalty - tighteningPenalty - latePenalty)));
  const label: TradeQuality['label'] = score >= 82 ? 'STRONG' : score >= 68 ? 'DECENT' : score >= 52 ? 'WEAK' : 'AVOID';
  const tone: Tone = label === 'STRONG' ? 'good' : label === 'DECENT' ? 'blue' : label === 'WEAK' ? 'warn' : 'bad';
  const reasons: string[] = [];
  if (payoutPenalty >= 14) reasons.push('payout value is thin');
  if (settlementPenalty >= 10) reasons.push(`settlement risk is ${decision.settlement.risk}`);
  if (flipPenalty >= 10) reasons.push(`flip risk is ${flipRisk.level}`);
  if (autoTightening.mode !== 'NORMAL') reasons.push(`auto-tightening is ${autoTightening.mode}`);
  if (latePenalty >= 8) reasons.push('window is late');
  const message = reasons.length ? `${label}: ${reasons.join(', ')}.` : `${label}: signal, timing, value, and stability are acceptable.`;
  return { label, score, message, tone };
}



function TrackerStatusPanel({ status, recheckStatus, onRecheck }: { status: TrackerStatus; recheckStatus: string; onRecheck: () => void }) {
  const tone: Tone = status.tracking === 'Active' ? 'good' : status.tracking === 'Background' ? 'warn' : 'bad';
  return (
    <Panel title="Tracker status">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <Metric label="Tracking" value={status.tracking} detail={status.tabStatus} help={status.message} tone={tone} />
        <Metric label="Current window" value={status.currentWindowCaptured ? 'Captured' : 'Watching'} detail={`${status.timingCaptured}/${status.timingTotal} timing checks`} help="Captured means the main commitment or timing checkpoint has already been saved for this 15-minute window." tone={status.currentWindowCaptured ? 'good' : 'blue'} />
        <Metric label="Pending" value={`${status.pendingCommitments + status.pendingTiming}`} detail={`${status.pendingCommitments} main • ${status.pendingTiming} lab`} help="Pending records are waiting for enough candle data to grade the completed window." tone={status.pendingCommitments + status.pendingTiming > 0 ? 'warn' : 'good'} />
        <Metric label="Stored" value={`${status.recordsStored}`} detail="local records" help="Stored in this browser's local storage. Export before clearing cache or switching devices." tone="neutral" />
      </div>
      <div className="mt-3 grid gap-2 text-xs leading-5 text-edge-muted">
        <div className="rounded-xl border border-edge-line bg-black/20 px-3 py-2">Last data pull: {formatStatusTime(status.lastDataPullAt)}</div>
        <div className="rounded-xl border border-edge-line bg-black/20 px-3 py-2">Last graded window: {formatStatusTime(status.lastGradedAt)}</div>
      </div>
      <button onClick={onRecheck} className="mt-3 w-full rounded-xl border border-edge-blue/40 bg-edge-blue/10 px-3 py-3 text-xs font-black text-edge-blue hover:border-edge-blue">Recheck Pending Results</button>
      <div className="mt-3 rounded-2xl border border-edge-line bg-black/20 p-3 text-xs leading-5 text-edge-muted">{recheckStatus}</div>
    </Panel>
  );
}

function buildTrackerStatus({ tabStatus, lastDataPullAt, signalPlan, countdown, commitmentAccuracy, commitTimingLab, strategyProfileLab }: { tabStatus: 'Visible' | 'Background'; lastDataPullAt: string | null; signalPlan: SignalPlan | null; countdown: Countdown; commitmentAccuracy: CommitmentAccuracyRecord[]; commitTimingLab: CommitTimingRecord[]; strategyProfileLab: StrategyProfileRecord[] }): TrackerStatus {
  const nowMs = Date.now();
  const pullMs = lastDataPullAt ? Date.parse(lastDataPullAt) : NaN;
  const secondsSincePull = Number.isFinite(pullMs) ? Math.round((nowMs - pullMs) / 1000) : null;
  const tracking: TrackerStatus['tracking'] = secondsSincePull === null || secondsSincePull > 45 ? 'Delayed' : tabStatus === 'Background' ? 'Background' : 'Active';
  const currentKey = `15m:${countdown.windowStart.toISOString()}`;
  const currentWindowCaptured = signalPlan?.contractKey === currentKey && (signalPlan.commitmentStatus === 'COMMITTED' || signalPlan.commitmentStatus === 'NO TRADE');
  const timingCaptured = commitTimingLab.filter((record) => record.contractKey === currentKey).length;
  const pendingCommitments = commitmentAccuracy.filter((record) => record.committedDirection !== 'NONE' && record.correct === null).length;
  const pendingTiming = commitTimingLab.filter((record) => record.committedDirection !== 'NONE' && record.correct === null).length + strategyProfileLab.filter((record) => record.committedDirection !== 'NONE' && record.correct === null).length;
  const gradedTimes = [
    ...commitmentAccuracy.filter((record) => record.correct !== null).map((record) => Date.parse(record.resolvedAt)),
    ...commitTimingLab.filter((record) => record.correct !== null && record.resolvedAt).map((record) => Date.parse(record.resolvedAt as string)),
    ...strategyProfileLab.filter((record) => record.correct !== null && record.resolvedAt).map((record) => Date.parse(record.resolvedAt as string)),
  ].filter(Number.isFinite) as number[];
  const lastGradedAt = gradedTimes.length ? new Date(Math.max(...gradedTimes)).toISOString() : null;
  const message = tracking === 'Active'
    ? 'The tab is visible and Edge15 is pulling data normally.'
    : tracking === 'Background'
      ? 'The tab is open in the background. It should usually track, but the browser may slow polling.'
      : 'Tracking is delayed. The tab may have been throttled, asleep, or offline. Use Recheck Pending Results once data returns.';
  return {
    tabStatus,
    tracking,
    currentWindowCaptured,
    timingCaptured,
    timingTotal: COMMIT_TIMING_CHECKPOINTS.length,
    pendingCommitments,
    pendingTiming,
    lastDataPullAt,
    lastGradedAt,
    recordsStored: commitmentAccuracy.length + commitTimingLab.length + strategyProfileLab.length,
    message,
  };
}

function formatStatusTime(value: string | null) {
  if (!value) return '—';
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}


function EntryValuePanel({ value }: { value: EntryValue }) {
  return (
    <Panel title="Entry Value Engine">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <Metric label="Entry Value" value={value.label} detail={`${value.score}/100 value score`} help="This asks whether the current price is worth paying, not just whether Edge15 picked the right side." tone={value.tone} />
        <Metric label="Estimated Win" value={value.estimatedWinProbability === null ? '—' : `${value.estimatedWinProbability}%`} detail={value.side === 'NONE' ? 'No side yet' : value.side} help="Edge15's rough probability estimate from confidence, opportunity, stability, trade quality, and lab results." tone={value.estimatedWinProbability !== null && value.estimatedWinProbability >= 70 ? 'good' : value.estimatedWinProbability !== null && value.estimatedWinProbability >= 58 ? 'warn' : 'neutral'} />
        <Metric label="Market Ask" value={value.askCents === null ? 'Unavailable' : `${value.askCents}¢`} detail={value.grossProfitCents === null ? 'Need Kalshi ask' : `Upside ${value.grossProfitCents}¢ • risk ${value.riskCents}¢`} help="A cheap entry can be valuable if Edge15 has real edge. An expensive entry can be bad even when the prediction is likely correct." tone={value.askCents === null ? 'warn' : value.askCents <= 70 ? 'good' : value.askCents <= 86 ? 'warn' : 'bad'} />
        <Metric label="Estimated Edge" value={value.edgePct === null ? '—' : `${value.edgePct >= 0 ? '+' : ''}${value.edgePct}%`} detail="Win estimate minus ask" help="Positive means Edge15 thinks its probability is higher than the market price. Negative means the trade may be overpriced." tone={value.edgePct === null ? 'neutral' : value.edgePct >= 8 ? 'good' : value.edgePct >= 0 ? 'warn' : 'bad'} />
      </div>
      <div className={`mt-3 rounded-2xl border p-3 text-xs leading-5 ${badgeClass(value.tone)}`}>
        {highlightText(value.message)}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-edge-line bg-black/20 p-3 text-xs leading-5 text-edge-muted">{value.timingRead}</div>
        <div className="rounded-2xl border border-edge-line bg-black/20 p-3 text-xs leading-5 text-edge-muted">{value.profileRead}</div>
      </div>
    </Panel>
  );
}

function EarlyEntryLabPanel({ entryValue, timingRecords, profileRecords, countdown }: { entryValue: EntryValue; timingRecords: CommitTimingRecord[]; profileRecords: StrategyProfileRecord[]; countdown: Countdown }) {
  const timingRows = buildTimingLabRows(timingRecords);
  const profileRows = buildStrategyProfileRows(profileRecords);
  const bestEarly = timingRows
    .filter((row) => ['10:00 left', '8:00 left', '6:00 left'].includes(row.label) && row.resolved >= 5)
    .sort((a, b) => b.valueScore - a.valueScore || (b.winRate ?? 0) - (a.winRate ?? 0))[0] ?? null;
  const fourMinute = timingRows.find((row) => row.label === '4:00 left') ?? null;
  const threeMinute = timingRows.find((row) => row.label === '3:00 left') ?? null;
  const aggressive = profileRows.find((row) => row.id === 'aggressive') ?? null;
  const valueOnly = profileRows.find((row) => row.id === 'value') ?? null;
  const cleanEarlyArmed = entryValue.label === 'GOOD' || entryValue.label === 'GREAT';
  const currentPhase = countdown.remainingMs > 6 * 60 * 1000 ? 'Early value watch' : countdown.remainingMs > 4 * 60 * 1000 ? 'Decision zone' : countdown.remainingMs > 3 * 60 * 1000 ? 'Four-minute confirmation' : 'Final-3m value-only';

  return (
    <Panel title="Early Entry Lab">
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Current Phase" value={currentPhase} detail={countdown.display} help="This is a lab read only. Live trading logic is unchanged while timing/value evidence builds." tone="blue" />
        <Metric label="Clean Early" value={cleanEarlyArmed ? 'ARMED' : 'WAIT'} detail={entryValue.label} help="ARMED means Edge15 sees enough value to start paying attention before the normal commitment point. It is not a live entry command yet." tone={cleanEarlyArmed ? 'good' : 'warn'} />
        <Metric label="Best Early Slot" value={bestEarly ? bestEarly.label : 'Collecting'} detail={bestEarly ? `${bestEarly.winRate ?? '—'}% • edge ${bestEarly.valueEdge === null ? '—' : bestEarly.valueEdge}` : 'Need 5+ scored'} help="Compares 10:00, 8:00, and 6:00 checkpoints for early value opportunities." tone={bestEarly && bestEarly.valueScore >= 65 ? 'good' : 'blue'} />
        <Metric label="4m vs 3m" value={fourMinute && threeMinute ? `${fourMinute.winRate ?? '—'} / ${threeMinute.winRate ?? '—'}%` : 'Collecting'} detail="accuracy check" help="4:00 may be the best usable balance; 3:00 may be accurate but too late/expensive without strong value." tone="warn" />
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-edge-line">
        <div className="grid grid-cols-[130px_1fr_120px] gap-2 bg-black/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-edge-muted">
          <div>Rule</div><div>Purpose</div><div>Status</div>
        </div>
        {[
          { rule: 'Aggressive when clean', purpose: aggressive ? `Aggressive profile is ${aggressive.wins}-${aggressive.losses} with ${aggressive.noTrades} no-trades.` : 'Collecting strategy profile evidence.', status: aggressive && aggressive.winRate !== null && aggressive.winRate >= 80 ? 'Promising' : 'Testing', tone: aggressive && aggressive.winRate !== null && aggressive.winRate >= 80 ? 'text-edge-green' : 'text-edge-amber' },
          { rule: 'Selective when mixed', purpose: 'If Entry Value is only FAIR or timing is noisy, Edge15 should wait instead of forcing a side.', status: entryValue.label === 'FAIR' ? 'Active idea' : 'Standby', tone: 'text-edge-blue' },
          { rule: 'No-chase late', purpose: 'Final 3 minutes remain blocked unless value data proves the payout is still worth it.', status: countdown.remainingMs <= 180000 ? 'Protecting' : 'Standby', tone: countdown.remainingMs <= 180000 ? 'text-edge-amber' : 'text-edge-muted' },
          { rule: 'Value-gated always', purpose: valueOnly ? `Value-only has ${valueOnly.resolved} scored and ${valueOnly.noTrades} skips.` : 'Waiting for ask data.', status: entryValue.label, tone: entryValue.tone === 'good' ? 'text-edge-green' : entryValue.tone === 'bad' ? 'text-edge-red' : 'text-edge-amber' },
        ].map((row) => (
          <div key={row.rule} className="grid grid-cols-[130px_1fr_120px] gap-2 border-t border-edge-line px-3 py-2 text-xs">
            <div className="font-black text-slate-100">{row.rule}</div>
            <div className="text-edge-muted">{row.purpose}</div>
            <div className={`font-black ${row.tone}`}>{row.status}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-2xl border border-edge-blue/30 bg-edge-blue/10 p-3 text-xs leading-5 text-edge-blue">
        Genesis-022 observes early-entry value only. It does not change the live recommendation until enough timing, profile, and payout samples prove the rule.
      </div>
    </Panel>
  );
}

function buildEntryValue(decision: Decision, activeSignal: SignalPlan | null, countdown: Countdown, snapshot: MarketSnapshot, tradeQuality: TradeQuality, autoTightening: AutoTighteningProfile, flipRisk: FlipRisk, timingRecords: CommitTimingRecord[], profileRecords: StrategyProfileRecord[]): EntryValue {
  const side = activeSignal?.direction ?? decision.direction;
  if (side !== 'OVER' && side !== 'UNDER') {
    return {
      label: 'BAD',
      side: 'NONE',
      score: 0,
      estimatedWinProbability: null,
      askCents: null,
      edgePct: null,
      grossProfitCents: null,
      riskCents: null,
      message: 'No OVER or UNDER edge is formed yet. Edge15 cannot price an entry without a side.',
      timingRead: 'Timing lab is waiting for a directional setup.',
      profileRead: 'Strategy profile lab is observation-only.',
      tone: 'neutral',
    };
  }

  const askCents = side === 'OVER' ? snapshot.kalshi?.yesAsk ?? null : snapshot.kalshi?.noAsk ?? null;
  const timingRows = buildTimingLabRows(timingRecords);
  const profileRows = buildStrategyProfileRows(profileRecords);
  const secondsLeft = Math.ceil(countdown.remainingMs / 1000);
  const nearestTiming = timingRows
    .slice()
    .sort((a, b) => Math.abs(labelToRemainingSeconds(a.label) - secondsLeft) - Math.abs(labelToRemainingSeconds(b.label) - secondsLeft))[0] ?? null;
  const bestBalance = timingRows
    .filter((row) => row.resolved >= 5)
    .sort((a, b) => b.valueScore - a.valueScore || (b.winRate ?? 0) - (a.winRate ?? 0))[0] ?? null;
  const bestProfile = profileRows
    .filter((row) => row.resolved >= 5)
    .sort((a, b) => b.balanceScore - a.balanceScore || (b.winRate ?? 0) - (a.winRate ?? 0))[0] ?? null;

  const timingAdjustment = nearestTiming?.winRate === null || !nearestTiming ? 0 : clampLocal((nearestTiming.winRate - 75) * 0.12, -4, 5);
  const profileAdjustment = bestProfile?.winRate === null || !bestProfile ? 0 : clampLocal((bestProfile.winRate - 75) * 0.08, -3, 4);
  const flipPenalty = flipRisk.level === 'High' ? 9 : flipRisk.level === 'Medium' ? 4 : 0;
  const tightPenalty = autoTightening.mode === 'MAX' ? 6 : autoTightening.mode === 'STRICT' ? 3 : 0;
  const latePenalty = countdown.remainingMs <= 180000 ? 6 : countdown.remainingMs <= 240000 ? 2 : 0;
  const settlementPenalty = decision.settlement.risk === 'Extreme' ? 14 : decision.settlement.risk === 'High' ? 9 : decision.settlement.risk === 'Medium' ? 3 : 0;
  const estimatedWinProbability = Math.round(clampLocal(
    decision.confidence * 0.36 + decision.opportunity * 0.24 + decision.stability * 0.18 + tradeQuality.score * 0.22 + timingAdjustment + profileAdjustment - flipPenalty - tightPenalty - latePenalty - settlementPenalty,
    35,
    92,
  ));

  const grossProfitCents = askCents === null ? null : Math.max(0, 100 - askCents);
  const riskCents = askCents;
  const edgePct = askCents === null ? null : Math.round(estimatedWinProbability - askCents);
  const cheapButUnprovenBoost = askCents !== null && askCents >= 42 && askCents <= 62 && estimatedWinProbability >= 60 ? 8 : 0;
  const expensivePenalty = askCents === null ? 8 : askCents >= 92 ? 22 : askCents >= 86 ? 12 : askCents >= 78 ? 5 : 0;
  const edgeScore = edgePct === null ? -4 : edgePct * 1.45;
  const rewardScore = askCents === null ? 0 : clampLocal((100 - askCents) * 0.22, 0, 14);
  const score = Math.round(clampLocal(tradeQuality.score * 0.45 + estimatedWinProbability * 0.28 + edgeScore + rewardScore + cheapButUnprovenBoost - expensivePenalty - flipPenalty - latePenalty, 0, 100));

  let label: EntryValue['label'] = 'BAD';
  if (score >= 84 && edgePct !== null && edgePct >= 12 && askCents !== null && askCents <= 78 && tradeQuality.label !== 'AVOID') label = 'GREAT';
  else if (score >= 70 && edgePct !== null && edgePct >= 6 && tradeQuality.label !== 'AVOID') label = 'GOOD';
  else if (score >= 54 && (edgePct === null || edgePct >= -2) && tradeQuality.label !== 'AVOID') label = 'FAIR';

  if (countdown.remainingMs <= 180000 && askCents !== null && askCents >= 82) label = label === 'GREAT' ? 'GOOD' : 'BAD';
  if (flipRisk.level === 'High' || decision.settlement.risk === 'Extreme') label = 'BAD';
  const tone: Tone = label === 'GREAT' || label === 'GOOD' ? 'good' : label === 'FAIR' ? 'warn' : 'bad';
  const askRead = askCents === null ? 'Kalshi ask is unavailable, so price edge is estimated conservatively.' : `${side} ask is ${askCents}¢ with estimated win probability near ${estimatedWinProbability}%, giving estimated edge ${edgePct! >= 0 ? '+' : ''}${edgePct}%.`;
  const lateRead = countdown.remainingMs <= 180000 ? ' Final-3-minute entries remain no-chase unless future data proves value is still strong.' : '';
  const message = label === 'BAD'
    ? `${askRead} Edge15 should avoid paying for this unless value improves.${lateRead}`
    : label === 'FAIR'
      ? `${askRead} This is watchable, but not clean enough to treat as a premium entry.${lateRead}`
      : `${askRead} This is the type of price-versus-probability setup Genesis-022 is designed to track.${lateRead}`;

  return {
    label,
    side,
    score,
    estimatedWinProbability,
    askCents,
    edgePct,
    grossProfitCents,
    riskCents,
    message,
    timingRead: nearestTiming ? `Nearest timing: ${nearestTiming.label} is ${nearestTiming.winRate ?? '—'}% over ${nearestTiming.resolved} scored. Best balance: ${bestBalance ? `${bestBalance.label} (${bestBalance.winRate ?? '—'}%)` : 'collecting'}.` : 'Timing lab has no samples yet.',
    profileRead: bestProfile ? `Best profile so far: ${bestProfile.label} at ${bestProfile.winRate ?? '—'}% over ${bestProfile.resolved} scored.` : 'Strategy profile lab is still collecting enough scored samples.',
    tone,
  };
}

function labelToRemainingSeconds(label: string) {
  const match = label.match(/^(\d+):/);
  return match ? Number.parseInt(match[1], 10) * 60 : 0;
}

function clampLocal(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function CommitTimingLabPanel({ records, countdown }: { records: CommitTimingRecord[]; countdown: Countdown }) {
  const rows = buildTimingLabRows(records);
  const currentKey = `15m:${countdown.windowStart.toISOString()}`;
  const currentRecords = records.filter((record) => record.contractKey === currentKey);
  const nextCheckpoint = COMMIT_TIMING_CHECKPOINTS.find((checkpoint) => countdown.elapsedMs < checkpoint.targetElapsedMs);
  const bestAccuracy = rows
    .filter((row) => row.resolved >= 5 && row.winRate !== null)
    .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0) || b.resolved - a.resolved)[0] ?? null;
  const bestValue = rows
    .filter((row) => row.resolved >= 5 && row.valueEdge !== null)
    .sort((a, b) => (b.valueEdge ?? -100) - (a.valueEdge ?? -100) || b.valueScore - a.valueScore)[0] ?? null;
  const bestBalance = rows
    .filter((row) => row.resolved >= 5)
    .sort((a, b) => b.valueScore - a.valueScore || b.resolved - a.resolved)[0] ?? null;

  return (
    <Panel title="Commit Timing Lab">
      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm leading-6 text-slate-200">Shadow-tests decision checkpoints without changing live trading logic.</div>
              <div className="mt-1 text-xs leading-5 text-edge-muted">Genesis-022 now shows timing value, not just accuracy. A perfect late read can still be a bad entry if the ask is too expensive.</div>
            </div>
            <div className="rounded-full border border-edge-blue/40 bg-edge-blue/10 px-3 py-1 text-xs font-black text-edge-blue">
              Live logic unchanged
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-edge-line">
            <div className="grid grid-cols-[86px_74px_70px_70px_74px_1fr] gap-2 bg-black/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-edge-muted">
              <div>Timing</div>
              <div>W/L</div>
              <div>Rate</div>
              <div>Ask</div>
              <div>Edge</div>
              <div>Read</div>
            </div>
            {rows.map((row) => (
              <div key={row.label} className="grid grid-cols-[86px_74px_70px_70px_74px_1fr] gap-2 border-t border-edge-line px-3 py-2 text-xs">
                <div className="font-black text-slate-100">{row.label}</div>
                <div className="text-slate-300">{row.wins}-{row.losses}</div>
                <div className={row.winRate === null ? 'text-edge-muted' : row.winRate >= 75 ? 'font-black text-edge-green' : row.winRate >= 60 ? 'font-black text-edge-amber' : 'font-black text-edge-red'}>{row.winRate === null ? '—' : `${row.winRate}%`}</div>
                <div className="text-edge-muted">{row.avgAsk === null ? '—' : `${row.avgAsk}¢`}</div>
                <div className={row.valueEdge === null ? 'text-edge-muted' : row.valueEdge >= 10 ? 'font-black text-edge-green' : row.valueEdge >= 0 ? 'font-black text-edge-amber' : 'font-black text-edge-red'}>{row.valueEdge === null ? '—' : `${row.valueEdge >= 0 ? '+' : ''}${row.valueEdge}`}</div>
                <div className="text-edge-muted">{row.resolved < 5 ? `Need ${5 - row.resolved} more scored` : row.valueRead}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <Metric label="Best Accuracy" value={bestAccuracy ? bestAccuracy.label : 'Collecting'} detail={bestAccuracy ? `${bestAccuracy.winRate}% over ${bestAccuracy.resolved}` : 'Need 5+ scored per timing'} help="Highest raw correctness. This can favor late checkpoints that may not pay enough." tone={bestAccuracy && (bestAccuracy.winRate ?? 0) >= 75 ? 'good' : 'blue'} />
          <Metric label="Best Value" value={bestValue ? bestValue.label : 'No ask data'} detail={bestValue?.valueEdge === null || !bestValue ? 'Need odds samples' : `Edge ${bestValue.valueEdge >= 0 ? '+' : ''}${bestValue.valueEdge} vs avg ask`} help="Compares timing win rate to average ask when available. Higher is better because it suggests the read beat the price." tone={bestValue && (bestValue.valueEdge ?? -100) >= 0 ? 'good' : 'warn'} />
          <Metric label="Best Balance" value={bestBalance ? bestBalance.label : 'Collecting'} detail={bestBalance ? `${bestBalance.winRate ?? '—'}% • ${bestBalance.resolved} scored` : 'Need 5+ scored'} help="Blends accuracy, sample size, no-trade control, and average ask when available." tone={bestBalance && bestBalance.valueScore >= 70 ? 'good' : 'blue'} />
          <Metric label="Next Checkpoint" value={nextCheckpoint ? nextCheckpoint.label : 'All captured'} detail={nextCheckpoint ? 'Keep app open' : 'Waiting for close'} help="Edge15 only records a timing checkpoint when the app is open within about 45 seconds of that checkpoint. This avoids fake backfilled results." tone="blue" />
          <div className="rounded-2xl border border-edge-line bg-black/20 p-3">
            <div className="text-xs uppercase tracking-[0.18em] text-edge-muted">Current window captures</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {COMMIT_TIMING_CHECKPOINTS.map((checkpoint) => {
                const captured = currentRecords.find((record) => record.timingLabel === checkpoint.label);
                return (
                  <span key={checkpoint.id} className={`rounded-full border px-2 py-1 text-[11px] font-black ${captured ? captured.committedDirection === 'OVER' ? 'border-edge-green/40 bg-edge-green/10 text-edge-green' : captured.committedDirection === 'UNDER' ? 'border-edge-red/40 bg-edge-red/10 text-edge-red' : 'border-edge-line bg-black/20 text-edge-muted' : 'border-edge-line bg-slate-950 text-edge-muted'}`}>
                    {checkpoint.label}: {captured ? captured.committedDirection : 'waiting'}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="rounded-2xl border border-edge-amber/30 bg-edge-amber/10 p-3 text-xs leading-5 text-edge-amber">
            Early checkpoints can pay better but need cleaner signal. Late checkpoints may predict better but often have weak payout. Genesis-022 starts measuring both sides of that tradeoff.
          </div>
        </div>
      </div>
    </Panel>
  );
}

function buildTimingLabRows(records: CommitTimingRecord[]): TimingLabRow[] {
  return COMMIT_TIMING_CHECKPOINTS.map((checkpoint) => {
    const group = records.filter((record) => record.timingLabel === checkpoint.label);
    const scored = group.filter((record) => record.correct !== null);
    const wins = scored.filter((record) => record.correct === true).length;
    const losses = scored.filter((record) => record.correct === false).length;
    const noTrades = group.filter((record) => record.committedDirection === 'NONE').length;
    const resolved = wins + losses;
    const winRate = resolved ? Math.round((wins / resolved) * 100) : null;
    const avgAskSamples = group.filter((record) => record.payoutAsk !== null && record.committedDirection !== 'NONE') as Array<CommitTimingRecord & { payoutAsk: number }>;
    const avgAsk = avgAskSamples.length ? Math.round(avgAskSamples.reduce((sum, record) => sum + record.payoutAsk, 0) / avgAskSamples.length) : null;
    const valueEdge = winRate !== null && avgAsk !== null ? Math.round(winRate - avgAsk) : null;
    const sampleBoost = Math.min(resolved, 30) * 0.45;
    const noTradePenalty = Math.min(noTrades, 30) * 0.12;
    const valueScore = Math.round((winRate ?? 0) * 0.56 + (valueEdge ?? 0) * 0.9 + sampleBoost - noTradePenalty);
    const valueRead = avgAsk === null
      ? `${resolved} scored • no ask samples yet`
      : `${resolved} scored • avg ask ${avgAsk}¢ • price edge ${valueEdge === null ? '—' : `${valueEdge >= 0 ? '+' : ''}${valueEdge}`}`;
    return { label: checkpoint.label, wins, losses, noTrades, resolved, winRate, avgAsk, valueEdge, valueRead, valueScore };
  });
}

function createCommitTimingRecord({ checkpoint, contractKey, decision, snapshot, now }: { checkpoint: CommitTimingCheckpoint; contractKey: string; decision: Decision; snapshot: MarketSnapshot; now: Date }): CommitTimingRecord {
  const direction = chooseShadowCommitDirection(decision, snapshot);
  const ask = direction === 'OVER' ? snapshot.kalshi?.yesAsk ?? null : direction === 'UNDER' ? snapshot.kalshi?.noAsk ?? null : null;
  const note = direction === 'NONE'
    ? 'Shadow checkpoint chose NO TRADE because the setup did not clear basic quality gates at this time.'
    : `Shadow checkpoint chose ${direction} from ${decision.action}, score ${decision.entryScore}, confidence ${decision.confidence}%.`;
  return {
    id: `${contractKey}:${checkpoint.id}`,
    contractKey,
    timingLabel: checkpoint.label,
    targetRemainingSeconds: checkpoint.targetRemainingSeconds,
    targetElapsedMs: checkpoint.targetElapsedMs,
    capturedAt: now.toISOString(),
    committedDirection: direction,
    decisionAction: decision.action,
    entryScore: decision.entryScore,
    confidence: decision.confidence,
    opportunity: decision.opportunity,
    stability: decision.stability,
    tradeGrade: decision.tradeGrade,
    settlementRisk: decision.settlement.risk,
    distanceToReference: decision.distanceToReference,
    payoutAsk: ask,
    outcome: 'UNKNOWN',
    correct: null,
    open: null,
    close: null,
    resolvedAt: null,
    note,
  };
}

function chooseShadowCommitDirection(decision: Decision, snapshot: MarketSnapshot): 'OVER' | 'UNDER' | 'NONE' {
  if (decision.direction !== 'OVER' && decision.direction !== 'UNDER') return 'NONE';
  if (decision.action === 'AVOID') return 'NONE';
  if (decision.settlement.risk === 'Extreme' || decision.settlement.risk === 'High') return 'NONE';
  if (decision.confidence < 55 || decision.opportunity < 56 || decision.stability < 52) return 'NONE';
  if (decision.entryScore > 46 && decision.entryScore < 54) return 'NONE';
  const wrongSide = decision.direction === 'OVER'
    ? decision.distanceToReference !== null && decision.distanceToReference < -8
    : decision.distanceToReference !== null && decision.distanceToReference > 8;
  if (wrongSide) return 'NONE';
  const ask = decision.direction === 'OVER' ? snapshot.kalshi?.yesAsk ?? null : snapshot.kalshi?.noAsk ?? null;
  if (ask !== null && ask >= 94) return 'NONE';
  return decision.direction;
}


function createStrategyProfileRecord({ profile, contractKey, decision, snapshot, countdown, flipRisk, now }: { profile: StrategyProfile; contractKey: string; decision: Decision; snapshot: MarketSnapshot; countdown: Countdown; flipRisk: FlipRisk; now: Date }): StrategyProfileRecord {
  const direction = chooseStrategyProfileDirection(profile.id, decision, snapshot, countdown, flipRisk);
  const ask = direction === 'OVER' ? snapshot.kalshi?.yesAsk ?? null : direction === 'UNDER' ? snapshot.kalshi?.noAsk ?? null : null;
  return {
    id: `${contractKey}:${profile.id}`,
    contractKey,
    profileId: profile.id,
    profileLabel: profile.label,
    capturedAt: now.toISOString(),
    committedDirection: direction,
    entryScore: decision.entryScore,
    confidence: decision.confidence,
    opportunity: decision.opportunity,
    stability: decision.stability,
    tradeGrade: decision.tradeGrade,
    settlementRisk: decision.settlement.risk,
    payoutAsk: ask,
    outcome: 'UNKNOWN',
    correct: null,
    open: null,
    close: null,
    resolvedAt: null,
    note: direction === 'NONE' ? `${profile.label} profile skipped this setup.` : `${profile.label} profile shadow-picked ${direction}.`,
  };
}

function chooseStrategyProfileDirection(profileId: string, decision: Decision, snapshot: MarketSnapshot, countdown: Countdown, flipRisk: FlipRisk): 'OVER' | 'UNDER' | 'NONE' {
  if (decision.direction !== 'OVER' && decision.direction !== 'UNDER') return 'NONE';
  if (decision.action === 'AVOID') return 'NONE';
  const ask = decision.direction === 'OVER' ? snapshot.kalshi?.yesAsk ?? null : snapshot.kalshi?.noAsk ?? null;
  const wrongSide = decision.direction === 'OVER'
    ? decision.distanceToReference !== null && decision.distanceToReference < -8
    : decision.distanceToReference !== null && decision.distanceToReference > 8;

  if (profileId === 'aggressive') {
    if (decision.settlement.risk === 'Extreme') return 'NONE';
    if (decision.confidence < 52 || decision.opportunity < 52 || decision.stability < 48) return 'NONE';
    if (ask !== null && ask >= 97) return 'NONE';
    return decision.direction;
  }

  if (profileId === 'balanced') {
    if (decision.settlement.risk === 'Extreme' || decision.settlement.risk === 'High') return 'NONE';
    if (decision.confidence < 58 || decision.opportunity < 58 || decision.stability < 55) return 'NONE';
    if (wrongSide) return 'NONE';
    if (ask !== null && ask >= 94) return 'NONE';
    return decision.direction;
  }

  if (profileId === 'selective') {
    if (decision.settlement.risk !== 'Low' && decision.settlement.risk !== 'Medium') return 'NONE';
    if (decision.confidence < 64 || decision.opportunity < 64 || decision.stability < 62 || decision.entryScore < 58) return 'NONE';
    if (wrongSide) return 'NONE';
    if (ask !== null && ask >= 90) return 'NONE';
    return decision.direction;
  }

  if (profileId === 'ultra') {
    if (!decision.action.startsWith('ENTER')) return 'NONE';
    if (decision.settlement.risk !== 'Low') return 'NONE';
    if (decision.confidence < 72 || decision.opportunity < 70 || decision.stability < 70 || decision.entryScore < 64) return 'NONE';
    if (wrongSide) return 'NONE';
    if (ask !== null && ask >= 82) return 'NONE';
    return decision.direction;
  }

  if (profileId === 'value') {
    if (decision.settlement.risk === 'Extreme' || decision.settlement.risk === 'High') return 'NONE';
    if (decision.confidence < 60 || decision.opportunity < 60 || decision.entryScore < 56) return 'NONE';
    if (wrongSide) return 'NONE';
    if (ask === null) return 'NONE';
    if (ask < 35 || ask > 78) return 'NONE';
    return decision.direction;
  }

  if (profileId === 'no_chase') {
    if (countdown.remainingMs <= 3 * 60 * 1000) return 'NONE';
    if (flipRisk.level === 'High') return 'NONE';
    if (decision.settlement.risk === 'Extreme' || decision.settlement.risk === 'High') return 'NONE';
    if (decision.confidence < 60 || decision.opportunity < 60 || decision.stability < 58) return 'NONE';
    if (wrongSide) return 'NONE';
    if (ask !== null && ask >= 92) return 'NONE';
    return decision.direction;
  }

  return 'NONE';
}

function resolveStrategyProfileRecord(record: StrategyProfileRecord, candles: MarketSnapshot['candles']): StrategyProfileRecord {
  if (record.correct !== null || record.committedDirection === 'NONE') {
    if (record.committedDirection === 'NONE' && record.resolvedAt === null) return { ...record, resolvedAt: new Date().toISOString() };
    return record;
  }
  const startIso = record.contractKey.replace('15m:', '');
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return record;
  const endMs = startMs + 15 * 60 * 1000;
  if (Date.now() < endMs + 5000) return record;
  const windowCandles = candles.slice().sort((a, b) => a.time - b.time).filter((c) => c.time >= startMs && c.time < endMs);
  if (windowCandles.length < 2) return record;
  const first = windowCandles[0];
  const last = windowCandles[windowCandles.length - 1];
  const change = last.close - first.open;
  const outcome: StrategyProfileRecord['outcome'] = Math.abs(change) < 0.01 ? 'FLAT' : change > 0 ? 'OVER' : 'UNDER';
  return {
    ...record,
    outcome,
    correct: outcome === record.committedDirection,
    open: first.open,
    close: last.close,
    resolvedAt: new Date().toISOString(),
  };
}

function resolveCommitTimingRecord(record: CommitTimingRecord, candles: MarketSnapshot['candles']): CommitTimingRecord {
  if (record.correct !== null || record.committedDirection === 'NONE') {
    if (record.committedDirection === 'NONE' && record.resolvedAt === null) return { ...record, resolvedAt: new Date().toISOString() };
    return record;
  }
  const startIso = record.contractKey.replace('15m:', '');
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return record;
  const endMs = startMs + 15 * 60 * 1000;
  if (Date.now() < endMs + 5000) return record;
  const windowCandles = candles.slice().sort((a, b) => a.time - b.time).filter((c) => c.time >= startMs && c.time < endMs);
  if (windowCandles.length < 2) return record;
  const first = windowCandles[0];
  const last = windowCandles[windowCandles.length - 1];
  const change = last.close - first.open;
  const outcome: CommitTimingRecord['outcome'] = Math.abs(change) < 0.01 ? 'FLAT' : change > 0 ? 'OVER' : 'UNDER';
  return {
    ...record,
    outcome,
    correct: outcome === record.committedDirection,
    open: first.open,
    close: last.close,
    resolvedAt: new Date().toISOString(),
  };
}

function PerformanceTrackerPanel({ records }: { records: CommitmentAccuracyRecord[] }) {
  const windows = buildPerformanceWindows(records);
  const allTime = windows[0];
  const tone = allTime.winRate === null ? 'neutral' : allTime.winRate >= 75 ? 'good' : allTime.winRate >= 60 ? 'warn' : 'bad';
  return (
    <Panel title="Performance tracker">
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
        <Metric label="All-time W/L" value={`${allTime.wins}-${allTime.losses}`} detail={allTime.winRate === null ? 'No resolved trades yet' : `${allTime.winRate}% win rate`} help="Automatic wins and losses from Edge15's committed OVER/UNDER plans. NO TRADE is tracked separately and does not count as a loss." tone={tone} />
        <Metric label="No Trades" value={`${allTime.noTrades}`} detail="Skipped commitments" help="A NO TRADE is Edge15 protecting you from a low-quality setup. It is not counted as a win or loss." tone="blue" />
        <Metric label="Resolved" value={`${allTime.resolved}`} detail="Scored commitments" help="Number of completed committed OVER/UNDER calls stored in this browser." tone="neutral" />
      </div>
      <div className="mt-4 grid gap-2">
        {windows.slice(1).map((window) => (
          <div key={window.label} className="grid grid-cols-[88px_1fr_70px] items-center gap-2 rounded-xl border border-edge-line bg-black/20 px-3 py-2 text-xs">
            <div className="font-black text-slate-200">{window.label}</div>
            <div className="text-edge-muted">W/L {window.wins}-{window.losses} • No trade {window.noTrades}</div>
            <div className={`text-right font-black ${window.winRate === null ? 'text-edge-muted' : window.winRate >= 75 ? 'text-edge-green' : window.winRate >= 60 ? 'text-edge-amber' : 'text-edge-red'}`}>{window.winRate === null ? '—' : `${window.winRate}%`}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-2xl border border-edge-amber/30 bg-edge-amber/10 p-3 text-xs leading-5 text-edge-amber">
        Automatic while Edge15 is open. If every device is closed, a future cloud watcher is needed to keep scoring windows in the background.
      </div>
    </Panel>
  );
}

function buildPerformanceWindows(records: CommitmentAccuracyRecord[]): PerformanceWindow[] {
  const windows: Array<{ label: string; hours: number | null }> = [
    { label: 'All time', hours: null },
    { label: '1 hour', hours: 1 },
    { label: '4 hours', hours: 4 },
    { label: '12 hours', hours: 12 },
    { label: '24 hours', hours: 24 },
  ];
  const nowMs = Date.now();
  return windows.map((window) => {
    const filtered = records.filter((record) => {
      if (window.hours === null) return true;
      const resolvedMs = Date.parse(record.resolvedAt);
      return Number.isFinite(resolvedMs) && nowMs - resolvedMs <= window.hours * 60 * 60 * 1000;
    });
    const scored = filtered.filter((record) => record.correct !== null);
    const wins = scored.filter((record) => record.correct === true).length;
    const losses = scored.filter((record) => record.correct === false).length;
    const noTrades = filtered.filter((record) => record.committedDirection === 'NONE').length;
    const resolved = wins + losses;
    return {
      label: window.label,
      hours: window.hours,
      wins,
      losses,
      noTrades,
      resolved,
      winRate: resolved ? Math.round((wins / resolved) * 100) : null,
    };
  });
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
        <Metric label="Current lock" value={activeSignal?.commitmentStatus === 'COMMITTED' ? activeSignal.committedDirection : activeSignal?.commitmentStatus === 'NO TRADE' ? 'NO TRADE' : 'SCOUT'} detail="This contract" help="Edge15 records this automatically when the contract rolls into the next 15-minute window. SCOUT means no lock has formed yet." tone={activeSignal?.commitmentStatus === 'COMMITTED' ? 'blue' : 'neutral'} />
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


function resolveCommitmentAccuracyRecord(record: CommitmentAccuracyRecord, candles: MarketSnapshot['candles']): CommitmentAccuracyRecord {
  if (record.correct !== null || record.committedDirection === 'NONE') return record;
  const startIso = record.contractKey.replace('15m:', '');
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return record;
  const endMs = startMs + 15 * 60 * 1000;
  if (Date.now() < endMs + 5000) return record;
  const windowCandles = candles.slice().sort((a, b) => a.time - b.time).filter((c) => c.time >= startMs && c.time < endMs);
  if (windowCandles.length < 2) return record;
  const first = windowCandles[0];
  const last = windowCandles[windowCandles.length - 1];
  const change = last.close - first.open;
  const outcome: CommitmentAccuracyRecord['outcome'] = Math.abs(change) < 0.01 ? 'FLAT' : change > 0 ? 'OVER' : 'UNDER';
  return {
    ...record,
    outcome,
    correct: outcome === record.committedDirection,
    open: first.open,
    close: last.close,
    resolvedAt: new Date().toISOString(),
  };
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
      entryScore: plan.committedEntryScore ?? null,
      confidence: plan.committedConfidence ?? null,
      tradeGrade: plan.committedTradeGrade ?? null,
      settlementRisk: plan.committedSettlementRisk ?? null,
      priceAtCommit: plan.committedPrice ?? null,
      distanceAtCommit: plan.committedDistance ?? null,
      flipRiskAtCommit: null,
      tradeQualityAtCommit: null,
      source: 'auto_observed',
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
    entryScore: plan.committedEntryScore ?? null,
    confidence: plan.committedConfidence ?? null,
    tradeGrade: plan.committedTradeGrade ?? null,
    settlementRisk: plan.committedSettlementRisk ?? null,
    priceAtCommit: plan.committedPrice ?? null,
    distanceAtCommit: plan.committedDistance ?? null,
    flipRiskAtCommit: null,
    tradeQualityAtCommit: null,
    source: 'auto_observed',
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
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4">
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


function buildValueGate(direction: SignalDirection, countdown: Countdown, snapshot: MarketSnapshot): EntryGate {
  if (direction !== 'OVER' && direction !== 'UNDER') {
    return { label: 'Payout value', passed: false, detail: 'No side selected yet, so Edge15 cannot judge payout value.', severity: 'warn' };
  }
  const askCents = direction === 'OVER' ? snapshot.kalshi?.yesAsk ?? null : snapshot.kalshi?.noAsk ?? null;
  const late = countdown.remainingMs <= 240000;
  if (askCents === null) {
    return {
      label: 'Payout value',
      passed: !late,
      detail: late ? 'Odds are unavailable and the window is late. Edge15 blocks fresh entries when payout value cannot be verified.' : 'Odds are unavailable. This gate will become stricter late in the window.',
      severity: late ? 'block' : 'warn',
    };
  }
  const cost = askCents / 100;
  const grossProfit = Math.max(0, 1 - cost);
  const tooExpensive = late && (askCents >= 90 || grossProfit <= 0.1);
  const thin = askCents >= 86 || grossProfit <= 0.14;
  return {
    label: 'Payout value',
    passed: !tooExpensive,
    detail: `${direction} ask ≈ $${cost.toFixed(2)} to win $1.00, gross upside ≈ $${grossProfit.toFixed(2)}. ${tooExpensive ? 'Too little reward for late-window risk.' : thin ? 'Thin payout; only acceptable if the setup is very clean.' : 'Payout is not overly compressed.'}`,
    severity: tooExpensive ? 'block' : thin ? 'warn' : 'ok',
  };
}

function buildEntryGates(decision: Decision, activeSignal: SignalPlan | null, countdown: Countdown, qualityFilter: QualityFilter, snapshot: MarketSnapshot, autoTightening: AutoTighteningProfile, flipRisk: FlipRisk, tradeQuality: TradeQuality): EntryGate[] {
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
      detail: `${decision.settlement.risk}. Clean ENTER needs Low settlement risk in Genesis-022. ${decision.settlement.message}`,
      severity: decision.settlement.risk === 'Extreme' || decision.settlement.risk === 'High' ? 'block' : 'warn',
    },
    buildValueGate(direction, countdown, snapshot),
    {
      label: 'Late flip risk',
      passed: flipRisk.level !== 'High' || countdown.remainingMs > 300000,
      detail: flipRisk.message,
      severity: flipRisk.level === 'High' && countdown.remainingMs <= 300000 ? 'block' : flipRisk.level === 'Medium' ? 'warn' : 'ok',
    },
    {
      label: 'Auto-tightening',
      passed: autoTightening.mode === 'NORMAL' || decision.entryScore >= 78 + autoTightening.extraScoreNeeded,
      detail: autoTightening.message,
      severity: autoTightening.mode === 'MAX' ? 'block' : autoTightening.mode === 'STRICT' ? 'warn' : 'ok',
    },
    {
      label: 'Trade Quality',
      passed: tradeQuality.label === 'STRONG' || tradeQuality.label === 'DECENT',
      detail: `${tradeQuality.label} at ${tradeQuality.score}/100. ${tradeQuality.message}`,
      severity: tradeQuality.label === 'AVOID' ? 'block' : tradeQuality.label === 'WEAK' ? 'warn' : 'ok',
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
  if (countdown.remainingMs <= 180000) return `Only ${countdown.display} remains. Genesis-022 blocks fresh late entries because the last 3 minutes are too jumpy and the payout is often too small.`;
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
    aiDesk: 'AI Engines',
    indicators: 'Indicators',
    whyNot: 'Warnings',
    dataHealth: 'Data',
    genesisStatus: 'Status',
  };
  return labels[key];
}
