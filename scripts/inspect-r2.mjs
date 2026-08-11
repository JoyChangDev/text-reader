import { createR2Signer } from './r2-client.mjs';
import { formatBytes, summariseObjects } from './r2-summary.mjs';

// Read-only listing of the R2 bucket, for the measurements
// .scratch/phase-1-11-object-storage-migration/issues/05-cut-over-and-measure.md still has
// open: what a generated run actually stored, whether deleting a Book removed its audio, and
// whether the capacity indicator's percentage agrees with the bucket. It writes nothing and
// deletes nothing.
//
// Run with real credentials on the environment:
//   npm run inspect-r2 -- [prefix] [--since <ISO timestamp>] [--keys]
//
// Examples:
//   npm run inspect-r2                                  # the whole bucket, by prefix
//   npm run inspect-r2 -- <bookId>/                     # one Book, after deleting it
//   npm run inspect-r2 -- --since 2026-08-11T09:00:00Z  # what a measured run wrote
//
// The ListObjectsV2 parse is a cut-down app/_lib/listObjectsXml.js, duplicated for the reason
// scripts/clear-abandoned-library.mjs gives: that module uses ESM syntax only Next's bundler
// can load, and this is a plain Node script. Signing is shared with the other scripts here
// (r2-client.mjs), and the summarising half is r2-summary.mjs, which has tests.
//
// Note for whoever is watching the dashboard: each page of this listing is itself a Class A
// operation. That is why the ticket counts objects rather than the counter — but take the
// baseline before the counter reading, not after.

// The three tags this needs out of a ListObjectsV2 body, plus the two that say whether the
// body is one at all. `<Contents>` never nests, so the lazy match cannot swallow a sibling.
//
// listObjectsXml.js also unescapes the five XML entities; dropped here because every key this
// bucket holds is `<bookId>/<chunkIndex>/<voice>.(mp3|json)` or `library/...`, none of which
// can contain one. A key that somehow did would print and group by its escaped form rather
// than be lost.
const CONTENTS = /<Contents>([\s\S]*?)<\/Contents>/g;
const readTag = (xml, name) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];

async function listPage(aws, base, prefix, continuationToken) {
  const url = new URL(base);
  url.searchParams.set('list-type', '2');
  if (prefix) url.searchParams.set('prefix', prefix);
  if (continuationToken) url.searchParams.set('continuation-token', continuationToken);

  const response = await aws.fetch(url.toString(), { method: 'GET' });
  if (!response.ok) {
    throw new Error(
      `LIST failed with ${response.status}: ${(await response.text()).slice(0, 500)}`,
    );
  }

  const body = await response.text();
  const isTruncated = readTag(body, 'IsTruncated');
  // An empty body or an HTML error page parses cleanly into zero objects and reads as an
  // empty bucket — which is the exact wrong answer when this is being run to confirm that a
  // delete removed everything under a prefix. Every real response carries `<IsTruncated>`,
  // including one with no keys, so its absence is the test.
  if (isTruncated === undefined) {
    throw new Error(`Not a listing response: ${body.slice(0, 500)}`);
  }

  return {
    objects: [...body.matchAll(CONTENTS)].map(([, contents]) => ({
      pathname: readTag(contents, 'Key'),
      size: Number(readTag(contents, 'Size')) || 0,
      uploadedAt: readTag(contents, 'LastModified'),
    })),
    nextContinuationToken: readTag(body, 'NextContinuationToken'),
    isTruncated: isTruncated === 'true',
  };
}

// Pages are followed to the end rather than stopping at S3's 1,000-key cap — a 2,000-Chunk
// Book stores nearly 4,000 objects, and a single page would report a fifth of it. This is the
// same pagination ticket 03 exists for, and reading a short listing as a complete one is how
// a Book that was not fully deleted would look deleted.
async function listAll(prefix) {
  const { aws, base } = createR2Signer();
  const objects = [];
  let continuationToken;

  do {
    const page = await listPage(aws, base, prefix, continuationToken);
    objects.push(...page.objects);

    if (page.isTruncated && !page.nextContinuationToken) {
      throw new Error('The listing was truncated but carried no continuation token.');
    }
    if (page.nextContinuationToken && page.nextContinuationToken === continuationToken) {
      throw new Error('The listing repeated its continuation token.');
    }

    continuationToken = page.nextContinuationToken;
  } while (continuationToken);

  return objects;
}

function parseArgs(argv) {
  const options = { prefix: undefined, since: undefined, keys: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--keys') options.keys = true;
    else if (arg === '--since') {
      options.since = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--')) {
      // A mistyped flag taken as a prefix would match no key and report `0 object(s)` — the
      // same answer a clean delete gives, which is the one question this script is most often
      // run to settle.
      throw new Error(`Unknown option "${arg}". Expected a prefix, --since <timestamp>, --keys.`);
    } else options.prefix = arg;
  }

  if (options.since && Number.isNaN(Date.parse(options.since))) {
    throw new Error(`--since needs a timestamp Date can parse, not "${options.since}".`);
  }

  return options;
}

// The quota blobCleanupService.js measures the capacity indicator against, repeated here so
// the two numbers can be compared without opening the app. Both read the same
// BLOB_QUOTA_BYTES, so they can only disagree if the default below and that module's are
// changed apart — which would make this instrument silently wrong about the one digit it is
// being read for. Change them together.
const QUOTA_BYTES = Number(process.env.BLOB_QUOTA_BYTES) || 10_000_000_000;

function report(summary, { prefix, since, keys }, objects) {
  console.log(`Bucket ${process.env.R2_BUCKET}, prefix: ${prefix ?? '(everything)'}`);
  console.log(
    `${summary.count} object(s), ${formatBytes(summary.bytes)} — ` +
      `${((summary.bytes / QUOTA_BYTES) * 100).toFixed(2)}% of ${formatBytes(QUOTA_BYTES)}`,
  );

  for (const group of summary.groups) {
    const window = group.firstWrite ? `${group.firstWrite} .. ${group.lastWrite}` : '(no dates)';
    console.log(
      `  ${group.prefix.padEnd(42)} ${String(group.count).padStart(6)}  ` +
        `${formatBytes(group.bytes).padStart(10)}  ${window}`,
    );
  }

  if (summary.since) {
    console.log(
      `\nWritten since ${since}: ${summary.since.count} object(s), ${formatBytes(summary.since.bytes)}`,
    );
  }

  if (keys) {
    console.log();
    for (const { pathname, size, uploadedAt } of objects) {
      console.log(`  ${uploadedAt ?? '(no date)'}  ${String(size).padStart(9)}  ${pathname}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const objects = await listAll(options.prefix);
  report(summariseObjects(objects, { since: options.since }), options, objects);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
