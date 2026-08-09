import { beforeEach, describe, expect, test, vi } from 'vitest';

import { addBook, deleteBook, getBook, listBooks, updateResumeIndex } from './bookLibrary';

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
  });
});
