import type { KalshiMarketContext } from '@/lib/types/market';

const KALSHI_BASE_URL = 'https://external-api.kalshi.com/trade-api/v2';
const KALSHI_MARKETS_URL = `${KALSHI_BASE_URL}/markets`;
const TIMEOUT_MS = 6500;

type RawMarket = Record<string, any>;

type OrderbookSide = Array<[number, number]> | Array<{ price?: number; quantity?: number; count?: number }>;

type Orderbook = {
  yes?: OrderbookSide;
  no?: OrderbookSide;
};

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

  const ticker = stringOrNull(market.ticker);
  const title = buildTitle(market);
  const strike = extractStrikeFromMarket(market);

  const marketOdds = extractOddsFromMarket(market);
  const orderbookOdds = ticker ? await safeFetchOrderbookOdds(ticker) : null;
  const odds = {
    yesBid: marketOdds.yesBid ?? orderbookOdds?.yesBid ?? null,
    yesAsk: marketOdds.yesAsk ?? orderbookOdds?.yesAsk ?? null,
    noBid: marketOdds.noBid ?? orderbookOdds?.noBid ?? null,
    noAsk: marketOdds.noAsk ?? orderbookOdds?.noAsk ?? null,
  };

  return {
    ticker,
    title: title || null,
    strike,
    yesBid: odds.yesBid,
    yesAsk: odds.yesAsk,
    noBid: odds.noBid,
    noAsk: odds.noAsk,
    closeTime: stringOrNull(market.close_time ?? market.expiration_time),
    strikeSource: strike === null ? null : detectStrikeSource(market),
    oddsSource: orderbookOdds ? 'orderbook' : marketOdds.source,
  };
}

function chooseBestMarket(markets: RawMarket[]) {
  if (!markets.length) return null;

  const now = Date.now();
  const openMarkets = markets.filter((market) => {
    const close = Date.parse(market.close_time ?? market.expiration_time ?? '');
    return !Number.isFinite(close) || close > now - 60_000;
  });

  return (openMarkets.length ? openMarkets : markets)
    .slice()
    .sort((a, b) => {
      const aTime = Date.parse(a.close_time ?? a.expiration_time ?? '') || Number.MAX_SAFE_INTEGER;
      const bTime = Date.parse(b.close_time ?? b.expiration_time ?? '') || Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    })[0];
}

function buildTitle(market: RawMarket): string {
  const pieces = [market.title, market.subtitle, market.yes_sub_title, market.no_sub_title]
    .map((piece) => (typeof piece === 'string' ? piece.trim() : ''))
    .filter(Boolean);
  return pieces[0] ?? '';
}

function extractStrikeFromMarket(market: RawMarket): number | null {
  const directStrike = firstNumber([
    market.strike,
    market.strike_price,
    market.strike_value,
    market.target,
    market.target_price,
    market.threshold,
    market.floor_strike,
    market.cap_strike,
    market.floor,
    market.cap,
    market.open_value,
    market.initial_value,
    market.value,
    market.result_value,
    market.custom_strike,
  ]);

  if (directStrike !== null && directStrike > 10_000) return directStrike;

  const searchableText = [
    market.title,
    market.subtitle,
    market.yes_sub_title,
    market.no_sub_title,
    market.rules_primary,
    market.rules_secondary,
    market.settlement_sources,
    market.ticker,
    market.event_ticker,
  ]
    .filter(Boolean)
    .join(' ');

  return extractStrikeFromText(searchableText);
}

function detectStrikeSource(market: RawMarket): string | null {
  const directFields = [
    'strike',
    'strike_price',
    'strike_value',
    'target',
    'target_price',
    'threshold',
    'floor_strike',
    'cap_strike',
    'floor',
    'cap',
    'open_value',
    'initial_value',
    'value',
    'result_value',
    'custom_strike',
  ];

  for (const field of directFields) {
    const n = numberOrNull(market[field]);
    if (n !== null && n > 10_000) return field;
  }

  return 'text';
}

function extractOddsFromMarket(market: RawMarket): { yesBid: number | null; yesAsk: number | null; noBid: number | null; noAsk: number | null; source: string | null } {
  const yesBid = centsOrNull(firstDefined([
    market.yes_bid,
    market.yes_bid_price,
    market.best_yes_bid,
    market.best_bid,
    market.bid,
  ]));

  const yesAsk = centsOrNull(firstDefined([
    market.yes_ask,
    market.yes_ask_price,
    market.best_yes_ask,
    market.best_ask,
    market.ask,
  ]));

  const noBid = centsOrNull(firstDefined([
    market.no_bid,
    market.no_bid_price,
    market.best_no_bid,
  ]));

  const noAsk = centsOrNull(firstDefined([
    market.no_ask,
    market.no_ask_price,
    market.best_no_ask,
  ]));

  return {
    yesBid,
    yesAsk: yesAsk ?? (noBid === null ? null : 100 - noBid),
    noBid,
    noAsk: noAsk ?? (yesBid === null ? null : 100 - yesBid),
    source: yesBid !== null || yesAsk !== null || noBid !== null || noAsk !== null ? 'market' : null,
  };
}

async function safeFetchOrderbookOdds(ticker: string) {
  try {
    const res = await fetchWithTimeout(`${KALSHI_MARKETS_URL}/${encodeURIComponent(ticker)}/orderbook`, TIMEOUT_MS);
    if (!res.ok) return null;
    const data = await res.json();
    const orderbook: Orderbook | undefined = data?.orderbook;
    if (!orderbook) return null;

    const yesBid = bestBid(orderbook.yes);
    const noBid = bestBid(orderbook.no);

    return {
      yesBid,
      yesAsk: noBid === null ? null : 100 - noBid,
      noBid,
      noAsk: yesBid === null ? null : 100 - yesBid,
    };
  } catch {
    return null;
  }
}

function bestBid(side: OrderbookSide | undefined): number | null {
  if (!Array.isArray(side) || side.length === 0) return null;

  const prices = side
    .map((level) => {
      if (Array.isArray(level)) return centsOrNull(level[0]);
      return centsOrNull(level.price);
    })
    .filter((price): price is number => price !== null);

  return prices.length ? Math.max(...prices) : null;
}

function extractStrikeFromText(text: string): number | null {
  const matches = [...text.matchAll(/\$?([0-9]{2,3}(?:,[0-9]{3})+(?:\.\d+)?|[0-9]{5,6}(?:\.\d+)?)/g)];
  const values = matches
    .map((m) => Number(m[1].replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n > 10_000 && n < 1_000_000);
  return values[0] ?? null;
}

function firstNumber(values: unknown[]): number | null {
  for (const value of values) {
    const n = numberOrNull(value);
    if (n !== null) return n;
  }
  return null;
}

function firstDefined(values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const cleaned = typeof value === 'string' ? value.replace(/[$,%\s]/g, '').replace(/,/g, '') : value;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function centsOrNull(value: unknown): number | null {
  const n = numberOrNull(value);
  if (n === null) return null;
  if (n >= 0 && n <= 1) return Math.round(n * 100);
  if (n >= 0 && n <= 100) return Math.round(n);
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { 'user-agent': 'edge15-genesis/0.2.1' },
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
