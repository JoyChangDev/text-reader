import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { addBook, listBooks, updateResumeIndex } from '@/app/_lib/bookLibrary';

import ChakraProvider from './_providers/chakra';
import Home from './page';

// A fake /api/library backend (in-memory, reset per test) layered under whatever
// chunk/audio-chunk handling a given test needs, so bookLibrary.js's fetch-based
// addBook/listBooks/getBook/updateResumeIndex work the same way they will against the
// real API routes - see .scratch/phase-1-6-listening-polish/issues/07-cross-device-library.md.
let libraryBooks;

function fetchMock(handleOther) {
  return vi.fn(async (url, options = {}) => {
    if (url === '/api/library' && (!options.method || options.method === 'GET')) {
      return new Response(
        JSON.stringify({ books: libraryBooks.map(({ chunks: _chunks, ...summary }) => summary) }),
        { status: 200 },
      );
    }
    if (url === '/api/library' && options.method === 'POST') {
      const { bookId, title, chunks } = JSON.parse(options.body);
      const summary = { bookId, title, resumeIndex: 0 };
      libraryBooks.push({ ...summary, chunks });
      return new Response(JSON.stringify(summary), { status: 201 });
    }

    const bookIdMatch = url.match(/^\/api\/library\/(.+)$/);
    if (bookIdMatch && (!options.method || options.method === 'GET')) {
      const book = libraryBooks.find((entry) => entry.bookId === bookIdMatch[1]);
      if (!book) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      return new Response(JSON.stringify(book), { status: 200 });
    }
    if (bookIdMatch && options.method === 'PATCH') {
      const { resumeIndex, resumeSentenceIndex } = JSON.parse(options.body);
      const book = libraryBooks.find((entry) => entry.bookId === bookIdMatch[1]);
      if (!book) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      book.resumeIndex = resumeIndex;
      book.resumeSentenceIndex = resumeSentenceIndex;
      return new Response(JSON.stringify(book), { status: 200 });
    }
    if (url === '/api/blob-usage') {
      return new Response(JSON.stringify({ usedBytes: 0, quotaBytes: 1_073_741_824, percent: 0 }), {
        status: 200,
      });
    }

    return handleOther(url, options);
  });
}

describe('Home', () => {
  beforeEach(() => {
    libraryBooks = [];
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('uploading a .txt file hands off from the uploader to the player', async () => {
    global.fetch = fetchMock(async (url, { body }) => {
      if (url === '/api/chunks') {
        return new Response(JSON.stringify({ chunks: ['第一段。', '第二段。'] }), { status: 200 });
      }
      const { chunkIndex } = JSON.parse(body);
      return new Response(
        JSON.stringify({ url: `https://blob.test/${chunkIndex}`, boundaries: [] }),
        { status: 200 },
      );
    });

    render(
      <ChakraProvider>
        <Home />
      </ChakraProvider>,
    );

    const file = new File(['第一段。第二段。'], 'book.txt', { type: 'text/plain' });
    const input = screen.getByLabelText(/上傳/);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByRole('button', { name: /^播放$/i })).toBeEnabled());

    // Uploading added a new library entry without touching any existing ones.
    await waitFor(async () => {
      expect(await listBooks()).toEqual([
        { bookId: expect.any(String), title: 'book.txt', resumeIndex: 0 },
      ]);
    });
  });

  test('uploading a new book does not remove existing library entries', async () => {
    global.fetch = fetchMock(async (url, { body }) => {
      if (url === '/api/chunks') {
        return new Response(JSON.stringify({ chunks: ['新。'] }), { status: 200 });
      }
      const { chunkIndex } = JSON.parse(body);
      return new Response(
        JSON.stringify({ url: `https://blob.test/${chunkIndex}`, boundaries: [] }),
        { status: 200 },
      );
    });
    await addBook({ bookId: 'existing-book', title: 'Existing Book', chunks: ['舊。'] });

    render(
      <ChakraProvider>
        <Home />
      </ChakraProvider>,
    );

    const file = new File(['新。'], 'new-book.txt', { type: 'text/plain' });
    const input = screen.getByLabelText(/上傳/);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(async () => expect(await listBooks()).toHaveLength(2));
    const books = await listBooks();
    expect(books.map((book) => book.title)).toEqual(['Existing Book', 'new-book.txt']);
  });

  test('selecting a book from the library resumes playback at its saved position', async () => {
    global.fetch = fetchMock(async (_url, { body }) => {
      const { chunkIndex } = JSON.parse(body);
      return new Response(
        JSON.stringify({ url: `https://blob.test/${chunkIndex}`, boundaries: [] }),
        { status: 200 },
      );
    });
    await addBook({
      bookId: 'saved-book',
      title: 'Saved Book',
      chunks: ['第一段。', '第二段。', '第三段。'],
    });
    await updateResumeIndex('saved-book', { resumeIndex: 2, resumeSentenceIndex: 0 });

    render(
      <ChakraProvider>
        <Home />
      </ChakraProvider>,
    );

    fireEvent.click(await screen.findByText('Saved Book'));

    // Only the saved-forward chunk is requested - chunks 0 and 1 were already
    // heard in an earlier session and are never re-requested.
    await waitFor(() =>
      expect(global.fetch.mock.calls.filter(([url]) => url === '/api/audio-chunks')).toHaveLength(
        1,
      ),
    );
    const [, audioChunkRequest] = global.fetch.mock.calls.find(
      ([url]) => url === '/api/audio-chunks',
    );
    expect(JSON.parse(audioChunkRequest.body).chunkIndex).toBe(2);
  });

  test('going back to the library lets the reader switch to a different book', async () => {
    global.fetch = fetchMock(async (_url, { body }) => {
      const { chunkIndex } = JSON.parse(body);
      return new Response(
        JSON.stringify({ url: `https://blob.test/${chunkIndex}`, boundaries: [] }),
        { status: 200 },
      );
    });
    await addBook({ bookId: 'book-a', title: 'Book A', chunks: ['甲。'] });
    await addBook({ bookId: 'book-b', title: 'Book B', chunks: ['乙。'] });

    render(
      <ChakraProvider>
        <Home />
      </ChakraProvider>,
    );

    fireEvent.click(await screen.findByText('Book A'));
    expect(await screen.findByRole('button', { name: /^播放$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByText(/返回書庫/i));
    await waitFor(() => expect(screen.getByText('Book B')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Book B'));
    expect(await screen.findByRole('button', { name: /^播放$/i })).toBeInTheDocument();
  });
});
