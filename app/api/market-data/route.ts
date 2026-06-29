import { NextResponse } from 'next/server';
import { getMarketSnapshot } from '@/lib/data/marketData';

export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshot = await getMarketSnapshot();
  const priceFeedOk = snapshot.btcPrice !== null && snapshot.candles.length >= 10;
  return NextResponse.json(snapshot, { status: priceFeedOk ? 200 : 503 });
}
