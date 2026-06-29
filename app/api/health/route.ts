import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    ok: true,
    app: 'Edge15',
    release: 'Genesis-001',
    timestamp: new Date().toISOString(),
  });
}
