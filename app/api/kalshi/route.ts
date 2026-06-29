import { NextResponse } from 'next/server';
import { fetchKalshiBtc15m } from '@/lib/data/kalshi';

export const dynamic = 'force-dynamic';

export async function GET() {
  const market = await fetchKalshiBtc15m();
  return NextResponse.json({ ok: true, market, timestamp: new Date().toISOString() });
}
