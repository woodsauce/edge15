import { NextResponse } from 'next/server';
import { getMarketSnapshot } from '@/lib/data/marketData';

export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshot = await getMarketSnapshot();
  const hasAnyPrice = snapshot.btcPrice !== null;
  return NextResponse.json(snapshot, { status: hasAnyPrice ? 200 : 503 });
}
