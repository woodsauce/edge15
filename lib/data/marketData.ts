import type { MarketSnapshot } from '@/lib/types/market';
import { fetchCoinbaseCandles, fetchCoinbaseTicker } from '@/lib/data/coinbase';
import { fetchFallbackCandles, fetchFallbackTicker } from '@/lib/data/fallback';
import { fetchKalshiBtc15m } from '@/lib/data/kalshi';

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  let btcPrice: number | null = null;
  let candles = [] as MarketSnapshot['candles'];
  let source = 'none';
  const health: MarketSnapshot['health'] = { coinbase: 'unknown', fallback: 'unknown', kalshi: 'unknown' };

  try {
    const [price, coinbaseCandles] = await Promise.all([fetchCoinbaseTicker(), fetchCoinbaseCandles()]);
    btcPrice = price;
    candles = coinbaseCandles;
    source = 'coinbase';
    health.coinbase = 'ok';
  } catch {
    health.coinbase = 'degraded';
    try {
      const [price, fallbackCandles] = await Promise.all([fetchFallbackTicker(), fetchFallbackCandles()]);
      btcPrice = price;
      candles = fallbackCandles;
      source = 'binance-us-fallback';
      health.fallback = 'ok';
    } catch {
      health.fallback = 'offline';
    }
  }

  let kalshi = null;
  try {
    kalshi = await fetchKalshiBtc15m();
    health.kalshi = kalshi ? 'ok' : 'degraded';
  } catch {
    health.kalshi = 'offline';
  }

  return {
    source,
    btcPrice,
    strike: kalshi?.strike ?? null,
    candles,
    kalshi,
    health,
    fetchedAt: new Date().toISOString(),
  };
}
