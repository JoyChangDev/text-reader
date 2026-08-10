import { describe, expect, test, vi } from 'vitest';

import { BOOK_INCOMPLETE, deleteBook, getBook, updateResumeIndex } from '@/app/_lib/libraryService';

vi.mock('@/app/_lib/libraryService', () => ({
  BOOK_INCOMPLETE: 'BOOK_INCOMPLETE',
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

  // Its own status because it is neither of the two it would otherwise be mistaken for: the
  // Book is in the index, so it is not a 404, and the store answered, so retrying it the way
  // a 502 invites will never help (see ticket 06).
  test('returns 409 for a Book the index advertises but the store has no chunks for', async () => {
    const incomplete = new Error('chunks were never stored');
    incomplete.code = BOOK_INCOMPLETE;
    getBook.mockRejectedValueOnce(incomplete);

    const response = await GET(jsonRequest({}), paramsFor('book-1'));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'book is incomplete' });
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

  // A position with no timestamp cannot be compared against the stored one, so it would
  // either be dropped in silence or win against every later save (see ticket 10).
  test('rejects a request whose updatedAt is missing or not a number with 400', async () => {
    const missing = await PATCH(
      jsonRequest({ resumeIndex: 3, resumeSentenceIndex: 0 }),
      paramsFor('book-1'),
    );
    const wrongType = await PATCH(
      jsonRequest({ resumeIndex: 3, resumeSentenceIndex: 0, updatedAt: 'soon' }),
      paramsFor('book-1'),
    );

    expect(missing.status).toBe(400);
    expect(wrongType.status).toBe(400);
    expect(updateResumeIndex).not.toHaveBeenCalled();
  });

  // Deliberately no 404 for an unknown Book: proving it exists means reading the Library
  // index, which is the Blob operation this path exists to stop spending. A position
  // stored against a Book that isn't there is unreachable and costs nothing.
  test('does not read the Library index to check the Book exists', async () => {
    const position = { resumeIndex: 3, resumeSentenceIndex: 0, updatedAt: 1_000 };
    // This file has no shared mock reset, and the GET suite above calls getBook.
    getBook.mockClear();
    updateResumeIndex.mockResolvedValueOnce(position);

    const response = await PATCH(jsonRequest(position), paramsFor('missing'));

    expect(response.status).toBe(200);
    expect(getBook).not.toHaveBeenCalled();
  });

  test('passes the position, its updatedAt and the snapshot flag through', async () => {
    const position = { resumeIndex: 3, resumeSentenceIndex: 1, updatedAt: 1_000 };
    updateResumeIndex.mockResolvedValueOnce(position);

    const response = await PATCH(jsonRequest({ ...position, snapshot: true }), paramsFor('book-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(position);
    expect(updateResumeIndex).toHaveBeenCalledWith('book-1', { ...position, snapshot: true });
  });

  // Ordinary per-Sentence saves must not ask for a Blob write, so an absent flag has to
  // mean false rather than "whatever the body happened to contain".
  test('defaults the snapshot flag to false when the caller omits it', async () => {
    updateResumeIndex.mockResolvedValueOnce({});

    await PATCH(
      jsonRequest({ resumeIndex: 3, resumeSentenceIndex: 1, updatedAt: 1_000 }),
      paramsFor('book-1'),
    );

    expect(updateResumeIndex).toHaveBeenCalledWith(
      'book-1',
      expect.objectContaining({ snapshot: false }),
    );
  });

  test('returns a 502 when updating the resume position fails', async () => {
    updateResumeIndex.mockRejectedValueOnce(new Error('redis eval failed'));

    const response = await PATCH(
      jsonRequest({ resumeIndex: 3, resumeSentenceIndex: 0, updatedAt: 1_000 }),
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
