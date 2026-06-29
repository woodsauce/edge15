import type { FeedDiagnostic, FeedHealth, MarketSnapshot } from '@/lib/types/market';
import { fetchCoinbaseCandles, fetchCoinbaseTicker } from '@/lib/data/coinbase';
import { fetchFallbackCandles, fetchFallbackTicker } from '@/lib/data/fallback';
import { fetchKalshiBtc15m } from '@/lib/data/kalshi';

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const diagnostics = {
    coinbase: blankDiagnostic('unknown', 'Not checked yet'),
    fallback: blankDiagnostic('unknown', 'Not checked yet'),
    kalshi: blankDiagnostic('unknown', 'Not checked yet'),
  };

  let btcPrice: number | null = null;
  let candles: MarketSnapshot['candles'] = [];
  let source = 'none';

  const coinbaseResult = await timed('Coinbase', async () => {
    const [price, coinbaseCandles] = await Promise.all([fetchCoinbaseTicker(), fetchCoinbaseCandles()]);
    return { price, candles: coinbaseCandles };
  });

  diagnostics.coinbase = coinbaseResult.diagnostic;

  if (coinbaseResult.ok) {
    btcPrice = coinbaseResult.value.price;
    candles = coinbaseResult.value.candles;
    source = 'Coinbase Exchange';
  } else {
    const fallbackResult = await timed('Binance.US fallback', async () => {
      const [price, fallbackCandles] = await Promise.all([fetchFallbackTicker(), fetchFallbackCandles()]);
      return { price, candles: fallbackCandles };
    });
    diagnostics.fallback = fallbackResult.diagnostic;
    if (fallbackResult.ok) {
      btcPrice = fallbackResult.value.price;
      candles = fallbackResult.value.candles;
      source = 'Binance.US fallback';
    }
  }

  const kalshiResult = await timed('Kalshi', fetchKalshiBtc15m);
  diagnostics.kalshi = kalshiResult.diagnostic;
  const kalshi = kalshiResult.ok ? kalshiResult.value : null;
  if (kalshiResult.ok && !kalshi) {
    diagnostics.kalshi = {
      ...diagnostics.kalshi,
      status: 'degraded',
      message: 'Kalshi reachable, but no open KXBTC15M market was found.',
    };
  }

  return {
    source,
    btcPrice,
    strike: kalshi?.strike ?? null,
    candles,
    kalshi,
    health: {
      coinbase: diagnostics.coinbase.status,
      fallback: diagnostics.fallback.status,
      kalshi: diagnostics.kalshi.status,
    },
    diagnostics,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getHealthReport() {
  const snapshot = await getMarketSnapshot();
  return {
    ok: snapshot.btcPrice !== null && snapshot.candles.length >= 10,
    source: snapshot.source,
    fetchedAt: snapshot.fetchedAt,
    health: snapshot.health,
    diagnostics: snapshot.diagnostics,
  };
}

function blankDiagnostic(status: FeedHealth, message: string): FeedDiagnostic {
  return { status, latencyMs: null, message, updatedAt: null };
}

type TimedResult<T> =
  | { ok: true; value: T; diagnostic: FeedDiagnostic }
  | { ok: false; diagnostic: FeedDiagnostic };

async function timed<T>(name: string, fn: () => Promise<T>): Promise<TimedResult<T>> {
  const started = Date.now();
  try {
    const value = await fn();
    return {
      ok: true,
      value,
      diagnostic: {
        status: 'ok',
        latencyMs: Date.now() - started,
        message: `${name} feed OK`,
        updatedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : `${name} failed`;
    return {
      ok: false,
      diagnostic: {
        status: 'offline',
        latencyMs: Date.now() - started,
        message,
        updatedAt: new Date().toISOString(),
      },
    };
  }
}
