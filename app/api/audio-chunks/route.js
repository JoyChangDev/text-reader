import { NextResponse } from 'next/server';

import { generateAudioForChunk } from '@/app/_lib/audioGenerationService';

export async function POST(request) {
  const { bookId, chunkIndex, text } = await request.json();

  if (!bookId || chunkIndex === undefined || chunkIndex === null || !text) {
    return NextResponse.json(
      { error: 'bookId, chunkIndex, and text are required' },
      { status: 400 },
    );
  }

  try {
    const result = await generateAudioForChunk({ bookId, chunkIndex, text });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Audio generation failed', error);
    return NextResponse.json({ error: 'Audio generation failed' }, { status: 502 });
  }
}
