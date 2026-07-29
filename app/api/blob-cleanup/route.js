import { NextResponse } from 'next/server';

import { cleanupBlobs } from '@/app/_lib/blobCleanupService';

async function runCleanup() {
  try {
    const result = await cleanupBlobs();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Blob cleanup failed', error);
    return NextResponse.json({ error: 'Blob cleanup failed' }, { status: 502 });
  }
}

// Vercel Cron always invokes its target path with GET (see vercel.json), while the
// Listener-facing "clean up now" button POSTs - this route answers both with the same
// handler, per ticket 09.
export const GET = runCleanup;
export const POST = runCleanup;
