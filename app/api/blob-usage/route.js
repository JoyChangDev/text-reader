import { NextResponse } from 'next/server';

import { getUsage } from '@/app/_lib/blobCleanupService';

export async function GET() {
  try {
    const usage = await getUsage();
    return NextResponse.json(usage);
  } catch (error) {
    console.error('Fetching blob usage failed', error);
    return NextResponse.json({ error: 'Fetching blob usage failed' }, { status: 502 });
  }
}
