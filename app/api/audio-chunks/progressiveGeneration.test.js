import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { buildMp3Frames, MP3_FRAME_DURATION_SECONDS } from '@/app/_lib/mp3Frames.fixture';

// Fake the two external dependencies (object storage, edge-tts) at the lowest level so
// this test exercises the real chunking + Audio Generation Service + both API routes
// end-to-end, without a real network call or a real bucket. For storage that level is now
// fetch itself: objectStorageClient.js signs and issues its own requests, so faking here
// keeps the real client - signing, suffixing, 404-means-absent - inside what is covered
// rather than replacing it with a stub.
const { blobStore, synthesizeCalls } = vi.hoisted(() => ({
  blobStore: new Map(),
  synthesizeCalls: [],
}));

const R2_ENV = {
  R2_ACCOUNT_ID: 'acct-1',
  R2_BUCKET: 'text-reader',
  R2_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'secret-example',
  SEGMENT_ORIGIN: 'https://segments.test/',
};

// The bucket-relative object key, back out of the signed URL the client formed.
function objectKey(url) {
  return decodeURIComponent(new URL(url).pathname).slice(`/${R2_ENV.R2_BUCKET}/`.length);
}

async function fakeStorageFetch(request) {
  const key = objectKey(request.url);

  if (request.method === 'GET') {
    return blobStore.has(key)
      ? new Response(blobStore.get(key), { status: 200 })
      : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
  }

  if (request.method === 'PUT') {
    // Audio is kept as bytes rather than text: the duration measurement reads it back, and
    // decoding MP3 frames as UTF-8 would not round-trip. Metadata is kept as text so a test
    // can seed and read it as JSON.
    const bytes = new Uint8Array(await request.arrayBuffer());
    blobStore.set(key, key.endsWith('.json') ? new TextDecoder().decode(bytes) : bytes);
    return new Response(null, { status: 200 });
  }

  return new Response(null, { status: 405 });
}

// The fake's audio has to be real MP3 frames, because the generation path now measures its
// duration and an unmeasurable Chunk is treated as uncacheable. See app/_lib/mp3Frames.js.
const FRAME_COUNT = 20;
const MP3_DURATION_SECONDS = FRAME_COUNT * MP3_FRAME_DURATION_SECONDS;

function fakeMp3Bytes() {
  return buildMp3Frames(FRAME_COUNT);
}

vi.mock('edge-tts-universal', () => ({
  EdgeTTS: class {
    constructor(text, voice) {
      this.text = text;
      this.voice = voice;
    }
    async synthesize() {
      synthesizeCalls.push({ text: this.text, voice: this.voice });
      return {
        audio: new Blob([fakeMp3Bytes()]),
        subtitle: [{ text: this.text, offset: 0, duration: 1000 }],
      };
    }
  },
}));

const { POST: postChunks } = await import('../chunks/route');
const { POST: postAudioChunk } = await import('./route');

function jsonRequest(body) {
  return { json: () => Promise.resolve(body) };
}

