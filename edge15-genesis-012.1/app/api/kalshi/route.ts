import { NextResponse } from 'next/server';
import { fetchKalshiBtc15m } from '@/lib/data/kalshi';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const market = await fetchKalshiBtc15m();
    return NextResponse.json({ ok: true, market, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Kalshi route failed', timestamp: new Date().toISOString() }, { status: 502 });
  }
}
