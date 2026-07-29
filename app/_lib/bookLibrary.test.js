import { beforeEach, describe, expect, test, vi } from 'vitest';

import { addBook, getBook, listBooks, updateResumeIndex } from './bookLibrary';

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
    test('PATCHes /api/library/[bookId] with the new resume index', async () => {
      const summary = { bookId: 'book-1', title: 'First Book', resumeIndex: 5 };
      global.fetch.mockResolvedValue(new Response(JSON.stringify(summary), { status: 200 }));

      const result = await updateResumeIndex('book-1', 5);

      expect(result).toEqual(summary);
      expect(global.fetch).toHaveBeenCalledWith('/api/library/book-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeIndex: 5 }),
      });
    });
  });
});
