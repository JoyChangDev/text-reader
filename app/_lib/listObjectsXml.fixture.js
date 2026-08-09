// Shared test fixture: `ListObjectsV2` response bodies in the shape R2's S3-compatible API
// actually returns them — one flat `<ListBucketResult>` with a `<Contents>` element per key,
// element order and all. Two test files need one (the parser's own, and the storage client's
// `list()`), and the element names are exactly the constants a change to listObjectsXml.js
// would have to keep in step, so they live in one place rather than being copied per file.
// Same reasoning as mp3Frames.fixture.js.

// XML-escaped in the body, because that is what the parser has to undo: S3 escapes a key's
// `&`, `<`, `>`, `"` and `'` rather than rejecting it, and a Book title has never been the
// source of a key but nothing stops one becoming it.
const escapeXml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const contentsXml = ({ key, lastModified, size }) =>
  [
    '<Contents>',
    `<Key>${escapeXml(key)}</Key>`,
    `<LastModified>${lastModified}</LastModified>`,
    `<ETag>&quot;${'0'.repeat(32)}&quot;</ETag>`,
    `<Size>${size}</Size>`,
    '<StorageClass>STANDARD</StorageClass>',
    '</Contents>',
  ].join('');

// `objects` are `{ key, lastModified, size }`. Passing a `nextContinuationToken` also flips
// `<IsTruncated>`, because S3 never sends one without the other and a fixture that could
// would be testing a response the store cannot produce.
export function buildListObjectsXml({ objects = [], prefix = '', nextContinuationToken } = {}) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
    '<Name>text-reader</Name>',
    `<Prefix>${escapeXml(prefix)}</Prefix>`,
    `<KeyCount>${objects.length}</KeyCount>`,
    '<MaxKeys>1000</MaxKeys>',
    `<IsTruncated>${nextContinuationToken ? 'true' : 'false'}</IsTruncated>`,
    nextContinuationToken
      ? `<NextContinuationToken>${escapeXml(nextContinuationToken)}</NextContinuationToken>`
      : '',
    ...objects.map(contentsXml),
    '</ListBucketResult>',
  ].join('');
}
