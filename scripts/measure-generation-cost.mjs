import { createR2Signer } from './r2-client.mjs';
import { generatedChunkIndexes } from './r2-summary.mjs';

// Generates an exact range of Chunks through the deployed app, with a quiet pause either side
// so the Upstash and R2 counters can be read against a window nothing else is in. It closes
// the last open measurement in
// .scratch/phase-1-11-object-storage-migration/issues/05-cut-over-and-measure.md: Upstash
// commands per generated Chunk, expected 2 after ticket 04.
//
//   npm run measure-generation -- <bookId> --from 200 --count 20
//
// Why a script and not curl: POST /api/audio-chunks takes the Chunk's `text`, so the Book has
// to be read first — and that read itself spends Upstash commands, which is exactly the
// contamination that made the first attempt an upper bound rather than a figure. Everything
// costly happens before the window opens.
//
// It talks to the deployed app over HTTP and never to Upstash, so nothing it does can be
// mistaken for what is being measured. The one thing it reads directly is R2, to check the
// range is not already generated - see below.

const DEFAULT_APP = 'https://leia-text-reader.vercel.app';
const DEFAULT_VOICE = 'zh-TW-HsiaoChenNeural';
// Long enough to switch to a dashboard and read two numbers without hurrying.
const DEFAULT_PAUSE_SECONDS = 30;

function parseArgs(argv) {
  const options = {
    bookId: undefined,
    from: undefined,
    count: 20,
    voice: DEFAULT_VOICE,
    app: DEFAULT_APP,
    pause: DEFAULT_PAUSE_SECONDS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === '--from') options.from = Number(value);
    else if (arg === '--count') options.count = Number(value);
    else if (arg === '--voice') options.voice = value;
    else if (arg === '--app') options.app = value;
    else if (arg === '--pause') options.pause = Number(value);
    else if (arg.startsWith('--')) throw new Error(`Unknown option "${arg}".`);
    else {
      options.bookId = arg;
      continue;
    }

    index += 1;
  }

  if (!options.bookId) throw new Error('A bookId is required.');
  if (!Number.isInteger(options.from)) throw new Error('--from needs an integer Chunk index.');

  return options;
}

// A Chunk that is already stored comes back as a cache hit: it still writes the Redis index
// but writes nothing to R2, so including one would raise the measured Upstash-per-Chunk while
// lowering the measured Class A. Refusing beats discovering it afterwards, when the window is
// spent and the numbers look merely surprising.
async function assertRangeIsUngenerated({ bookId, voice, from, count }) {
  const { aws, base } = createR2Signer();
  const url = new URL(base);
  url.searchParams.set('list-type', '2');
  url.searchParams.set('prefix', `${bookId}/`);

  const response = await aws.fetch(url.toString(), { method: 'GET' });
  if (!response.ok) throw new Error(`Listing ${bookId} failed with ${response.status}`);
  const body = await response.text();

  const objects = [...body.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map(([, pathname]) => ({
    pathname,
  }));
  const generated = generatedChunkIndexes(objects, voice);
  const clash = generated.filter((index) => index >= from && index < from + count);

  if (clash.length > 0) {
    const highest = generated[generated.length - 1];
    throw new Error(
      `Chunks ${clash.join(', ')} are already generated for ${voice}. ` +
        `Highest generated index is ${highest}; try --from ${highest + 1} or later.`,
    );
  }

  return generated;
}

async function readBook(app, bookId) {
  const response = await fetch(`${app}/api/library/${bookId}`);
  if (!response.ok) throw new Error(`Reading the Book failed with ${response.status}`);
  return response.json();
}

function countdown(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// Sequential, unlike the app's look-ahead, which fires the whole window at once. The point
// here is a window with clean edges and a readable per-Chunk trace, not throughput — and a
// burst would make a failure partway through hard to attribute.
async function generate({ app, bookId, voice, chunks, from, count }) {
  for (let index = from; index < from + count; index += 1) {
    const startedAt = Date.now();
    const response = await fetch(`${app}/api/audio-chunks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookId, chunkIndex: index, text: chunks[index], voice }),
    });

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (!response.ok) {
      throw new Error(`Chunk ${index} failed with ${response.status} after ${seconds}s`);
    }
    console.log(`  chunk ${index} ok (${seconds}s)`);
  }
}

async function main() {
  const { bookId, from, count, voice, app, pause } = parseArgs(process.argv.slice(2));

  const generated = await assertRangeIsUngenerated({ bookId, voice, from, count });
  console.log(
    `${generated.length} Chunk(s) already generated for ${voice}, highest index ${generated[generated.length - 1] ?? 'none'}.`,
  );

  const book = await readBook(app, bookId);
  if (from + count > book.chunks.length) {
    throw new Error(`The Book has ${book.chunks.length} Chunks; ${from}+${count} runs past it.`);
  }
  console.log(`Read ${book.chunks.length} Chunks of text. Nothing measured yet.\n`);

  console.log('>>> Read the Upstash command count and the R2 Class A count NOW. <<<');
  console.log(`    Close the app on every device first. Starting in ${pause}s (Ctrl-C aborts).\n`);
  await countdown(pause);

  const openedAt = new Date().toISOString();
  console.log(`[window opened ${openedAt}]`);
  await generate({ app, bookId, voice, chunks: book.chunks, from, count });
  const closedAt = new Date().toISOString();
  console.log(`[window closed ${closedAt}]\n`);

  console.log('>>> Read both counters again NOW. <<<\n');
  console.log(`Expected over ${count} Chunk(s): Upstash +${count * 2}, R2 +${count * 2} objects.`);
  console.log('Confirm the R2 half against the objects rather than the dashboard, which lags:');
  console.log(`  npm run inspect-r2 -- ${bookId}/ --since ${openedAt}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
