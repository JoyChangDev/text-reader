import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useParams, useRouter } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { addBook, listBooks } from '@/app/_lib/bookLibrary';
import { setLastOpenBook } from '@/app/_lib/lastOpenBook';

import ChakraProvider from './_providers/chakra';
import BookPage from './book/[bookId]/page';
import Home from './page';

vi.mock('next/navigation', () => ({
  useParams: vi.fn(),
  useRouter: vi.fn(),
}));

// A fake /api/library backend (in-memory, reset per test) so bookLibrary.js's
// fetch-based addBook/listBooks work the same way they will against the real API
// routes - see .scratch/phase-1-6-listening-polish/issues/07-cross-device-library.md.
// Since Phase 1.9 moved the reader itself to app/book/[bookId], this file only exercises
// the library route: what happens once a book is opened/selected is `router.push`, not
// a rendered player (see app/book/[bookId]/page.test.jsx for that).
let libraryBooks;

function fetchMock(handleOther, { failLibraryPost = false } = {}) {
  return vi.fn(async (url, options = {}) => {
    if (failLibraryPost && url === '/api/library' && options.method === 'POST') {
      return new Response(JSON.stringify({ error: 'Adding the book to the library failed' }), {
        status: 502,
      });
    }
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
    if (url === '/api/blob-usage') {
      return new Response(JSON.stringify({ usedBytes: 0, quotaBytes: 1_073_741_824, percent: 0 }), {
        status: 200,
      });
    }
    const bookIdMatch = url.match(/^\/api\/library\/(.+)$/);
    if (bookIdMatch && (!options.method || options.method === 'GET')) {
      const book = libraryBooks.find((entry) => entry.bookId === bookIdMatch[1]);
      if (!book) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      return new Response(JSON.stringify(book), { status: 200 });
    }

    return handleOther(url, options);
  });
}

describe('Home', () => {
  let push;
  let replace;

  beforeEach(() => {
    libraryBooks = [];
    localStorage.clear();
    push = vi.fn();
    replace = vi.fn();
    useRouter.mockReturnValue({ push, replace });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('uploading a .txt file persists it then navigates to its reader route', async () => {
    global.fetch = fetchMock(async (url) => {
      if (url === '/api/chunks') {
        return new Response(JSON.stringify({ chunks: ['第一段。', '第二段。'] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });

    render(
      <ChakraProvider>
        <Home />
      </ChakraProvider>,
    );

    const file = new File(['第一段。第二段。'], 'book.txt', { type: 'text/plain' });
    const input = screen.getByLabelText(/上傳/);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(async () => {
      expect(await listBooks()).toEqual([
        { bookId: expect.any(String), title: 'book.txt', resumeIndex: 0 },
      ]);
    });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const books = await listBooks();
    expect(push).toHaveBeenCalledWith(`/book/${books[0].bookId}`);
  });

  // The route already answers 502 with a message; nothing between it and the Listener used
  // to look at the status, so a Book that was never stored was navigated into as if it had
  // been (see ticket 06).
  test('a book that could not be saved reports the failure instead of navigating into it', async () => {
    global.fetch = fetchMock(
      async (url) => {
        if (url === '/api/chunks') {
          return new Response(JSON.stringify({ chunks: ['第一段。'] }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      },
      { failLibraryPost: true },
    );

    render(
      <ChakraProvider>
        <Home />
      </ChakraProvider>,
    );

    const file = new File(['第一段。'], 'book.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText(/上傳/), { target: { files: [file] } });

    expect(await screen.findByText(/無法處理/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  test('uploading a new book does not remove existing library entries', async () => {
    global.fetch = fetchMock(async (url) => {
      if (url === '/api/chunks') {
        return new Response(JSON.stringify({ chunks: ['新。'] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
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

  test('selecting a book from the library navigates to its reader route', async () => {
    global.fetch = fetchMock(async () => new Response('{}', { status: 200 }));
    await addBook({ bookId: 'saved-book', title: 'Saved Book', chunks: ['第一段。'] });

    render(
      <ChakraProvider>
        <Home />
      </ChakraProvider>,
    );

    fireEvent.click(await screen.findByText('Saved Book'));

    expect(push).toHaveBeenCalledWith('/book/saved-book');
  });

  test('redirects straight to the last-open book instead of showing the library', async () => {
    global.fetch = fetchMock(async () => new Response('{}', { status: 200 }));
    setLastOpenBook('book-in-progress');

    render(
      <ChakraProvider>
        <Home />
      </ChakraProvider>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/book/book-in-progress'));
    expect(screen.queryByLabelText(/上傳/)).not.toBeInTheDocument();
  });

  test('renders the library normally when there is no last-open book', async () => {
    global.fetch = fetchMock(async () => new Response('{}', { status: 200 }));

    render(
      <ChakraProvider>
        <Home />
      </ChakraProvider>,
    );

    expect(await screen.findByLabelText(/上傳/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  test('pressing 返回書庫 in the reader, then a fresh library mount, shows the library - not the book just left', async () => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    global.fetch = fetchMock(async (url) => {
      if (url === '/api/audio-chunks') {
        return new Response(JSON.stringify({ url: 'https://blob.test/0', boundaries: [] }), {
          status: 200,
        });
      }
      return new Response('{}', { status: 200 });
    });
    await addBook({ bookId: 'left-book', title: 'Left Book', chunks: ['第一段。'] });
    useParams.mockReturnValue({ bookId: 'left-book' });

    const { unmount } = render(
      <ChakraProvider>
        <BookPage />
      </ChakraProvider>,
    );
    fireEvent.click(await screen.findByText(/返回書庫/i));
    unmount();

    render(
      <ChakraProvider>
        <Home />
      </ChakraProvider>,
    );

    expect(await screen.findByLabelText(/上傳/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
