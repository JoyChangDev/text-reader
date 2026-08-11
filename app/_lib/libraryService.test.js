import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  addBook,
  BOOK_INCOMPLETE,
  deleteBook,
  getBook,
  listBooks,
  updateResumeIndex,
} from './libraryService';

describe('libraryService', () => {
  let storageClient;
  let positionClient;
  let chunkIndexClient;
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
      // Pathnames are literal here (already suffixed), unlike get/putJson's cache keys -
      // the real client's own convention. addBook's rollback needs this, not just
      // deleteBook's cascade, so it lives on the shared fake.
      del: async (pathname) => {
        blobs.delete(pathname.replace(/\.json$/, ''));
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
    // The Chunk index is a third store deleteBook has to reach. It arrived after the
    // cascade was written and was left out of it for a year of tickets - see ticket 13.
    chunkIndexClient = { removeBook: vi.fn(async () => {}) };
    clients = { storageClient, positionClient, chunkIndexClient };
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

    // The index is the commit point: it is what the Library lists and what getBook proves a
    // Book by, so writing it before the text it advertises is what made a failed second
    // write readable as an empty Book (see ticket 06).
    test('stores the chunks before it advertises the Book in the index', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);

      expect(putSpy.mock.calls.map(([key]) => key)).toEqual([
        'library/book-1/chunks',
        'library/index',
      ]);
    });

    test('leaves no index entry when the chunks could not be stored', async () => {
      putSpy.mockImplementation(async (key, data) => {
        if (key === 'library/book-1/chunks') throw new Error('object storage write failed');
        blobs.set(key, data);
      });

      await expect(
        addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients),
      ).rejects.toThrow('object storage write failed');
      expect(await listBooks(clients)).toEqual([]);
      expect(await getBook('book-1', clients)).toBeNull();
    });

    // The mirror-image leak the ordering above creates. blobCleanupService excludes the
    // library/ prefix, so nothing else would ever collect this object.
    test('takes the chunks back out of the store when the index write fails', async () => {
      // Everything but the index still lands in `blobs`, so the chunks blob is genuinely
      // written and genuinely has to be removed again - a fake that swallowed the write
      // would let this pass whether or not the rollback ran.
      putSpy.mockImplementation(async (key, data) => {
        if (key === 'library/index') throw new Error('object storage write failed');
        blobs.set(key, data);
      });

      await expect(
        addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients),
      ).rejects.toThrow('object storage write failed');
      expect(blobs.has('library/book-1/chunks')).toBe(false);
      // The whole point of the ordering: a second write that fails leaves a Book that does
      // not exist, rather than one that exists and cannot be read.
      expect(await getBook('book-1', clients)).toBeNull();
    });

    // Failing to undo the write is not a reason to report the Book as added: the index is
    // still what says whether it exists, and it does not.
    test('still fails when the chunks it wrote cannot be taken back out', async () => {
      putSpy.mockImplementation(async (key) => {
        if (key === 'library/index') throw new Error('object storage write failed');
      });
      storageClient.del = async () => {
        throw new Error('object storage delete failed');
      };

      await expect(
        addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients),
      ).rejects.toThrow('object storage write failed');
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

    // An index entry exists precisely because the chunks were supposed to have been
    // written, so their absence is corruption rather than a Book that simply has none -
    // and `?? []` used to render it as a reader with no text (see ticket 06).
    // Walked from addBook rather than hand-seeded, because that is the state observed on
    // 2026-08-10: an index entry with a real title and a real totalChunks, and no chunks
    // blob behind it. Reachable now only for Books added before the ordering was fixed.
    test('refuses to report a Book whose chunks blob is missing as an empty one', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。', '二。'] }, clients);
      blobs.delete('library/book-1/chunks');

      await expect(getBook('book-1', clients)).rejects.toMatchObject({ code: BOOK_INCOMPLETE });
    });

    // The distinction the criterion is about: zero chunks is a value, absence is not.
    test('still returns a Book that genuinely has no chunks', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: [] }, clients);

      expect(await getBook('book-1', clients)).toMatchObject({ chunks: [] });
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

    // The third store. Measured on the live service before this landed: deleting a
    // 42-Chunk Book left both its hashes behind with 42 fields each, unreachable by
    // anything the app runs, because the cascade predates the index (ticket 13).
    test("clears the Book's Chunk index", async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);

      await deleteBook('book-1', clients);

      expect(chunkIndexClient.removeBook).toHaveBeenCalledWith({ bookId: 'book-1' });
    });

    test('leaves another Book’s Chunk index alone', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);
      await addBook({ bookId: 'book-2', title: 'Second Book', chunks: ['二。'] }, clients);

      await deleteBook('book-1', clients);

      expect(chunkIndexClient.removeBook).toHaveBeenCalledTimes(1);
      expect(chunkIndexClient.removeBook).not.toHaveBeenCalledWith({ bookId: 'book-2' });
    });

    test('does not touch the Chunk index for a Book that was not in the index', async () => {
      await deleteBook('missing', clients);

      expect(chunkIndexClient.removeBook).not.toHaveBeenCalled();
    });

    test('returns the deleted bookId', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, clients);

      expect(await deleteBook('book-1', clients)).toEqual({ bookId: 'book-1' });
    });
  });
});
