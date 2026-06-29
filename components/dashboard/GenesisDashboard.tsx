'use client';

import { useEffect, useMemo, useState } from 'react';
import { Panel } from '@/components/ui/Panel';
import { Metric } from '@/components/ui/Metric';
import type { MarketSnapshot } from '@/lib/types/market';
import { calculateDecision } from '@/lib/decision/calculateDecision';
import { buildCountdown } from '@/lib/position/countdown';

const DEFAULT_SNAPSHOT: MarketSnapshot = {
  source: 'bootstrap',
  btcPrice: null,
  strike: null,
  candles: [],
  kalshi: null,
  health: { coinbase: 'unknown', kalshi: 'unknown', fallback: 'unknown' },
  fetchedAt: null,
};

export function GenesisDashboard() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot>(DEFAULT_SNAPSHOT);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

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
        if (!res.ok) throw new Error(data?.error || 'Market data request failed');
        if (!cancelled) {
          setSnapshot(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown market-data error');
      }
    }
    load();
    const timer = window.setInterval(load, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const countdown = useMemo(() => buildCountdown(now), [now]);
  const decision = useMemo(() => calculateDecision(snapshot, countdown), [snapshot, countdown]);

  const price = snapshot.btcPrice ? `$${snapshot.btcPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : 'Loading';
  const strike = snapshot.strike ? `$${snapshot.strike.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'Manual/Detect';
  const distance = snapshot.btcPrice && snapshot.strike ? snapshot.btcPrice - snapshot.strike : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.38em] text-edge-blue">Genesis-001</div>
          <h1 className="text-3xl font-black tracking-tight">Edge15</h1>
        </div>
        <div className="rounded-full border border-edge-line bg-black/30 px-3 py-2 text-xs text-edge-muted">
          {error ? 'Data degraded' : 'Live monitor'}
        </div>
      </header>

      <Panel className="text-center">
        <div className="text-sm uppercase tracking-[0.22em] text-edge-muted">Time remaining</div>
        <div className="mt-1 text-6xl font-black tracking-tighter sm:text-7xl">{countdown.display}</div>
        <div className="mt-2 text-sm text-edge-muted">Current 15-minute window • updates every 3 seconds</div>
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
            <Metric label="Strike" value={strike} detail="Kalshi target/manual later" />
            <Metric label="Distance" value={distance === null ? '—' : `${distance >= 0 ? '+' : ''}$${distance.toFixed(0)}`} detail={distance === null ? 'Waiting for strike' : distance >= 0 ? 'Above strike' : 'Below strike'} tone={distance === null ? 'neutral' : distance >= 0 ? 'good' : 'bad'} />
            <Metric label="Candles" value={`${snapshot.candles.length}`} detail="1m data loaded" />
          </div>
        </Panel>

        <Panel title="Health">
          <div className="space-y-2 text-sm">
            <HealthRow label="Coinbase" value={snapshot.health.coinbase} />
            <HealthRow label="Fallback" value={snapshot.health.fallback} />
            <HealthRow label="Kalshi" value={snapshot.health.kalshi} />
            {error ? <div className="rounded-xl border border-edge-red/40 bg-edge-red/10 p-3 text-edge-red">{error}</div> : null}
            <div className="text-xs text-edge-muted">Last update: {snapshot.fetchedAt ? new Date(snapshot.fetchedAt).toLocaleTimeString() : 'not yet'}</div>
          </div>
        </Panel>
      </div>

      <Panel title="Market story">
        <p className="text-base leading-7 text-slate-200">{decision.story}</p>
      </Panel>

      <Panel title="Genesis status">
        <ul className="list-disc space-y-2 pl-5 text-sm text-edge-muted">
          <li>Foundation project is modular and Vercel-ready.</li>
          <li>Genesis-001 focuses on live data, health, countdown, and decision scaffolding.</li>
          <li>Next milestones add full indicators, lifecycle mode, and the AI Trading Desk.</li>
        </ul>
      </Panel>
    </main>
  );
}

function HealthRow({ label, value }: { label: string; value: string }) {
  const tone = value === 'ok' ? 'text-edge-green' : value === 'unknown' ? 'text-edge-muted' : 'text-edge-amber';
  return <div className="flex items-center justify-between rounded-xl border border-edge-line bg-black/15 px-3 py-2"><span>{label}</span><span className={tone}>{value}</span></div>;
}
