export type FeedHealth = 'ok' | 'degraded' | 'offline' | 'unknown';

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type FeedDiagnostic = {
  status: FeedHealth;
  latencyMs: number | null;
  message: string;
  updatedAt: string | null;
};

export type OrderBookMetrics = {
  midPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  spreadBps: number | null;
  bidDepth: number | null;
  askDepth: number | null;
  imbalance: number | null;
  pressure: 'BUY' | 'SELL' | 'NEUTRAL' | 'UNKNOWN';
  levelsUsed: number;
  source: string;
};

export type KalshiMarketContext = {
  ticker: string | null;
  title: string | null;
  strike: number | null;
  yesBid: number | null;
  yesAsk: number | null;
  noBid?: number | null;
  noAsk?: number | null;
  closeTime: string | null;
  strikeSource?: string | null;
  derivedStrike?: boolean;
  oddsSource?: string | null;
};

export type FifteenMinutePeriod = {
  startTime: number;
  endTime: number;
  open: number;
  close: number;
  change: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
};

export type MarketSnapshot = {
  source: string;
  btcPrice: number | null;
  strike: number | null;
  candles: Candle[];
  recentPeriods: FifteenMinutePeriod[];
  orderBook: OrderBookMetrics | null;
  kalshi: KalshiMarketContext | null;
  health: {
    coinbase: FeedHealth;
    kalshi: FeedHealth;
    fallback: FeedHealth;
  };
  diagnostics: {
    coinbase: FeedDiagnostic;
    fallback: FeedDiagnostic;
    kalshi: FeedDiagnostic;
  };
  fetchedAt: string | null;
};
