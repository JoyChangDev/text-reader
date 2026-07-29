import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { addBook, listBooks, updateResumeIndex } from '@/app/_lib/bookLibrary';

import ChakraProvider from './_providers/chakra';
import Home from './page';

describe('Home', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('uploading a .txt file hands off from the uploader to the player', async () => {
    global.fetch = vi.fn(async (url, { body }) => {
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
    const input = screen.getByLabelText(/upload/i);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('Chunk 1 of 2')).toBeInTheDocument());
    expect(await screen.findByRole('button', { name: /^play$/i })).toBeEnabled();

    // Uploading added a new library entry without touching any existing ones.
    expect(listBooks()).toEqual([
      {
        bookId: expect.any(String),
        title: 'book.txt',
        chunks: ['第一段。', '第二段。'],
        resumeIndex: 0,
      },
    ]);
  });

  test('uploading a new book does not remove existing library entries', async () => {
    addBook({ bookId: 'existing-book', title: 'Existing Book', chunks: ['舊。'] });

    global.fetch = vi.fn(async (url, { body }) => {
      if (url === '/api/chunks') {
        return new Response(JSON.stringify({ chunks: ['新。'] }), { status: 200 });
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

    const file = new File(['新。'], 'new-book.txt', { type: 'text/plain' });
    const input = screen.getByLabelText(/upload/i);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(listBooks()).toHaveLength(2));
    expect(listBooks().map((book) => book.title)).toEqual(['Existing Book', 'new-book.txt']);
  });

  test('selecting a book from the library resumes playback at its saved position', async () => {
    addBook({
      bookId: 'saved-book',
      title: 'Saved Book',
      chunks: ['第一段。', '第二段。', '第三段。'],
    });
    updateResumeIndex('saved-book', 2);

    global.fetch = vi.fn(async (_url, { body }) => {
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

    fireEvent.click(screen.getByText('Saved Book'));

    await waitFor(() => expect(screen.getByText('Chunk 3 of 3')).toBeInTheDocument());
    // Only the saved-forward chunk is requested - chunks 0 and 1 were already
    // heard in an earlier session and are never re-requested.
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).chunkIndex).toBe(2);
  });

  test('offers voice preview before any book is opened', async () => {
    render(
      <ChakraProvider>
        <Home />
      </ChakraProvider>,
    );

    const previewButton = screen.getByRole('button', { name: /preview yun-jhe/i });
    fireEvent.click(previewButton);

    expect(screen.getByTestId('voice-preview-audio').src).toContain(
      '/voice-samples/zh-TW-YunJheNeural.mp3',
    );
    expect(await screen.findByRole('button', { name: /stop yun-jhe/i })).toBeInTheDocument();
  });

  test('going back to the library lets the reader switch to a different book', async () => {
    addBook({ bookId: 'book-a', title: 'Book A', chunks: ['甲。'] });
    addBook({ bookId: 'book-b', title: 'Book B', chunks: ['乙。'] });

    global.fetch = vi.fn(async (_url, { body }) => {
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

    fireEvent.click(screen.getByText('Book A'));
    await waitFor(() => expect(screen.getByText('Chunk 1 of 1')).toBeInTheDocument());

    fireEvent.click(screen.getByText(/back to library/i));
    await waitFor(() => expect(screen.getByText('Book B')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Book B'));
    await waitFor(() => expect(screen.getByText('Chunk 1 of 1')).toBeInTheDocument());
  });
});
