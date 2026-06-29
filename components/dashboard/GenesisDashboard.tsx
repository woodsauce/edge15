'use client';

import { useEffect, useMemo, useState } from 'react';
import { Panel } from '@/components/ui/Panel';
import { Metric } from '@/components/ui/Metric';
import type { FeedDiagnostic, FeedHealth, MarketSnapshot } from '@/lib/types/market';
import { calculateDecision } from '@/lib/decision/calculateDecision';
import { buildCountdown } from '@/lib/position/countdown';

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

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/market-data', { cache: 'no-store' });
        const data = await res.json();
        if (!cancelled && isMarketSnapshot(data)) {
          setSnapshot(data);
        }
        if (!res.ok) {
          const message = buildFriendlyError(data);
          if (!cancelled) setError(message);
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
  const priceFeedLive = snapshot.btcPrice !== null && snapshot.candles.length >= 10;

  const price = snapshot.btcPrice ? `$${snapshot.btcPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : 'Loading';
  const strike = snapshot.strike ? `$${snapshot.strike.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'Manual/Detect';
  const distance = snapshot.btcPrice && snapshot.strike ? snapshot.btcPrice - snapshot.strike : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.38em] text-edge-blue">Genesis-002</div>
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

      <Panel>
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Recommendation" value={decision.action} detail={decision.reason} tone={decision.tone} />
          <Metric label="Entry Score" value={`${decision.entryScore}/100`} detail={decision.entryQuality} tone={decision.tone} />
          <Metric label="Opportunity" value={`${decision.opportunity}%`} detail={decision.opportunityLabel} tone={decision.opportunity > 75 ? 'good' : decision.opportunity > 55 ? 'warn' : 'bad'} />
        </div>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Market">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="BTC" value={price} detail={snapshot.source} tone="blue" />
            <Metric label="Strike" value={strike} detail={snapshot.kalshi?.ticker ?? 'Kalshi optional'} />
            <Metric label="Distance" value={distance === null ? '—' : `${distance >= 0 ? '+' : ''}$${distance.toFixed(0)}`} detail={distance === null ? 'Waiting for strike' : distance >= 0 ? 'Above strike' : 'Below strike'} tone={distance === null ? 'neutral' : distance >= 0 ? 'good' : 'bad'} />
            <Metric label="Candles" value={`${snapshot.candles.length}`} detail="1m candles available" tone={snapshot.candles.length >= 10 ? 'good' : 'warn'} />
          </div>
        </Panel>

        <Panel title="Data health">
          <div className="space-y-2 text-sm">
            <HealthRow label="Coinbase" diagnostic={snapshot.diagnostics.coinbase} />
            <HealthRow label="Fallback" diagnostic={snapshot.diagnostics.fallback} />
            <HealthRow label="Kalshi" diagnostic={snapshot.diagnostics.kalshi} />
            {error ? <div className="rounded-xl border border-edge-amber/40 bg-edge-amber/10 p-3 text-edge-amber">{error}</div> : null}
            <div className="text-xs text-edge-muted">Last update: {snapshot.fetchedAt ? new Date(snapshot.fetchedAt).toLocaleTimeString() : 'not yet'}</div>
            <button onClick={runApiTest} disabled={testing} className="w-full rounded-xl border border-edge-blue/40 bg-edge-blue/10 px-3 py-2 text-sm font-bold text-edge-blue disabled:opacity-60">
              {testing ? 'Testing APIs...' : 'Run API Test'}
            </button>
            {Object.keys(apiTest).length ? <ApiTestResults results={apiTest} /> : null}
          </div>
        </Panel>
      </div>

      <Panel title="Market story">
        <p className="text-base leading-7 text-slate-200">{decision.story}</p>
      </Panel>

      <Panel title="Genesis-002 status">
        <ul className="list-disc space-y-2 pl-5 text-sm text-edge-muted">
          <li>Coinbase is the primary live BTC data feed.</li>
          <li>Binance.US is the fallback price/candle feed if Coinbase fails.</li>
          <li>Kalshi market context is optional and no longer allowed to break the dashboard.</li>
          <li>Diagnostics show feed-specific errors instead of a generic data failure.</li>
        </ul>
      </Panel>
    </main>
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
