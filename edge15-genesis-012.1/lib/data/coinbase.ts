import type { Candle } from '@/lib/types/market';

const COINBASE_TICKER_URL = 'https://api.exchange.coinbase.com/products/BTC-USD/ticker';
const COINBASE_CANDLES_URL = 'https://api.exchange.coinbase.com/products/BTC-USD/candles';
const TIMEOUT_MS = 6500;

export async function fetchCoinbaseTicker(): Promise<number> {
  const res = await fetchWithTimeout(COINBASE_TICKER_URL, TIMEOUT_MS);
  if (!res.ok) throw new Error(`Coinbase ticker failed: HTTP ${res.status}`);
  const data = await res.json();
  const price = Number(data?.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Coinbase ticker returned no usable BTC price');
  return price;
}

export async function fetchCoinbaseCandles(): Promise<Candle[]> {
  const end = new Date();
  const start = new Date(end.getTime() - 180 * 60 * 1000);
  const url = new URL(COINBASE_CANDLES_URL);
  url.searchParams.set('granularity', '60');
  url.searchParams.set('start', start.toISOString());
  url.searchParams.set('end', end.toISOString());

  const res = await fetchWithTimeout(url.toString(), TIMEOUT_MS);
  if (!res.ok) throw new Error(`Coinbase candles failed: HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('Coinbase candles returned invalid payload');

  const candles = rows
    .map((row): Candle => ({
      time: Number(row[0]) * 1000,
      low: Number(row[1]),
      high: Number(row[2]),
      open: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }))
    .filter(isUsableCandle)
    .sort((a, b) => a.time - b.time);

  if (candles.length < 10) throw new Error(`Coinbase returned too few candles: ${candles.length}`);
  return candles;
}

function isUsableCandle(c: Candle) {
  return [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite) && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0;
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { 'user-agent': 'edge15-genesis/0.2' },
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
