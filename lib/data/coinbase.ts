import type { Candle } from '@/lib/types/market';

const COINBASE_PRODUCTS_URL = 'https://api.exchange.coinbase.com/products/BTC-USD/ticker';
const COINBASE_CANDLES_URL = 'https://api.exchange.coinbase.com/products/BTC-USD/candles';

export async function fetchCoinbaseTicker(): Promise<number> {
  const res = await fetch(COINBASE_PRODUCTS_URL, {
    headers: { 'user-agent': 'edge15-genesis/0.1' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Coinbase ticker failed: ${res.status}`);
  const data = await res.json();
  const price = Number(data?.price);
  if (!Number.isFinite(price)) throw new Error('Coinbase ticker returned no price');
  return price;
}

export async function fetchCoinbaseCandles(): Promise<Candle[]> {
  const end = new Date();
  const start = new Date(end.getTime() - 60 * 60 * 1000);
  const url = new URL(COINBASE_CANDLES_URL);
  url.searchParams.set('granularity', '60');
  url.searchParams.set('start', start.toISOString());
  url.searchParams.set('end', end.toISOString());
  const res = await fetch(url.toString(), {
    headers: { 'user-agent': 'edge15-genesis/0.1' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Coinbase candles failed: ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('Coinbase candles returned invalid payload');
  return rows
    .map((row): Candle => ({
      time: Number(row[0]) * 1000,
      low: Number(row[1]),
      high: Number(row[2]),
      open: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }))
    .filter((c) => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => a.time - b.time);
}
