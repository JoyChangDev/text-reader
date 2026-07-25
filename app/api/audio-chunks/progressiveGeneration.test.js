import { beforeEach, describe, expect, test, vi } from 'vitest';

// Fake the two external dependencies (object storage, edge-tts) at the lowest level so
// this test exercises the real chunking + Audio Generation Service + both API routes
// end-to-end, without a real network call or real Vercel Blob storage.
const { blobStore, synthesizeCalls } = vi.hoisted(() => ({
  blobStore: new Map(),
  synthesizeCalls: [],
}));

vi.mock('@vercel/blob', () => ({
  async get(pathname) {
    if (!blobStore.has(pathname)) {
      return null;
    }
    // blobStorageClient.js wraps this in `new Response(result.stream)`, which accepts a
    // plain string body just as well as a real stream.
    return { stream: blobStore.get(pathname) };
  },
  async put(pathname, data) {
    const content = typeof data === 'string' ? data : await data.text();
    blobStore.set(pathname, content);
    return { url: `https://blob.test/${pathname}` };
  },
}));

vi.mock('edge-tts-universal', () => ({
  EdgeTTS: class {
    constructor(text, voice) {
      this.text = text;
      this.voice = voice;
    }
    async synthesize() {
      synthesizeCalls.push({ text: this.text, voice: this.voice });
      return {
        audio: new Blob([`audio-for:${this.text}`]),
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
      const response = await postAudioChunk(jsonRequest({ bookId, chunkIndex, text: chunkText }));
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
      jsonRequest({ bookId, chunkIndex: lastIndex, text: chunks[lastIndex] }),
    );
    const jumpResult = await jumpResponse.json();

    expect(jumpResult.boundaries[0].text).toBe(chunks[lastIndex]);
    expect(synthesizeCalls).toHaveLength(1);
    expect(synthesizeCalls[0].text).toBe(chunks[lastIndex]);

    // Now request an earlier chunk — it must generate its own, unrelated audio.
    const earlyResponse = await postAudioChunk(
      jsonRequest({ bookId, chunkIndex: 0, text: chunks[0] }),
    );
    const earlyResult = await earlyResponse.json();

    expect(earlyResult.boundaries[0].text).toBe(chunks[0]);
    expect(synthesizeCalls).toHaveLength(2);
  });

  test('replaying a chunk that was already generated is served from cache, no new synthesis call', async () => {
    const bookId = 'book-3';
    const text = '這是唯一的一句話。';
    const { chunks } = await (await postChunks(jsonRequest({ text }))).json();

    const first = await postAudioChunk(jsonRequest({ bookId, chunkIndex: 0, text: chunks[0] }));
    const firstResult = await first.json();

    const second = await postAudioChunk(jsonRequest({ bookId, chunkIndex: 0, text: chunks[0] }));
    const secondResult = await second.json();

    expect(secondResult).toEqual(firstResult);
    expect(synthesizeCalls).toHaveLength(1);
  });

  test('two different books do not share a cached chunk at the same index', async () => {
    const text = '這是唯一的一句話。';
    const { chunks } = await (await postChunks(jsonRequest({ text }))).json();

    const firstId = 'book-x';
    await postAudioChunk(jsonRequest({ bookId: firstId, chunkIndex: 0, text: chunks[0] }));

    const secondId = 'book-y';
    await postAudioChunk(jsonRequest({ bookId: secondId, chunkIndex: 0, text: chunks[0] }));

    expect(synthesizeCalls).toHaveLength(2);
  });
});
