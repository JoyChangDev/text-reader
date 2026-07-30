import { describe, expect, test, vi } from 'vitest';

import { deleteBook, getBook, updateResumeIndex } from '@/app/_lib/libraryService';

vi.mock('@/app/_lib/libraryService', () => ({
  getBook: vi.fn(),
  updateResumeIndex: vi.fn(),
  deleteBook: vi.fn(),
}));

const { GET, PATCH, DELETE } = await import('./route');

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
    const response = await PATCH(jsonRequest({ resumeSentenceIndex: 0 }), paramsFor('book-1'));

    expect(response.status).toBe(400);
    expect(updateResumeIndex).not.toHaveBeenCalled();
  });

  // resumeIndex/resumeSentenceIndex are always saved together, as one atomic pair - a
  // request missing either half is rejected rather than silently clobbering the other
  // half of a previously-persisted position (see ticket 05).
  test('rejects a request missing resumeSentenceIndex with 400', async () => {
    const response = await PATCH(jsonRequest({ resumeIndex: 3 }), paramsFor('book-1'));

    expect(response.status).toBe(400);
    expect(updateResumeIndex).not.toHaveBeenCalled();
  });

  test('returns 404 when the book does not exist', async () => {
    updateResumeIndex.mockResolvedValueOnce(null);

    const response = await PATCH(
      jsonRequest({ resumeIndex: 3, resumeSentenceIndex: 0 }),
      paramsFor('missing'),
    );

    expect(response.status).toBe(404);
    expect(updateResumeIndex).toHaveBeenCalledWith('missing', {
      resumeIndex: 3,
      resumeSentenceIndex: 0,
    });
  });

  test('updates the resume index and resume sentence index together, and returns the updated summary', async () => {
    const summary = {
      bookId: 'book-1',
      title: 'First Book',
      resumeIndex: 3,
      resumeSentenceIndex: 1,
    };
    updateResumeIndex.mockResolvedValueOnce(summary);

    const response = await PATCH(
      jsonRequest({ resumeIndex: 3, resumeSentenceIndex: 1 }),
      paramsFor('book-1'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(summary);
    expect(updateResumeIndex).toHaveBeenCalledWith('book-1', {
      resumeIndex: 3,
      resumeSentenceIndex: 1,
    });
  });

  test('returns a 502 when updating the resume position fails', async () => {
    updateResumeIndex.mockRejectedValueOnce(new Error('blob put failed'));

    const response = await PATCH(
      jsonRequest({ resumeIndex: 3, resumeSentenceIndex: 0 }),
      paramsFor('book-1'),
    );

    expect(response.status).toBe(502);
  });
});

describe('DELETE /api/library/[bookId]', () => {
  test('returns 404 when the book does not exist', async () => {
    deleteBook.mockResolvedValueOnce(null);

    const response = await DELETE(jsonRequest({}), paramsFor('missing'));

    expect(response.status).toBe(404);
    expect(deleteBook).toHaveBeenCalledWith('missing');
  });

  test('deletes the book and returns its bookId', async () => {
    deleteBook.mockResolvedValueOnce({ bookId: 'book-1' });

    const response = await DELETE(jsonRequest({}), paramsFor('book-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ bookId: 'book-1' });
  });

  test('returns a 502 when deleting the book fails', async () => {
    deleteBook.mockRejectedValueOnce(new Error('blob del failed'));

    const response = await DELETE(jsonRequest({}), paramsFor('book-1'));

    expect(response.status).toBe(502);
  });
});
