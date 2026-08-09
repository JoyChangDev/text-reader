import { describe, expect, test } from 'vitest';

import { parseListObjectsXml } from './listObjectsXml';
import { buildListObjectsXml } from './listObjectsXml.fixture';

const audio = {
  key: 'book-1/0/zh-TW-default.mp3',
  lastModified: '2026-08-01T10:00:00.000Z',
  size: 40960,
};
const metadata = {
  key: 'book-1/0/zh-TW-default.json',
  lastModified: '2026-08-01T10:00:01.000Z',
  size: 512,
};

describe('parseListObjectsXml', () => {
  test('returns one record per key, in the order the response listed them', () => {
    const { objects } = parseListObjectsXml(buildListObjectsXml({ objects: [audio, metadata] }));

    expect(objects).toEqual([
      {
        pathname: 'book-1/0/zh-TW-default.mp3',
        size: 40960,
        uploadedAt: '2026-08-01T10:00:00.000Z',
      },
      {
        pathname: 'book-1/0/zh-TW-default.json',
        size: 512,
        uploadedAt: '2026-08-01T10:00:01.000Z',
      },
    ]);
  });

  // planCleanup sums sizes and compares uploadedAt against a cutoff, so a size that arrives
  // as "40960" would concatenate rather than add, and a Date built from a number is an epoch
  // offset rather than a timestamp.
  test('gives size as a number and uploadedAt as something Date can read', () => {
    const [object] = parseListObjectsXml(buildListObjectsXml({ objects: [audio] })).objects;

    expect(object.size).toBe(40960);
    expect(new Date(object.uploadedAt).getTime()).toBe(Date.parse('2026-08-01T10:00:00.000Z'));
  });

  test('returns no records for a listing with no keys, rather than failing on the absence', () => {
    expect(parseListObjectsXml(buildListObjectsXml({ objects: [] }))).toEqual({
      objects: [],
      nextContinuationToken: undefined,
      isListing: true,
      isTruncated: false,
    });
  });

  // S3 escapes rather than rejects a key containing XML's own characters. Left undone, the
  // pathname read back would not be the one the object is stored under, so deleteBook's
  // cascade would 404 on it and leave the audio behind.
  test('unescapes the XML entities S3 puts in a key', () => {
    const escaped = { ...audio, key: 'book-1/Tom & Jerry <2> "the\' sequel"/0.mp3' };

    const [object] = parseListObjectsXml(buildListObjectsXml({ objects: [escaped] })).objects;

    expect(object.pathname).toBe('book-1/Tom & Jerry <2> "the\' sequel"/0.mp3');
  });

  test('reports the continuation token when the listing was truncated', () => {
    const body = buildListObjectsXml({ objects: [audio], nextContinuationToken: '1ueGcx…' });

    expect(parseListObjectsXml(body)).toMatchObject({
      nextContinuationToken: '1ueGcx…',
      isTruncated: true,
    });
  });

  test('unescapes a continuation token, which S3 escapes exactly as it escapes a key', () => {
    const body = buildListObjectsXml({ objects: [audio], nextContinuationToken: 'a&b<c' });

    expect(parseListObjectsXml(body).nextContinuationToken).toBe('a&b<c');
  });

  // The two disagreeing is the case the caller has to refuse: a response that says it was
  // cut short but offers no way to ask for the rest. Reported rather than thrown on, because
  // parsing here stays lenient and what to do about a short answer differs by caller.
  test('reports a truncation with no token as truncated, rather than as a complete page', () => {
    const body = buildListObjectsXml({
      objects: [audio],
      nextContinuationToken: 'token-2',
    }).replace('<NextContinuationToken>token-2</NextContinuationToken>', '');

    expect(parseListObjectsXml(body)).toMatchObject({
      nextContinuationToken: undefined,
      isTruncated: true,
    });
  });

  // Every real ListObjectsV2 response carries <IsTruncated>, including one with no keys at
  // all, so its absence is what tells a body that is not a listing from a bucket that is
  // empty. Both parse to zero records; only one of them means the store is empty.
  test('says a body is not a listing when it carries no IsTruncated at all', () => {
    expect(parseListObjectsXml(buildListObjectsXml({ objects: [] })).isListing).toBe(true);
    expect(parseListObjectsXml('<html><body>502 Bad Gateway</body></html>').isListing).toBe(false);
    expect(parseListObjectsXml('').isListing).toBe(false);
  });

  // Same treatment mp3Frames.js gives a truncated file: keep what was measurable and stop.
  // The alternative is that one short response makes getUsage and the cleanup cron throw,
  // when the keys that did arrive are perfectly usable.
  test('keeps the records it could read out of a truncated body rather than throwing', () => {
    const complete = buildListObjectsXml({ objects: [audio, metadata] });
    const cut = complete.slice(0, complete.indexOf('<Size>512</Size>'));

    const { objects } = parseListObjectsXml(cut);

    expect(objects).toEqual([
      {
        pathname: 'book-1/0/zh-TW-default.mp3',
        size: 40960,
        uploadedAt: '2026-08-01T10:00:00.000Z',
      },
    ]);
  });

  test('returns no records for a body that is not a listing at all, rather than throwing', () => {
    expect(parseListObjectsXml('<html><body>502 Bad Gateway</body></html>').objects).toEqual([]);
    expect(parseListObjectsXml('').objects).toEqual([]);
    expect(parseListObjectsXml(undefined).objects).toEqual([]);
  });

  // A record with no key names no object, so nothing can be done with it; one with an
  // unreadable size is still deletable, and dropping it would orphan the object forever.
  test('drops a record with no key but keeps one whose size is unreadable', () => {
    const body = buildListObjectsXml({ objects: [audio, metadata] })
      .replace('<Key>book-1/0/zh-TW-default.mp3</Key>', '')
      .replace('<Size>512</Size>', '<Size>not-a-number</Size>');

    const { objects } = parseListObjectsXml(body);

    expect(objects).toEqual([
      { pathname: 'book-1/0/zh-TW-default.json', size: 0, uploadedAt: '2026-08-01T10:00:01.000Z' },
    ]);
  });
});
