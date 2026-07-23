import { NextResponse } from 'next/server';

import { chunkText } from '@/app/_lib/chunkText';

export async function POST(request) {
  const { text } = await request.json();

  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }

  return NextResponse.json({ chunks: chunkText(text) });
}
