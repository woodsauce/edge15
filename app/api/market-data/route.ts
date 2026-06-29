import { NextResponse } from 'next/server';
import { getMarketSnapshot } from '@/lib/data/marketData';
import type { Candle, MarketSnapshot } from '@/lib/types/market';

export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshot = await getMarketSnapshot();
  const patchedSnapshot = ensureDerivedTarget(snapshot);
  const priceFeedOk = patchedSnapshot.btcPrice !== null && patchedSnapshot.candles.length >= 10;
  return NextResponse.json(patchedSnapshot, { status: priceFeedOk ? 200 : 503 });
}

function ensureDerivedTarget(snapshot: MarketSnapshot): MarketSnapshot {
  if (snapshot.strike !== null) return snapshot;

  const closeTime = snapshot.kalshi?.closeTime ?? null;
  const derivedStrike = deriveReferenceStrikeFromCandles(closeTime, snapshot.candles);
  if (derivedStrike === null) return snapshot;

  return {
    ...snapshot,
    strike: derivedStrike,
    kalshi: snapshot.kalshi
      ? {
          ...snapshot.kalshi,
          strike: derivedStrike,
          strikeSource: 'derived window open from 1m candles',
          derivedStrike: true,
        }
      : snapshot.kalshi,
  };
}

function deriveReferenceStrikeFromCandles(closeTime: string | null, candles: Candle[]): number | null {
  if (!closeTime || candles.length === 0) return null;

  const closeMs = Date.parse(closeTime);
  if (!Number.isFinite(closeMs)) return null;

  const openMs = closeMs - 15 * 60 * 1000;

  const nearest = candles
    .slice()
    .sort((a, b) => Math.abs(a.time - openMs) - Math.abs(b.time - openMs))[0];

  if (!nearest) return null;

  const maxDistanceMs = 2 * 60 * 1000;
  if (Math.abs(nearest.time - openMs) > maxDistanceMs) return null;

  return Number.isFinite(nearest.open) ? nearest.open : null;
}
