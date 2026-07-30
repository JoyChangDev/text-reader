import { splitIntoSentences } from '@/app/_lib/chunkText';

import { createFixtureLibrary } from './previewFixtures';

// edge-tts word boundary offsets/durations are in 100-nanosecond units - matches
// sentenceSpans.js's own TICKS_PER_SECOND.
const TICKS_PER_SECOND = 10_000_000;
const SECONDS_PER_CHAR = 0.28;
const SAMPLE_RATE = 8000;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// One boundary per sentence, its text set to the sentence itself, so
// sentenceSpans.js's deriveSentenceSpans (which re-splits the same chunk text into
// sentences and greedily consumes boundaries until each sentence's content length is
// matched) resolves each sentence in exactly one boundary - giving clean, evenly-paced
// spans without needing real word-level TTS output.
function buildBoundaries(text) {
  const sentences = splitIntoSentences(text);
  let offsetSeconds = 0;

  return sentences.map((sentence) => {
    const durationSeconds = Math.max(0.6, sentence.length * SECONDS_PER_CHAR);
    const boundary = {
      text: sentence,
      offset: Math.round(offsetSeconds * TICKS_PER_SECOND),
      duration: Math.round(durationSeconds * TICKS_PER_SECOND),
    };
    offsetSeconds += durationSeconds;
    return boundary;
  });
}

// A real (silent) WAV, built in-memory rather than hitting edge-tts, so the fake
// "audio" actually loads and plays - AudioPlayer's sentence-highlight tracking runs off
// real <audio> timeupdate events, not a mocked clock, so a real playable file (even
// silent) is what makes that visible in the preview.
function silentWavDataUri(durationSeconds) {
  const numSamples = Math.max(1, Math.round(durationSeconds * SAMPLE_RATE));
  const dataSize = numSamples * 2; // 16-bit mono PCM
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);

  return `data:audio/wav;base64,${btoa(binary)}`;
}

function stripChunks({ chunks: _chunks, ...summary }) {
  return summary;
}

// Installs a fetch mock backed entirely by in-memory static data - no network, no
// filesystem - so the real Home/BookLibrary/AudioPlayer/PlayerSettingsSheet component
// tree can render every library/player state unmodified. Only the routes that touch
// Blob storage in production (library CRUD, blob usage/cleanup, audio generation) are
// intercepted; /api/chunks is left alone since chunkText.js is already pure/local and
// needs no faking. Returns a restore function - call it on unmount so navigating away
// from the preview doesn't leave the rest of the app talking to a fake backend.
export function installPreviewFetchMock() {
  // Guards against double-wrapping if this module's top-level install re-runs without a
  // full page reload (e.g. Next's Fast Refresh re-evaluating it on a dev-only file save).
  if (window.fetch.isPreviewMock) return () => {};

  const originalFetch = window.fetch.bind(window);
  let library = createFixtureLibrary();

  const mockedFetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';

    if (url === '/api/library' && method === 'GET') {
      return jsonResponse({ books: library.map(stripChunks) });
    }
    if (url === '/api/library' && method === 'POST') {
      const { bookId, title, chunks } = JSON.parse(init.body);
      const summary = { bookId, title, resumeIndex: 0, totalChunks: chunks.length };
      library = [...library, { ...summary, chunks }];
      return jsonResponse(summary, 201);
    }

    const bookMatch = url.match(/^\/api\/library\/(.+)$/);
    if (bookMatch && method === 'GET') {
      const book = library.find((entry) => entry.bookId === bookMatch[1]);
      return book ? jsonResponse(book) : jsonResponse({ error: 'not found' }, 404);
    }
    if (bookMatch && method === 'PATCH') {
      const { resumeIndex } = JSON.parse(init.body);
      const index = library.findIndex((entry) => entry.bookId === bookMatch[1]);
      if (index === -1) return jsonResponse({ error: 'not found' }, 404);
      library = library.map((entry, i) => (i === index ? { ...entry, resumeIndex } : entry));
      return jsonResponse(stripChunks(library[index]));
    }
    if (bookMatch && method === 'DELETE') {
      const exists = library.some((entry) => entry.bookId === bookMatch[1]);
      if (!exists) return jsonResponse({ error: 'not found' }, 404);
      library = library.filter((entry) => entry.bookId !== bookMatch[1]);
      return jsonResponse({ bookId: bookMatch[1] });
    }

    if (url === '/api/blob-usage') {
      return jsonResponse({ usedBytes: 214_748_364, quotaBytes: 1_073_741_824, percent: 20 });
    }
    if (url === '/api/blob-cleanup' && method === 'POST') {
      return jsonResponse({ deleted: [] });
    }

    if (url === '/api/audio-chunks' && method === 'POST') {
      const { text } = JSON.parse(init.body);
      const boundaries = buildBoundaries(text);
      const last = boundaries.at(-1);
      const totalSeconds = last
        ? last.offset / TICKS_PER_SECOND + last.duration / TICKS_PER_SECOND
        : 1;
      return jsonResponse({ url: silentWavDataUri(totalSeconds), boundaries });
    }

    return originalFetch(url, init);
  };

  mockedFetch.isPreviewMock = true;
  window.fetch = mockedFetch;

  return () => {
    window.fetch = originalFetch;
  };
}
