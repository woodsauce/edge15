import type { Candle } from '@/lib/types/market';

const BINANCE_US_TICKER = 'https://api.binance.us/api/v3/ticker/price?symbol=BTCUSD';
const BINANCE_US_KLINES = 'https://api.binance.us/api/v3/klines?symbol=BTCUSD&interval=1m&limit=75';
const TIMEOUT_MS = 6500;

export async function fetchFallbackTicker(): Promise<number> {
  const res = await fetchWithTimeout(BINANCE_US_TICKER, TIMEOUT_MS);
  if (!res.ok) throw new Error(`Binance.US ticker failed: HTTP ${res.status}`);
  const data = await res.json();
  const price = Number(data?.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Binance.US ticker returned no usable BTC price');
  return price;
}

export async function fetchFallbackCandles(): Promise<Candle[]> {
  const res = await fetchWithTimeout(BINANCE_US_KLINES, TIMEOUT_MS);
  if (!res.ok) throw new Error(`Binance.US candles failed: HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('Binance.US candles returned invalid payload');

  const candles = rows
    .map((row): Candle => ({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }))
    .filter(isUsableCandle)
    .sort((a, b) => a.time - b.time);

  if (candles.length < 10) throw new Error(`Binance.US returned too few candles: ${candles.length}`);
  return candles;
}

function isUsableCandle(c: Candle) {
  return [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite) && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0;
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
