// The only public read path into a private R2 bucket. Why it exists, why the bucket is private,
// why it lives here rather than in the Cloudflare dashboard, and why it has no tests are all in
// .scratch/phase-1-11-object-storage-migration/issues/01-r2-bucket-and-segment-worker.md
//
// The one thing worth repeating at the code: a request path is `audioPathname` from
// app/_lib/chunkIndex.js with a leading slash, so the mapping is a strip rather than a
// translation, and the two files have to be changed together.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers':
    'Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag',
  'Access-Control-Max-Age': '86400',
};

// Only `.mp3` is public. The bucket also holds library/<bookId>/chunks.json - a Book's full text -
// and this Worker is the whole boundary between a private bucket and the open internet. See the
// ticket for the cost of this rule; it is a deviation from "no application logic".
const SERVED_SUFFIX = '.mp3';

// The key is taken raw rather than decoded. Every component of the scheme is URL-safe by
// construction - a uuid, an integer, an ASCII voice id - so there is nothing to decode, and
// decoding would corrupt a key containing a literal `%` for the sake of a case that cannot arise.
function toObjectKey(pathname) {
  const key = pathname.replace(/^\/+/, '');
  return key.endsWith(SERVED_SUFFIX) ? key : undefined;
}

// R2 reports the range it served, which is what Content-Range must describe. Three things about
// that object, each of which produced a wrong response here before it was understood:
//
//   - It carries every field, so `'suffix' in range` is true even for an offset/length range.
//     Presence has to be tested by value, or `size - undefined` yields `bytes NaN-NaN/85248`.
//   - It is populated even when no range was asked for, resolved to the whole object, so it
//     cannot answer "is this partial" - only the request's own Range header can.
//   - A header R2 cannot parse (`bytes=abc`, or a multi-range) also resolves to the whole
//     object rather than being rejected, which is why a resolved range covering everything is
//     treated as no range at all below.
function resolveRange(range, size) {
  if (range.suffix !== undefined) {
    return { offset: size - range.suffix, length: range.suffix };
  }

  const offset = range.offset ?? 0;
  return { offset, length: range.length ?? size - offset };
}

function notFound() {
  return new Response('Not found', { status: 404, headers: CORS_HEADERS });
}

const segmentWorker = {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { ...CORS_HEADERS, Allow: 'GET, HEAD, OPTIONS' },
      });
    }

    const key = toObjectKey(new URL(request.url).pathname);
    if (!key) {
      return notFound();
    }

    let object;
    try {
      object = await env.SEGMENTS.get(key, { range: request.headers });
    } catch (error) {
      // R2 throws on a range that starts past the end of the object. Left alone that surfaces as
      // a 500, which on a segment origin reads as "the Worker is broken" - the most expensive
      // wrong diagnosis available here. It is only reported as a client error once the object is
      // known to exist, so a genuinely broken store still fails loudly rather than quietly.
      if (!request.headers.has('Range') || !(await env.SEGMENTS.head(key))) {
        throw error;
      }

      return new Response('Range not satisfiable', { status: 416, headers: CORS_HEADERS });
    }

    if (!object) {
      // Distinct from an empty 200: a Chunk that has not been generated yet must stay
      // distinguishable from one that has, both to the caller and to anyone debugging this.
      return notFound();
    }

    const headers = new Headers(CORS_HEADERS);
    // Content-Type and Cache-Control come from what was stored, never from a guess here. The app
    // sets them at write time (ticket 02), so there is no second place for them to drift.
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('Accept-Ranges', 'bytes');

    const range = request.headers.has('Range')
      ? resolveRange(object.range, object.size)
      : undefined;
    const isPartial = range !== undefined && range.length < object.size;

    if (!isPartial) {
      // Answering 200 to a Range header R2 resolved to the whole object is deliberate: RFC 9110
      // lets a server ignore a range, and 206 with a Content-Range spanning the entire file would
      // claim a partial response that isn't one.
      headers.set('Content-Length', String(object.size));
      return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
    }

    headers.set(
      'Content-Range',
      `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`,
    );
    headers.set('Content-Length', String(range.length));

    return new Response(request.method === 'HEAD' ? null : object.body, { status: 206, headers });
  },
};

export default segmentWorker;
