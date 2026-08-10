import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  addBook,
  deleteBook,
  getBook,
  INCOMPLETE_BOOK_STATUS,
  listBooks,
  updateResumeIndex,
} from './bookLibrary';

describe('bookLibrary', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  describe('addBook', () => {
    test('POSTs the new book to /api/library and returns its summary', async () => {
      const summary = { bookId: 'book-1', title: 'First Book', resumeIndex: 0 };
      global.fetch.mockResolvedValue(new Response(JSON.stringify(summary), { status: 201 }));

      const result = await addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] });

      expect(result).toEqual(summary);
      expect(global.fetch).toHaveBeenCalledWith('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }),
      });
    });

    // The route answers a failure with `{ error: ... }`, which is valid JSON, so parsing it
    // without looking at the status handed the caller an object that simply was not a Book
    // - and the upload reported success and navigated into it (see ticket 06).
    test('rejects rather than returning the error body as if it were a book', async () => {
      global.fetch.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Adding the book to the library failed' }), {
          status: 502,
        }),
      );

      await expect(
        addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }),
      ).rejects.toThrow();
    });
  });

  describe('listBooks', () => {
    test('GETs /api/library and returns the book summaries', async () => {
      const books = [
        { bookId: 'book-1', title: 'First Book', resumeIndex: 0 },
        { bookId: 'book-2', title: 'Second Book', resumeIndex: 3 },
      ];
      global.fetch.mockResolvedValue(new Response(JSON.stringify({ books }), { status: 200 }));

      const result = await listBooks();

      expect(result).toEqual(books);
      expect(global.fetch).toHaveBeenCalledWith('/api/library');
    });

    // It destructures `books` off the parsed body, so a failure used to come back as
    // `undefined` - not a list, not an error, just nothing.
    test('rejects rather than resolving undefined when listing fails', async () => {
      global.fetch.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Listing the library failed' }), { status: 502 }),
      );

      await expect(listBooks()).rejects.toThrow();
    });
  });

  describe('getBook', () => {
    test('GETs /api/library/[bookId] and returns the full entry, including its chunks', async () => {
      const book = {
        bookId: 'book-1',
        title: 'First Book',
        resumeIndex: 0,
        chunks: ['一。', '二。'],
      };
      global.fetch.mockResolvedValue(new Response(JSON.stringify(book), { status: 200 }));

      const result = await getBook('book-1');

      expect(result).toEqual(book);
      expect(global.fetch).toHaveBeenCalledWith('/api/library/book-1');
    });

    test('returns null when the book is not found', async () => {
      global.fetch.mockResolvedValue(
        new Response(JSON.stringify({ error: 'not found' }), {
          status: 404,
        }),
      );

      expect(await getBook('missing')).toBeNull();
    });

    // 404 is the one status that is an answer rather than a failure - "there is no such
    // Book" is information the reader route acts on. Everything else has to reach the
    // caller as a failure, carrying the status that says which one.
    test('rejects with the status when the book cannot be fetched', async () => {
      global.fetch.mockResolvedValue(
        new Response(JSON.stringify({ error: 'book is incomplete' }), { status: 409 }),
      );

      await expect(getBook('book-1')).rejects.toMatchObject({ status: INCOMPLETE_BOOK_STATUS });
    });
  });

  describe('updateResumeIndex', () => {
    test('PATCHes /api/library/[bookId] with the position, its updatedAt and the snapshot flag', async () => {
      const position = { resumeIndex: 5, resumeSentenceIndex: 2, updatedAt: 1_000 };
      global.fetch.mockResolvedValue(new Response(JSON.stringify(position), { status: 200 }));

      const result = await updateResumeIndex('book-1', { ...position, snapshot: true });

      expect(result).toEqual(position);
      expect(global.fetch).toHaveBeenCalledWith('/api/library/book-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...position, snapshot: true }),
      });
    });

    // Ordinary per-Sentence saves go to Redis alone; only the flush points ask for the
    // durable copy, and that is what keeps the Blob cost bounded (see ticket 10).
    test('does not ask for a snapshot unless the caller says so', async () => {
      global.fetch.mockResolvedValue(new Response('{}', { status: 200 }));

      await updateResumeIndex('book-1', {
        resumeIndex: 5,
        resumeSentenceIndex: 2,
        updatedAt: 1_000,
      });

      const [, { body }] = global.fetch.mock.calls[0];
      expect(JSON.parse(body).snapshot).toBe(false);
    });

    test('rejects when the position could not be saved', async () => {
      global.fetch.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Updating the resume position failed' }), {
          status: 502,
        }),
      );

      await expect(
        updateResumeIndex('book-1', { resumeIndex: 5, resumeSentenceIndex: 2, updatedAt: 1_000 }),
      ).rejects.toThrow();
    });
  });

  describe('deleteBook', () => {
    test('DELETEs /api/library/[bookId] and returns the result', async () => {
      global.fetch.mockResolvedValue(
        new Response(JSON.stringify({ bookId: 'book-1' }), { status: 200 }),
      );

      const result = await deleteBook('book-1');

      expect(result).toEqual({ bookId: 'book-1' });
      expect(global.fetch).toHaveBeenCalledWith('/api/library/book-1', { method: 'DELETE' });
    });

    test('returns null when the book is not found', async () => {
      global.fetch.mockResolvedValue(
        new Response(JSON.stringify({ error: 'not found' }), { status: 404 }),
      );

      expect(await deleteBook('missing')).toBeNull();
    });

    test('rejects when the delete fails for any other reason', async () => {
      global.fetch.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Deleting the book failed' }), { status: 502 }),
      );

      await expect(deleteBook('book-1')).rejects.toThrow();
    });
  });
});
