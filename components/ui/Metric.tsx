import { clsx } from 'clsx';

export function Metric({ label, value, detail, tone = 'neutral' }: { label: string; value: string; detail?: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'blue' }) {
  const toneClass = {
    neutral: 'text-white', good: 'text-edge-green', warn: 'text-edge-amber', bad: 'text-edge-red', blue: 'text-edge-blue'
  }[tone];
  return (
    <div className="rounded-2xl border border-edge-line bg-black/18 p-3">
      <div className="text-xs uppercase tracking-[0.18em] text-edge-muted">{label}</div>
      <div className={clsx('mt-1 text-2xl font-black tracking-tight', toneClass)}>{value}</div>
      {detail ? <div className="mt-1 text-xs text-edge-muted">{detail}</div> : null}
    </div>
  );
}
