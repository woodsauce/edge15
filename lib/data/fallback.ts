import type { Candle } from '@/lib/types/market';

const BINANCE_US_TICKER = 'https://api.binance.us/api/v3/ticker/price?symbol=BTCUSD';
const BINANCE_US_KLINES = 'https://api.binance.us/api/v3/klines?symbol=BTCUSD&interval=1m&limit=60';

export async function fetchFallbackTicker(): Promise<number> {
  const res = await fetch(BINANCE_US_TICKER, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Fallback ticker failed: ${res.status}`);
  const data = await res.json();
  const price = Number(data?.price);
  if (!Number.isFinite(price)) throw new Error('Fallback ticker returned no price');
  return price;
}

export async function fetchFallbackCandles(): Promise<Candle[]> {
  const res = await fetch(BINANCE_US_KLINES, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Fallback candles failed: ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('Fallback candles returned invalid payload');
  return rows.map((row): Candle => ({
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  })).filter((c) => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite));
}
