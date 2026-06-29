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

export type KalshiMarketContext = {
  ticker: string | null;
  title: string | null;
  strike: number | null;
  yesBid: number | null;
  yesAsk: number | null;
  closeTime: string | null;
};

export type MarketSnapshot = {
  source: string;
  btcPrice: number | null;
  strike: number | null;
  candles: Candle[];
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
