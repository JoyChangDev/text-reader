import { beforeEach, describe, expect, test, vi } from 'vitest';

import { addBook, deleteBook, getBook, listBooks, updateResumeIndex } from './libraryService';

describe('libraryService', () => {
  let storageClient;
  let blobs;

  beforeEach(() => {
    blobs = new Map();
    storageClient = {
      get: async (key) => blobs.get(key),
      putJson: async (key, data) => {
        blobs.set(key, data);
      },
    };
  });

  describe('listBooks', () => {
    test('returns an empty array when the index blob does not exist yet', async () => {
      expect(await listBooks({ storageClient })).toEqual([]);
    });

    test('returns every summary from the index blob', async () => {
      blobs.set('library/index', [
        { bookId: 'book-1', title: 'First Book', resumeIndex: 0 },
        { bookId: 'book-2', title: 'Second Book', resumeIndex: 3 },
      ]);

      expect(await listBooks({ storageClient })).toEqual([
        { bookId: 'book-1', title: 'First Book', resumeIndex: 0 },
        { bookId: 'book-2', title: 'Second Book', resumeIndex: 3 },
      ]);
    });
  });

  describe('addBook', () => {
    test('appends a summary to the index and stores chunks under their own blob', async () => {
      const summary = await addBook(
        { bookId: 'book-1', title: 'First Book', chunks: ['一。', '二。'] },
        { storageClient },
      );

      expect(summary).toEqual({ bookId: 'book-1', title: 'First Book', resumeIndex: 0 });
      expect(blobs.get('library/index')).toEqual([
        { bookId: 'book-1', title: 'First Book', resumeIndex: 0 },
      ]);
      expect(blobs.get('library/book-1/chunks')).toEqual(['一。', '二。']);
    });

    test('does not replace an existing index entry when adding another book', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, { storageClient });
      await addBook(
        { bookId: 'book-2', title: 'Second Book', chunks: ['二。'] },
        { storageClient },
      );

      expect(blobs.get('library/index')).toEqual([
        { bookId: 'book-1', title: 'First Book', resumeIndex: 0 },
        { bookId: 'book-2', title: 'Second Book', resumeIndex: 0 },
      ]);
    });
  });

  describe('getBook', () => {
    test('returns null for an unknown id', async () => {
      expect(await getBook('missing', { storageClient })).toBeNull();
    });

    test('returns the summary merged with its chunks for a known id', async () => {
      await addBook(
        { bookId: 'book-1', title: 'First Book', chunks: ['一。', '二。'] },
        { storageClient },
      );

      expect(await getBook('book-1', { storageClient })).toEqual({
        bookId: 'book-1',
        title: 'First Book',
        resumeIndex: 0,
        chunks: ['一。', '二。'],
      });
    });
  });

  describe('updateResumeIndex', () => {
    test('updates only the targeted book, leaving others untouched', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, { storageClient });
      await addBook(
        { bookId: 'book-2', title: 'Second Book', chunks: ['二。'] },
        { storageClient },
      );

      await updateResumeIndex('book-2', 3, { storageClient });

      expect(await getBook('book-1', { storageClient })).toMatchObject({ resumeIndex: 0 });
      expect(await getBook('book-2', { storageClient })).toMatchObject({ resumeIndex: 3 });
    });

    test('returns null and leaves the index untouched for an unknown id', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, { storageClient });

      const result = await updateResumeIndex('missing', 5, { storageClient });

      expect(result).toBeNull();
      expect(await getBook('book-1', { storageClient })).toMatchObject({ resumeIndex: 0 });
    });

    test('persists across separate calls, as if surviving a page reload', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, { storageClient });
      await updateResumeIndex('book-1', 5, { storageClient });

      expect(await listBooks({ storageClient })).toEqual([
        { bookId: 'book-1', title: 'First Book', resumeIndex: 5 },
      ]);
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
      const result = await deleteBook('missing', { storageClient });

      expect(result).toBeNull();
      expect(delSpy).not.toHaveBeenCalled();
    });

    test('removes only the targeted book from the index', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, { storageClient });
      await addBook(
        { bookId: 'book-2', title: 'Second Book', chunks: ['二。'] },
        { storageClient },
      );

      await deleteBook('book-1', { storageClient });

      expect(await listBooks({ storageClient })).toEqual([
        { bookId: 'book-2', title: 'Second Book', resumeIndex: 0 },
      ]);
    });

    test('deletes the chunks blob', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, { storageClient });

      await deleteBook('book-1', { storageClient });

      expect(delSpy).toHaveBeenCalledWith('library/book-1/chunks.json');
    });

    test('deletes every audio/metadata blob under the book prefix', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, { storageClient });
      storageClient.list = async (prefix) =>
        prefix === 'book-1/'
          ? [
              { pathname: 'book-1/0/voice-a.mp3', size: 100, uploadedAt: new Date() },
              { pathname: 'book-1/0/voice-a.json', size: 10, uploadedAt: new Date() },
            ]
          : [];
      const listSpy = vi.spyOn(storageClient, 'list');

      await deleteBook('book-1', { storageClient });

      expect(listSpy).toHaveBeenCalledWith('book-1/');
      expect(delSpy).toHaveBeenCalledWith('book-1/0/voice-a.mp3');
      expect(delSpy).toHaveBeenCalledWith('book-1/0/voice-a.json');
    });

    test('returns the deleted bookId', async () => {
      await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }, { storageClient });

      expect(await deleteBook('book-1', { storageClient })).toEqual({ bookId: 'book-1' });
    });
  });
});
