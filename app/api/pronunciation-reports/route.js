import { NextResponse } from 'next/server';

import { listReports, submitReport } from '@/app/_lib/pronunciationReportService';

export async function GET() {
  try {
    const reports = await listReports();
    return NextResponse.json({ reports });
  } catch (error) {
    console.error('Listing pronunciation reports failed', error);
    return NextResponse.json({ error: 'Listing pronunciation reports failed' }, { status: 502 });
  }
}

export async function POST(request) {
  const { bookTitle, phrase, description } = await request.json();

  if (!bookTitle || !phrase) {
    return NextResponse.json({ error: 'bookTitle and phrase are required' }, { status: 400 });
  }

  try {
    const report = await submitReport({ bookTitle, phrase, description });
    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    console.error('Submitting the pronunciation report failed', error);
    return NextResponse.json(
      { error: 'Submitting the pronunciation report failed' },
      { status: 502 },
    );
  }
}
