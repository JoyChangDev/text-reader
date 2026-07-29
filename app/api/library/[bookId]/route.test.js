import { describe, expect, test, vi } from 'vitest';

import { getBook, updateResumeIndex } from '@/app/_lib/libraryService';

vi.mock('@/app/_lib/libraryService', () => ({
  getBook: vi.fn(),
  updateResumeIndex: vi.fn(),
}));

const { GET, PATCH } = await import('./route');

function jsonRequest(body) {
  return { json: () => Promise.resolve(body) };
}

function paramsFor(bookId) {
  return { params: Promise.resolve({ bookId }) };
}

describe('GET /api/library/[bookId]', () => {
  test('returns 404 when the book does not exist', async () => {
    getBook.mockResolvedValueOnce(null);

    const response = await GET(jsonRequest({}), paramsFor('missing'));

    expect(response.status).toBe(404);
    expect(getBook).toHaveBeenCalledWith('missing');
  });

  test('returns the book, including its chunks, for a known id', async () => {
    const book = {
      bookId: 'book-1',
      title: 'First Book',
      resumeIndex: 2,
      chunks: ['一。', '二。'],
    };
    getBook.mockResolvedValueOnce(book);

    const response = await GET(jsonRequest({}), paramsFor('book-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(book);
  });

  test('returns a 502 when fetching the book fails', async () => {
    getBook.mockRejectedValueOnce(new Error('blob get failed'));

    const response = await GET(jsonRequest({}), paramsFor('book-1'));

    expect(response.status).toBe(502);
  });
});

describe('PATCH /api/library/[bookId]', () => {
  test('rejects a request missing resumeIndex with 400', async () => {
    const response = await PATCH(jsonRequest({}), paramsFor('book-1'));

    expect(response.status).toBe(400);
    expect(updateResumeIndex).not.toHaveBeenCalled();
  });

  test('returns 404 when the book does not exist', async () => {
    updateResumeIndex.mockResolvedValueOnce(null);

    const response = await PATCH(jsonRequest({ resumeIndex: 3 }), paramsFor('missing'));

    expect(response.status).toBe(404);
    expect(updateResumeIndex).toHaveBeenCalledWith('missing', 3);
  });

  test('updates the resume index and returns the updated summary', async () => {
    const summary = { bookId: 'book-1', title: 'First Book', resumeIndex: 3 };
    updateResumeIndex.mockResolvedValueOnce(summary);

    const response = await PATCH(jsonRequest({ resumeIndex: 3 }), paramsFor('book-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(summary);
    expect(updateResumeIndex).toHaveBeenCalledWith('book-1', 3);
  });

  test('returns a 502 when updating the resume position fails', async () => {
    updateResumeIndex.mockRejectedValueOnce(new Error('blob put failed'));

    const response = await PATCH(jsonRequest({ resumeIndex: 3 }), paramsFor('book-1'));

    expect(response.status).toBe(502);
  });
});
