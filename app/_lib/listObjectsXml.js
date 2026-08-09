// Turns a `ListObjectsV2` response body into the `{ pathname, size, uploadedAt }` records the
// storage client hands its callers — see
// .scratch/phase-1-11-object-storage-migration/issues/03-list-objects-xml-parser.md.
//
// It exists because signing with aws4fetch means talking to S3 over the wire rather than
// through a client that deserializes for us: listing is the one operation whose answer is
// XML rather than bytes or JSON. The repo has direct precedent for paying that price by hand
// instead of taking a dependency — mp3Frames.js walks MPEG frame headers rather than pulling
// in an audio library — and the shape here is narrower still: one flat element per key, no
// nesting, no attributes, no namespace to resolve.
//
// It is pure and knows nothing about requests, which is what lets the client's continuation
// loop live in one place and this be tested against fixture bodies. It never throws: a body
// it cannot fully read yields the records it could, and says enough about itself for the
// caller to decide whether that is an answer worth returning.

// Deliberately not a general XML parser. `<Contents>` never nests, so the lazy match cannot
// swallow a sibling, and the fields wanted are leaf text. Anything a real parser would buy
// here (namespaces, attributes, CDATA, entities beyond the five below) S3 does not send.
const CONTENTS = /<Contents>([\s\S]*?)<\/Contents>/g;

// A truncated body ends mid-element, so its final `<Contents>` simply never closes and never
// matches — which is how "return what could be parsed" falls out rather than being handled.
const readTag = (xml, name) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];

// The five S3 escapes, `&amp;` last so a literal `&amp;lt;` in a key survives as `&lt;`
// rather than being unescaped twice into `<`.
const unescapeXml = (value) =>
  value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');

// A size that will not parse becomes 0 rather than dropping the record: getUsage
// under-reports by one object, where dropping it would take the key out of cleanup's and
// deleteBook's reach for good. A record with no key at all is dropped, because there is
// nothing a caller could do with it — every consumer's next move is to delete the pathname.
function toRecords(xml) {
  const key = readTag(xml, 'Key');
  if (key === undefined) return [];

  const size = Number(readTag(xml, 'Size'));

  return [
    {
      pathname: unescapeXml(key),
      size: Number.isFinite(size) ? size : 0,
      uploadedAt: readTag(xml, 'LastModified'),
    },
  ];
}

// Returns the page's records in the order the response listed them (S3 lists keys in UTF-8
// binary order), the token for the next page if there is one, and two facts about the answer
// itself that the caller needs in order to know whether the records can be trusted.
//
// `isListing` is false for a body that is not a ListObjectsV2 response at all — an empty one,
// or an HTML error page from something in front of the endpoint, both of which would
// otherwise parse cleanly into zero records and read as an empty bucket. Every real response
// carries `<IsTruncated>`, including one with no keys, so its absence is the test.
//
// `isTruncated` is reported rather than folded into the token because the two disagreeing is
// the case worth knowing about: a response that says it was cut short but carries no way to
// ask for the rest. Parsing stays lenient — that is this module's contract, and a short body
// still yields the records it could read — so refusing that answer is the caller's call.
export function parseListObjectsXml(body) {
  const xml = String(body ?? '');
  const isTruncated = readTag(xml, 'IsTruncated');
  const nextContinuationToken = readTag(xml, 'NextContinuationToken');

  return {
    objects: [...xml.matchAll(CONTENTS)].flatMap(([, contents]) => toRecords(contents)),
    nextContinuationToken:
      nextContinuationToken === undefined ? undefined : unescapeXml(nextContinuationToken),
    isListing: isTruncated !== undefined,
    isTruncated: isTruncated === 'true',
  };
}
