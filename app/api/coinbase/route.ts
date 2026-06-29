import { NextResponse } from 'next/server';
import { fetchCoinbaseCandles, fetchCoinbaseTicker } from '@/lib/data/coinbase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [price, candles] = await Promise.all([fetchCoinbaseTicker(), fetchCoinbaseCandles()]);
  return NextResponse.json({ ok: true, price, candles, timestamp: new Date().toISOString() });
}
