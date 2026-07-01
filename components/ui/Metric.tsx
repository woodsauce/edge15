import { clsx } from 'clsx';

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'blue';

export function Metric({ label, value, detail, help, tone = 'neutral' }: { label: string; value: string; detail?: string; help?: string; tone?: Tone }) {
  const toneClass = {
    neutral: 'text-white', good: 'text-edge-green', warn: 'text-edge-amber', bad: 'text-edge-red', blue: 'text-edge-blue'
  }[tone];
  return (
    <div className="rounded-2xl border border-edge-line bg-black/18 p-3">
      <div className="text-xs uppercase tracking-[0.18em] text-edge-muted">{label}</div>
      <div className={clsx('mt-1 break-words text-xl font-black leading-tight tracking-tight sm:text-2xl', toneClass)}>{highlightDirection(value)}</div>
      {detail ? <div className="mt-1 text-xs text-edge-muted">{highlightDirection(detail)}</div> : null}
      {help ? <div className="mt-2 rounded-xl border border-edge-line bg-black/20 px-2 py-2 text-[11px] leading-4 text-slate-400">{highlightDirection(help)}</div> : null}
    </div>
  );
}

function highlightDirection(text: string) {
  const parts = text.split(/(OVER|UNDER)/g);
  return parts.map((part, index) => {
    if (part === 'OVER') return <span key={`${part}-${index}`} className="text-edge-green">OVER</span>;
    if (part === 'UNDER') return <span key={`${part}-${index}`} className="text-edge-red">UNDER</span>;
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}
