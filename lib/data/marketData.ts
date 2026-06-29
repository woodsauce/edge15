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
  let kalshi = kalshiResult.ok ? kalshiResult.value : null;
  if (kalshi && kalshi.strike === null) {
    const derivedStrike = deriveReferenceStrikeFromCandles(kalshi.closeTime, candles);
    if (derivedStrike !== null) {
      kalshi = {
        ...kalshi,
        strike: derivedStrike,
        strikeSource: 'derived window open from 1m candles',
        derivedStrike: true,
      };
    }
  }

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


function deriveReferenceStrikeFromCandles(closeTime: string | null, candles: MarketSnapshot['candles']): number | null {
  if (!closeTime || candles.length === 0) return null;

  const closeMs = Date.parse(closeTime);
  if (!Number.isFinite(closeMs)) return null;

  // KXBTC15M markets are 15-minute windows. If Kalshi does not expose a
  // traditional strike for an "up in next 15 mins" market, use the candle
  // closest to the contract open as the working reference target. This is a
  // derived trading reference, not an official settlement value.
  const openMs = closeMs - 15 * 60 * 1000;
  const sorted = candles.slice().sort((a, b) => Math.abs(a.time - openMs) - Math.abs(b.time - openMs));
  const nearest = sorted[0];
  if (!nearest) return null;

  // Only accept a nearby 1-minute candle so stale candle history cannot create
  // a misleading target. Use the candle open because this market asks whether
  // BTC is up from the start of the 15-minute window.
  const maxDistanceMs = 2 * 60 * 1000;
  if (Math.abs(nearest.time - openMs) > maxDistanceMs) return null;
  return Number.isFinite(nearest.open) ? nearest.open : null;
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