describe('progressive generation orchestration', () => {
  beforeEach(() => {
    blobStore.clear();
    synthesizeCalls.length = 0;
    Object.entries(R2_ENV).forEach(([name, value]) => vi.stubEnv(name, value));
    vi.stubGlobal('fetch', vi.fn(fakeStorageFetch));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test('walks a full short book end-to-end: chunk it, then generate every chunk in order', async () => {
    const bookId = 'book-1';
    const text = '今天天氣很好。我們去公園散步。路上遇到了朋友！大家一起聊天。晚上回家吃飯了。';

    // Get the ordered chunk list for the book.
    const chunksResponse = await postChunks(jsonRequest({ text }));
    const { chunks } = await chunksResponse.json();
    expect(chunks.length).toBeGreaterThan(1);

    // Walk every chunk in order, generating its audio via the second endpoint.
    const results = [];
    for (const [chunkIndex, chunkText] of chunks.entries()) {
      const response = await postAudioChunk(
        jsonRequest({ bookId, chunkIndex, text: chunkText, voice: 'zh-TW-HsiaoChenNeural' }),
      );
      results.push(await response.json());
    }

    // Every chunk produced its own audio, paired with the correct chunk's text.
    expect(synthesizeCalls.map((call) => call.text)).toEqual(chunks);
    results.forEach((result, index) => {
      expect(result.boundaries[0].text).toBe(chunks[index]);
    });
  });

  test('requesting chunks out of order generates only the requested chunk, correctly', async () => {
    const bookId = 'book-2';
    const text =
      '第一句話。第二句話。第三句話。第四句話。第五句話。第六句話。第七句話。第八句話。第九句話。第十句話。第十一句話。第十二句話。';
    const { chunks } = await (await postChunks(jsonRequest({ text }))).json();
    expect(chunks.length).toBeGreaterThanOrEqual(3);

    // Jump straight to the last chunk before ever requesting the earlier ones.
    const lastIndex = chunks.length - 1;
    const jumpResponse = await postAudioChunk(
      jsonRequest({
        bookId,
        chunkIndex: lastIndex,
        text: chunks[lastIndex],
        voice: 'zh-TW-HsiaoChenNeural',
      }),
    );
    const jumpResult = await jumpResponse.json();

    expect(jumpResult.boundaries[0].text).toBe(chunks[lastIndex]);
    expect(synthesizeCalls).toHaveLength(1);
    expect(synthesizeCalls[0].text).toBe(chunks[lastIndex]);

    // Now request an earlier chunk — it must generate its own, unrelated audio.
    const earlyResponse = await postAudioChunk(
      jsonRequest({ bookId, chunkIndex: 0, text: chunks[0], voice: 'zh-TW-HsiaoChenNeural' }),
    );
    const earlyResult = await earlyResponse.json();

    expect(earlyResult.boundaries[0].text).toBe(chunks[0]);
    expect(synthesizeCalls).toHaveLength(2);
  });

  test('replaying a chunk that was already generated is served from cache, no new synthesis call', async () => {
    const bookId = 'book-3';
    const text = '這是唯一的一句話。';
    const { chunks } = await (await postChunks(jsonRequest({ text }))).json();

    const first = await postAudioChunk(
      jsonRequest({ bookId, chunkIndex: 0, text: chunks[0], voice: 'zh-TW-HsiaoChenNeural' }),
    );
    const firstResult = await first.json();

    const second = await postAudioChunk(
      jsonRequest({ bookId, chunkIndex: 0, text: chunks[0], voice: 'zh-TW-HsiaoChenNeural' }),
    );
    const secondResult = await second.json();

    expect(secondResult).toEqual(firstResult);
    expect(synthesizeCalls).toHaveLength(1);
  });

  test('a chunk cached before durationSeconds existed is repaired from its stored audio', async () => {
    const bookId = 'book-legacy';
    const text = '這是唯一的一句話。';
    const { chunks } = await (await postChunks(jsonRequest({ text }))).json();
    // Seed the store the way a pre-ticket-02 run left it: audio plus metadata with no
    // durationSeconds.
    const key = `${bookId}/0/zh-TW-HsiaoChenNeural`;
    blobStore.set(`${key}.mp3`, fakeMp3Bytes());
    blobStore.set(
      `${key}.json`,
      JSON.stringify({
        url: `https://blob.test/${key}.mp3`,
        boundaries: [{ text: chunks[0], offset: 0, duration: 1000 }],
      }),
    );

    const response = await postAudioChunk(
      jsonRequest({ bookId, chunkIndex: 0, text: chunks[0], voice: 'zh-TW-HsiaoChenNeural' }),
    );
    const result = await response.json();

    // Measured from the audio already in storage, not resynthesized, and written back so the
    // next read is a plain cache hit.
    expect(synthesizeCalls).toHaveLength(0);
    expect(result.durationSeconds).toBeCloseTo(MP3_DURATION_SECONDS, 10);
    expect(JSON.parse(blobStore.get(`${key}.json`)).durationSeconds).toBeCloseTo(
      MP3_DURATION_SECONDS,
      10,
    );
  });

  test('two different books do not share a cached chunk at the same index', async () => {
    const text = '這是唯一的一句話。';
    const { chunks } = await (await postChunks(jsonRequest({ text }))).json();

    const firstId = 'book-x';
    await postAudioChunk(
      jsonRequest({
        bookId: firstId,
        chunkIndex: 0,
        text: chunks[0],
        voice: 'zh-TW-HsiaoChenNeural',
      }),
    );

    const secondId = 'book-y';
    await postAudioChunk(
      jsonRequest({
        bookId: secondId,
        chunkIndex: 0,
        text: chunks[0],
        voice: 'zh-TW-HsiaoChenNeural',
      }),
    );

    expect(synthesizeCalls).toHaveLength(2);
  });
});
