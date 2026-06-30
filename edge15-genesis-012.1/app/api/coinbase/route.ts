import { NextResponse } from 'next/server';
import { fetchCoinbaseCandles, fetchCoinbaseTicker } from '@/lib/data/coinbase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [price, candles] = await Promise.all([fetchCoinbaseTicker(), fetchCoinbaseCandles()]);
    return NextResponse.json({ ok: true, price, candleCount: candles.length, candles, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Coinbase route failed', timestamp: new Date().toISOString() }, { status: 502 });
  }
}
