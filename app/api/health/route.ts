import { NextResponse } from 'next/server';
import { getHealthReport } from '@/lib/data/marketData';

export const dynamic = 'force-dynamic';

export async function GET() {
  const report = await getHealthReport();
  return NextResponse.json({
    ...report,
    app: 'Edge15',
    release: 'Genesis-022',
    timestamp: new Date().toISOString(),
  }, { status: report.ok ? 200 : 503 });
}
