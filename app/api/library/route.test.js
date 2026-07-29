import { describe, expect, test, vi } from 'vitest';

import { addBook, listBooks } from '@/app/_lib/libraryService';

vi.mock('@/app/_lib/libraryService', () => ({
  addBook: vi.fn(),
  listBooks: vi.fn(),
}));

const { GET, POST } = await import('./route');

function jsonRequest(body) {
  return { json: () => Promise.resolve(body) };
}

describe('GET /api/library', () => {
  test('returns the summaries from listBooks', async () => {
    const books = [{ bookId: 'book-1', title: 'First Book', resumeIndex: 0 }];
    listBooks.mockResolvedValueOnce(books);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ books });
  });

  test('returns a 502 when listing fails', async () => {
    listBooks.mockRejectedValueOnce(new Error('blob list failed'));

    const response = await GET();

    expect(response.status).toBe(502);
  });
});

describe('POST /api/library', () => {
  test('rejects a request missing bookId, title, or chunks with 400', async () => {
    const response = await POST(jsonRequest({ bookId: 'book-1', title: 'First Book' }));

    expect(response.status).toBe(400);
    expect(addBook).not.toHaveBeenCalled();
  });

  test('adds the book and returns its summary', async () => {
    const summary = { bookId: 'book-1', title: 'First Book', resumeIndex: 0 };
    addBook.mockResolvedValueOnce(summary);

    const response = await POST(
      jsonRequest({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual(summary);
    expect(addBook).toHaveBeenCalledWith({
      bookId: 'book-1',
      title: 'First Book',
      chunks: ['一。'],
    });
  });

  test('returns a 502 when adding the book fails', async () => {
    addBook.mockRejectedValueOnce(new Error('blob put failed'));

    const response = await POST(
      jsonRequest({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] }),
    );

    expect(response.status).toBe(502);
  });
});
