import type { KalshiMarketContext } from '@/lib/types/market';

const KALSHI_MARKETS_URL = 'https://api.elections.kalshi.com/trade-api/v2/markets';

export async function fetchKalshiBtc15m(): Promise<KalshiMarketContext | null> {
  const url = new URL(KALSHI_MARKETS_URL);
  url.searchParams.set('series_ticker', 'KXBTC15M');
  url.searchParams.set('status', 'open');
  url.searchParams.set('limit', '10');
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Kalshi markets failed: ${res.status}`);
  const data = await res.json();
  const market = Array.isArray(data?.markets) ? data.markets[0] : null;
  if (!market) return null;
  const title = String(market.title ?? market.subtitle ?? '');
  return {
    ticker: market.ticker ?? null,
    title: title || null,
    strike: extractStrike(title),
    yesBid: numberOrNull(market.yes_bid),
    yesAsk: numberOrNull(market.yes_ask),
    closeTime: market.close_time ?? null,
  };
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractStrike(text: string): number | null {
  const matches = [...text.matchAll(/\$?([0-9]{2,3}(?:,[0-9]{3})+(?:\.\d+)?|[0-9]{5,6}(?:\.\d+)?)/g)];
  if (!matches.length) return null;
  const values = matches.map((m) => Number(m[1].replace(/,/g, ''))).filter((n) => Number.isFinite(n) && n > 10000);
  return values[0] ?? null;
}
