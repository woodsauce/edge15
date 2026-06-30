import { NextResponse } from 'next/server';
import { fetchFallbackCandles, fetchFallbackTicker } from '@/lib/data/fallback';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [price, candles] = await Promise.all([fetchFallbackTicker(), fetchFallbackCandles()]);
    return NextResponse.json({ ok: true, price, candleCount: candles.length, candles, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Fallback route failed', timestamp: new Date().toISOString() }, { status: 502 });
  }
}
