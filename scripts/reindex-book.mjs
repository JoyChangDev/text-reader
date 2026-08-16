import { createR2Signer } from './r2-client.mjs';

// Rebuilds a Book's Chunk index from the audio already in the bucket — see
// .scratch/phase-1-10-continuous-hls-playback/issues/17-a-generated-chunk-past-the-gap-reads-as-ungenerated.md.
//
// That ticket deleted the Blob scan the routes used to fall back to, which is also what used
// to heal an evicted index: the scan answered, and generation re-indexed as a side effect.
// Without it a wiped Redis leaves every narrated Chunk unreachable — the MP3s sit in R2 under
// keys nothing can name — and the Book silently re-synthesises audio that already exists,
// paying edge-tts and R2 writes for it. This is the way back.
//
// **It re-indexes; it does not re-synthesise.** It asks the bucket which Chunks have audio and
// requests only those, and `/api/audio-chunks` answers a playable cached Chunk by indexing it
// and returning — no TTS call. Asking for Chunks the bucket does not have would generate them
// for real, on a Book that may be thousands of Chunks long, which is why the listing comes
// first and is the only thing that decides what is requested.
//
// It drives the running app rather than writing to Redis directly, deliberately. The cues half
// of the index is derived from the Chunk text by app/_lib/sentenceSpans.js, and a script cannot
// import that (ESM only Next's bundler loads — the reason clear-abandoned-library.mjs and
// inspect-r2.mjs both duplicate what they need). Duplicating a derivation whose output has to
// match the app's byte for byte is how a fixture drifts from the thing it stands in for, which
// is what hid ticket 17 for a day. So the app does it.
//
// Run against an app that is up, with R2 credentials on the environment:
//   npm run reindex-book -- <bookId> [--voice <voice>] [--app <url>]
//
// Examples:
//   npm run reindex-book -- 3a100542-...                       # against localhost:3000
//   npm run reindex-book -- 3a100542-... --app https://…       # against the deployed app

const CONTENTS = /<Contents>([\s\S]*?)<\/Contents>/g;
const readTag = (xml, name) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];

// Metadata objects are `<bookId>/<chunkIndex>/<voice>.json`; the `.mp3` beside each one is the
// audio. The metadata is what carries durationSeconds, so it is what says a Chunk is indexable.
const METADATA_KEY = /^[^/]+\/(\d+)\/(.+)\.json$/;

function parseArgs(argv) {
  const [bookId, ...rest] = argv.filter((arg) => !arg.startsWith('--') || arg.includes('='));
  const flag = (name) => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? undefined : argv[at + 1];
  };
  return {
    bookId,
    voice: flag('voice'),
    app: flag('app') ?? 'http://localhost:3000',
    rest,
  };
}

// Every page of the prefix. Unpaginated would cap at 1,000 keys, and a Book long enough to
// need this script is a Book long enough to exceed that — see phase 1.11's ticket 03, which
// fixed the same omission in the app's own client.
async function listPrefix(aws, base, prefix) {
  const keys = [];
  let token;

  do {
    const url = new URL(base);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', prefix);
    if (token) url.searchParams.set('continuation-token', token);

    const response = await aws.fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Listing ${prefix} failed with ${response.status}`);
    }

    const body = await response.text();
    for (const [, contents] of body.matchAll(CONTENTS)) {
      const key = readTag(contents, 'Key');
      if (key) keys.push(key);
    }

    token =
      readTag(body, 'IsTruncated') === 'true' ? readTag(body, 'NextContinuationToken') : undefined;
  } while (token);

  return keys;
}

async function main() {
  const { bookId, voice: requestedVoice, app } = parseArgs(process.argv.slice(2));
  if (!bookId) {
    throw new Error('Usage: npm run reindex-book -- <bookId> [--voice <voice>] [--app <url>]');
  }

  const { aws, base } = createR2Signer();

  // The Chunk text, which /api/audio-chunks needs to derive the cues half of the index.
  const bookResponse = await fetch(`${app}/api/library/${encodeURIComponent(bookId)}`);
  if (!bookResponse.ok) {
    throw new Error(`Reading the Book from ${app} failed with ${bookResponse.status}`);
  }
  const { chunks, title } = await bookResponse.json();

  const keys = await listPrefix(aws, base, `${bookId}/`);
  const narrated = keys
    .map((key) => key.match(METADATA_KEY))
    .filter(Boolean)
    .map(([, chunkIndex, voice]) => ({ chunkIndex: Number(chunkIndex), voice }))
    .filter(({ voice }) => !requestedVoice || voice === requestedVoice)
    .filter(({ chunkIndex }) => chunkIndex < chunks.length)
    .sort((a, b) => a.chunkIndex - b.chunkIndex);

  console.log(`${title}: ${chunks.length} Chunks, ${narrated.length} with audio in the bucket`);
  if (narrated.length === 0) {
    console.log('Nothing to re-index.');
    return;
  }

  let indexed = 0;
  let failed = 0;

  // Sequential on purpose. This is a repair run with no one waiting on it, and the app it is
  // pointed at may be serving a Listener; a few thousand parallel requests would be the more
  // expensive way to find that out.
  for (const { chunkIndex, voice } of narrated) {
    const response = await fetch(`${app}/api/audio-chunks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId, chunkIndex, text: chunks[chunkIndex], voice }),
    });

    if (response.ok) {
      indexed += 1;
    } else {
      failed += 1;
      console.warn(`  Chunk ${chunkIndex} (${voice}) failed with ${response.status}`);
    }

    if ((indexed + failed) % 100 === 0) {
      console.log(`  ${indexed + failed}/${narrated.length}…`);
    }
  }

  console.log(`Re-indexed ${indexed} Chunks${failed ? `, ${failed} failed` : ''}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
