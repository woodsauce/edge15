import { ReactNode } from 'react';
import { clsx } from 'clsx';

export function Panel({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-3xl border border-edge-line bg-edge-panel/82 p-4 shadow-2xl shadow-black/20 backdrop-blur', className)}>
      {title ? <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-edge-muted">{title}</h2> : null}
      {children}
    </section>
  );
}
