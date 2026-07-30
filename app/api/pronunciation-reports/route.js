import { NextResponse } from 'next/server';

import { submitReport } from '@/app/_lib/pronunciationReportService';

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
