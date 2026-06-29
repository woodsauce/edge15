import type { KalshiMarketContext } from '@/lib/types/market';

const KALSHI_MARKETS_URL = 'https://external-api.kalshi.com/trade-api/v2/markets';
const TIMEOUT_MS = 6500;

export async function fetchKalshiBtc15m(): Promise<KalshiMarketContext | null> {
  const url = new URL(KALSHI_MARKETS_URL);
  url.searchParams.set('series_ticker', 'KXBTC15M');
  url.searchParams.set('status', 'open');
  url.searchParams.set('limit', '20');

  const res = await fetchWithTimeout(url.toString(), TIMEOUT_MS);
  if (!res.ok) throw new Error(`Kalshi markets failed: HTTP ${res.status}`);
  const data = await res.json();
  const markets = Array.isArray(data?.markets) ? data.markets : [];
  const market = chooseBestMarket(markets);
  if (!market) return null;

  const title = String(market.title ?? market.subtitle ?? market.yes_sub_title ?? '');
  const strike = extractStrike([title, market.subtitle, market.yes_sub_title, market.no_sub_title, market.ticker].filter(Boolean).join(' '));

  return {
    ticker: market.ticker ?? null,
    title: title || null,
    strike,
    yesBid: numberOrNull(market.yes_bid ?? market.yes_bid_dollars),
    yesAsk: numberOrNull(market.yes_ask ?? market.yes_ask_dollars),
    closeTime: market.close_time ?? market.expiration_time ?? null,
  };
}

function chooseBestMarket(markets: any[]) {
  if (!markets.length) return null;
  return markets
    .slice()
    .sort((a, b) => {
      const aTime = Date.parse(a.close_time ?? a.expiration_time ?? '') || Number.MAX_SAFE_INTEGER;
      const bTime = Date.parse(b.close_time ?? b.expiration_time ?? '') || Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    })[0];
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractStrike(text: string): number | null {
  const matches = [...text.matchAll(/\$?([0-9]{2,3}(?:,[0-9]{3})+(?:\.\d+)?|[0-9]{5,6}(?:\.\d+)?)/g)];
  const values = matches.map((m) => Number(m[1].replace(/,/g, ''))).filter((n) => Number.isFinite(n) && n > 10000);
  return values[0] ?? null;
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
