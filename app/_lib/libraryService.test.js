import { beforeEach, describe, expect, test, vi } from 'vitest';

import { addBook, deleteBook, getBook, listBooks, updateResumeIndex } from './libraryService';

describe('libraryService', () => {
  let storageClient;
  let positionClient;
  let clients;
  let blobs;
  let positions;
  let putSpy;

  beforeEach(() => {
    blobs = new Map();
    positions = new Map();
    storageClient = {
      get: async (key) => blobs.get(key),
      putJson: async (key, data) => {
        blobs.set(key, data);
      },
    };
    // Mirrors redisReadingPosition's newer-wins contract, because libraryService's own
    // behaviour depends on it - a fake that always accepted the write would hide the case
    // where a stale flush must not reach the snapshot.
    positionClient = {
      read: async (bookId) => positions.get(bookId),
      readAll: async () => Object.fromEntries(positions),
      write: async (bookId, position) => {
        const stored = positions.get(bookId);
        if (stored && stored.updatedAt >= position.updatedAt) return false;
        positions.set(bookId, position);
        return true;
      },
      remove: async (bookId) => {
        positions.delete(bookId);
      },
    };
    clients = { storageClient, positionClient };
    putSpy = vi.spyOn(storageClient, 'putJson');
  });

  describe('listBooks', () => {
    test('returns an empty array when the index blob does not exist yet', async () => {
      expect(await listBooks(clients)).toEqual([]);
    });

    test('returns every summary from the index blob, with its stored position', async () => {
      blobs.set('library/index', [
        { bookId: 'book-1', title: 'First Book' },
        { bookId: 'book-2', title: 'Second Book' },
      ]);
      positions.set('book-2', { resumeIndex: 3, resumeSentenceIndex: 1, updatedAt: 10 });

      expect(await listBooks(clients)).toEqual([
        { bookId: 'book-1', title: 'First Book', resumeIndex: 0, resumeSentenceIndex: 0 },
        { bookId: 'book-2', title: 'Second Book', resumeIndex: 3, resumeSentenceIndex: 1 },
      ]);
    });

    // Books read before ticket 10 have their position on the index summary and nowhere
    // else. Ignoring it would silently reset every existing Book to the start.
    test('falls back to a position stored on the summary before it was split out', async () => {
      blobs.set('library/index', [
        { bookId: 'book-1', title: 'First Book', resumeIndex: 7, resumeSentenceIndex: 2 },
      ]);

      expect(await listBooks(clients)).toEqual([
        { bookId: 'book-1', title: 'First Book', resumeIndex: 7, resumeSentenceIndex: 2 },
      ]);
    });

    test('prefers the live position over the one left on the summary', async () => {
      blobs.set('library/index', [
        { bookId: 'book-1', title: 'First Book', resumeIndex: 7, resumeSentenceIndex: 2 },
      ]);
      positions.set('book-1', { resumeIndex: 9, resumeSentenceIndex: 0, updatedAt: 10 });

      expect(await listBooks(clients)).toMatchObject([{ resumeIndex: 9, resumeSentenceIndex: 0 }]);
    });

    // One call for all of them. Reading a blob per Book is the bug shape tickets 08-10
    // are all about, and the Library list is the place it would reappear.
    test('reads no per-Book blob, even when Redis answers for none of them', async () => {
      blobs.set('library/index', [
        { bookId: 'book-1', title: 'First Book' },
        { bookId: 'book-2', title: 'Second Book' },
      ]);
      const getSpy = vi.spyOn(storageClient, 'get');

      await listBooks(clients);

      expect(getSpy.mock.calls.map(([key]) => key)).toEqual(['library/index']);
    });

    test('still lists Books when Redis cannot answer at all', async () => {
      blobs.set('library/index', [
        { bookId: 'book-1', title: 'First Book', resumeIndex: 4, resumeSentenceIndex: 1 },
      ]);
      positionClient.readAll = async () => undefined;

      expect(await listBooks(clients)).toMatchObject([{ resumeIndex: 4, resumeSentenceIndex: 1 }]);
    });

    // A Book added after ticket 10 has no position on its summary at all, so during a
    // Redis outage the snapshot is the only thing left that knows where the Listener is.
    // Without this its progress bar would read 0% for the whole outage.
    test('reads the snapshots when Redis cannot answer, so new Books keep their progress', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);
      blobs.set('library/book-1/resume', {
        resumeIndex: 6,
        resumeSentenceIndex: 3,
        updatedAt: 10,
      });
      positionClient.readAll = async () => undefined;

      expect(await listBooks(clients)).toMatchObject([{ resumeIndex: 6, resumeSentenceIndex: 3 }]);
    });
  });

  describe('addBook', () => {
    test('appends a summary to the index and stores chunks under their own blob', async () => {
      const summary = await addBook(
        { bookId: 'book-1', title: 'First Book', chunks: ['一。二。', '三。'] },
        clients,
      );

      expect(summary).toEqual({
        bookId: 'book-1',
        title: 'First Book',
        resumeIndex: 0,
        resumeSentenceIndex: 0,
        totalChunks: 2,
        sentenceCountsByChunk: [2, 1],
      });
      expect(blobs.get('library/book-1/chunks')).toEqual(['一。二。', '三。']);
    });

    // The index is what addBook and deleteBook rewrite wholesale. Keeping a per-Sentence
    // counter out of it is the whole point of ticket 10, so a zero must not go back in.
    test('writes no resume position into the index', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);

      expect(blobs.get('library/index')).toEqual([
        {
          bookId: 'book-1',
          title: 'First Book',
          totalChunks: 1,
          sentenceCountsByChunk: [1],
        },
      ]);
    });

    test('does not replace an existing index entry when adding another book', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);
      await addBook({ bookId: 'book-2', title: 'Second Book', chunks: ['二。'] }, clients);

      expect(blobs.get('library/index').map(({ bookId }) => bookId)).toEqual(['book-1', 'book-2']);
    });

    // bookId is a freshly generated uuid, so looking its position up could only ever miss.
    test('does not look up a position for a Book that cannot have one yet', async () => {
      const readSpy = vi.spyOn(positionClient, 'read');

      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);

      expect(readSpy).not.toHaveBeenCalled();
    });
  });

  describe('getBook', () => {
    test('returns null for an unknown id', async () => {
      expect(await getBook('missing', clients)).toBeNull();
    });

    test('returns the summary merged with its chunks and position', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。', '二。'] }, clients);
      positions.set('book-1', { resumeIndex: 1, resumeSentenceIndex: 0, updatedAt: 10 });

      expect(await getBook('book-1', clients)).toEqual({
        bookId: 'book-1',
        title: 'First Book',
        resumeIndex: 1,
        resumeSentenceIndex: 0,
        totalChunks: 2,
        sentenceCountsByChunk: [1, 1],
        chunks: ['一。', '二。'],
      });
    });

    // This is the read that decides where playback resumes, so unlike listBooks it pays
    // for the snapshot rather than restarting a Book the Listener was halfway through.
    test('falls back to the durable snapshot when Redis has no position', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);
      blobs.set('library/book-1/resume', {
        resumeIndex: 6,
        resumeSentenceIndex: 3,
        updatedAt: 10,
      });

      expect(await getBook('book-1', clients)).toMatchObject({
        resumeIndex: 6,
        resumeSentenceIndex: 3,
      });
    });

    test('resumes at the start when nothing has ever been stored', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);

      expect(await getBook('book-1', clients)).toMatchObject({
        resumeIndex: 0,
        resumeSentenceIndex: 0,
      });
    });

    test('keeps a Listener in place when Redis is unavailable', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);
      blobs.set('library/book-1/resume', {
        resumeIndex: 6,
        resumeSentenceIndex: 3,
        updatedAt: 10,
      });
      positionClient.read = async () => undefined;

      expect(await getBook('book-1', clients)).toMatchObject({ resumeIndex: 6 });
    });
  });

  describe('updateResumeIndex', () => {
    const at = (updatedAt) => ({ resumeIndex: 5, resumeSentenceIndex: 2, updatedAt });

    // The headline criterion: a save during playback must cost no Blob operation at all.
    test('writes nothing to Blob for an ordinary per-Sentence save', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);
      putSpy.mockClear();

      await updateResumeIndex('book-1', at(10), clients);

      expect(putSpy).not.toHaveBeenCalled();
      expect(positions.get('book-1')).toMatchObject({ resumeIndex: 5, resumeSentenceIndex: 2 });
    });

    test('writes the durable snapshot only when the caller asks for one', async () => {
      await updateResumeIndex('book-1', { ...at(10), snapshot: true }, clients);

      expect(blobs.get('library/book-1/resume')).toEqual({
        resumeIndex: 5,
        resumeSentenceIndex: 2,
        updatedAt: 10,
      });
    });

    // The index is never read or written here, which is what makes a save unable to lose
    // a concurrent addBook - there is no shared document left to race over.
    test('never touches the Library index', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);
      const getSpy = vi.spyOn(storageClient, 'get');
      putSpy.mockClear();

      await updateResumeIndex('book-1', { ...at(10), snapshot: true }, clients);

      expect(getSpy).not.toHaveBeenCalled();
      expect(putSpy.mock.calls.map(([key]) => key)).toEqual(['library/book-1/resume']);
    });

    test('a save and a concurrent addBook cannot lose each other', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);

      await Promise.all([
        updateResumeIndex('book-1', { ...at(10), snapshot: true }, clients),
        addBook({ bookId: 'book-2', title: 'Second Book', chunks: ['二。'] }, clients),
      ]);

      expect(blobs.get('library/index').map(({ bookId }) => bookId)).toEqual(['book-1', 'book-2']);
      expect(await getBook('book-1', clients)).toMatchObject({ resumeIndex: 5 });
    });

    // The offline case ticket 10 exists for: a device that was offline flushes an
    // hour-old position and must not win just because it arrived second.
    test('an older save does not overwrite a newer one', async () => {
      await updateResumeIndex(
        'book-1',
        { resumeIndex: 9, resumeSentenceIndex: 0, updatedAt: 20 },
        clients,
      );
      await updateResumeIndex(
        'book-1',
        { resumeIndex: 2, resumeSentenceIndex: 0, updatedAt: 10 },
        clients,
      );

      expect(positions.get('book-1')).toMatchObject({ resumeIndex: 9 });
    });

    test('a rejected save does not reach the snapshot either', async () => {
      await updateResumeIndex('book-1', { ...at(20), snapshot: true }, clients);
      await updateResumeIndex(
        'book-1',
        { resumeIndex: 2, resumeSentenceIndex: 0, updatedAt: 10, snapshot: true },
        clients,
      );

      expect(blobs.get('library/book-1/resume')).toMatchObject({ resumeIndex: 5 });
    });

    // A deliberate jump backwards is a newer reading event, so it has to win. This is why
    // the rule is "newer updatedAt", never "higher Sentence ordinal".
    test('a deliberate backward seek still persists', async () => {
      await updateResumeIndex(
        'book-1',
        { resumeIndex: 9, resumeSentenceIndex: 0, updatedAt: 10 },
        clients,
      );
      await updateResumeIndex(
        'book-1',
        { resumeIndex: 2, resumeSentenceIndex: 0, updatedAt: 20 },
        clients,
      );

      expect(positions.get('book-1')).toMatchObject({ resumeIndex: 2 });
    });

    // Redis being unreachable is exactly when the durable copy matters, so an unknown
    // outcome still snapshots - only a positive "something newer exists" skips it.
    test('still snapshots when Redis could not say whether the save won', async () => {
      positionClient.write = async () => undefined;

      await updateResumeIndex('book-1', { ...at(10), snapshot: true }, clients);

      expect(blobs.get('library/book-1/resume')).toMatchObject({ resumeIndex: 5 });
    });

    // With no verdict from Redis there is nothing rejecting stale saves, so the snapshot
    // has to compare for itself - otherwise a device that had been offline overwrites a
    // newer snapshot simply by flushing last, which is the failure ticket 10 exists for.
    test('compares against the stored snapshot when Redis gave no verdict', async () => {
      blobs.set('library/book-1/resume', {
        resumeIndex: 9,
        resumeSentenceIndex: 0,
        updatedAt: 20,
      });
      positionClient.write = async () => undefined;

      await updateResumeIndex(
        'book-1',
        { resumeIndex: 2, resumeSentenceIndex: 0, updatedAt: 10, snapshot: true },
        clients,
      );

      expect(blobs.get('library/book-1/resume')).toMatchObject({ resumeIndex: 9 });
    });

    // The comparison costs a read, so it is only paid when there was no verdict - a normal
    // save must not start reading the blob it is about to overwrite.
    test('does not read the snapshot when Redis already ruled on the save', async () => {
      const getSpy = vi.spyOn(storageClient, 'get');

      await updateResumeIndex('book-1', { ...at(10), snapshot: true }, clients);

      expect(getSpy).not.toHaveBeenCalled();
    });
  });

  describe('deleteBook', () => {
    let delSpy;

    beforeEach(() => {
      storageClient.del = async (pathname) => {
        blobs.delete(pathname);
      };
      storageClient.list = async () => [];
      delSpy = vi.spyOn(storageClient, 'del');
    });

    test('returns null and does not touch storage for an unknown id', async () => {
      const result = await deleteBook('missing', clients);

      expect(result).toBeNull();
      expect(delSpy).not.toHaveBeenCalled();
    });

    test('removes only the targeted book from the index', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);
      await addBook({ bookId: 'book-2', title: 'Second Book', chunks: ['二。'] }, clients);

      await deleteBook('book-1', clients);

      expect((await listBooks(clients)).map(({ bookId }) => bookId)).toEqual(['book-2']);
    });

    test('deletes the chunks blob', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);

      await deleteBook('book-1', clients);

      expect(delSpy).toHaveBeenCalledWith('library/book-1/chunks.json');
    });

    // Both halves of the position, or a re-uploaded Book reusing the id would inherit a
    // stranger's place in it.
    test('drops the stored position and its snapshot', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);
      positions.set('book-1', { resumeIndex: 4, resumeSentenceIndex: 0, updatedAt: 10 });

      await deleteBook('book-1', clients);

      expect(positions.has('book-1')).toBe(false);
      expect(delSpy).toHaveBeenCalledWith('library/book-1/resume.json');
    });

    test('deletes every audio/metadata blob under the book prefix', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);
      storageClient.list = async (prefix) =>
        prefix === 'book-1/'
          ? [
              { pathname: 'book-1/0/voice-a.mp3', size: 100, uploadedAt: new Date() },
              { pathname: 'book-1/0/voice-a.json', size: 10, uploadedAt: new Date() },
            ]
          : [];
      const listSpy = vi.spyOn(storageClient, 'list');

      await deleteBook('book-1', clients);

      expect(listSpy).toHaveBeenCalledWith('book-1/');
      expect(delSpy).toHaveBeenCalledWith('book-1/0/voice-a.mp3');
      expect(delSpy).toHaveBeenCalledWith('book-1/0/voice-a.json');
    });

    test('returns the deleted bookId', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);

      expect(await deleteBook('book-1', clients)).toEqual({ bookId: 'book-1' });
    });
  });
});
