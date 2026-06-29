export type Countdown = {
  windowStart: Date;
  windowEnd: Date;
  remainingMs: number;
  elapsedMs: number;
  display: string;
  progress: number;
};

export function buildCountdown(now: Date): Countdown {
  const ms = now.getTime();
  const windowMs = 15 * 60 * 1000;
  const startMs = Math.floor(ms / windowMs) * windowMs;
  const endMs = startMs + windowMs;
  const remainingMs = Math.max(0, endMs - ms);
  const elapsedMs = Math.max(0, ms - startMs);
  return {
    windowStart: new Date(startMs),
    windowEnd: new Date(endMs),
    remainingMs,
    elapsedMs,
    display: formatRemaining(remainingMs),
    progress: Math.min(1, Math.max(0, elapsedMs / windowMs)),
  };
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
