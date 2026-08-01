import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useParams, useRouter } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { getBook } from '@/app/_lib/bookLibrary';
import { getLastOpenBook, setLastOpenBook } from '@/app/_lib/lastOpenBook';

import ChakraProvider from '../../_providers/chakra';
import BookPage from './page';

vi.mock('next/navigation', () => ({
  useParams: vi.fn(),
  useRouter: vi.fn(),
}));

vi.mock('@/app/_lib/bookLibrary', () => ({
  getBook: vi.fn(),
}));

describe('BookPage', () => {
  let push;
  let replace;

  beforeEach(() => {
    localStorage.clear();
    push = vi.fn();
    replace = vi.fn();
    useParams.mockReturnValue({ bookId: 'book-1' });
    useRouter.mockReturnValue({ push, replace });
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();

    global.fetch = vi.fn(async (url, init) => {
      if (url === '/api/audio-chunks') {
        const { chunkIndex } = JSON.parse(init.body);
        return new Response(
          JSON.stringify({ url: `https://blob.test/${chunkIndex}`, boundaries: [] }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('shows a loading state while the book is being fetched, then renders the reader', async () => {
    let resolveGetBook;
    getBook.mockReturnValue(
      new Promise((resolve) => {
        resolveGetBook = resolve;
      }),
    );

    render(
      <ChakraProvider>
        <BookPage />
      </ChakraProvider>,
    );

    expect(screen.getByLabelText('載入書籍中')).toBeInTheDocument();

    resolveGetBook({
      bookId: 'book-1',
      title: 'First Book',
      chunks: ['第一段。'],
      resumeIndex: 0,
      resumeSentenceIndex: 0,
    });

    expect(await screen.findByRole('button', { name: /^播放$/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('載入書籍中')).not.toBeInTheDocument();
  });

  test('resumes at the saved Chunk/Sentence position', async () => {
    getBook.mockResolvedValue({
      bookId: 'book-1',
      title: 'First Book',
      chunks: ['第一段。', '第二段。', '第三段。'],
      resumeIndex: 2,
      resumeSentenceIndex: 0,
    });

    render(
      <ChakraProvider>
        <BookPage />
      </ChakraProvider>,
    );

    await screen.findByRole('button', { name: /^播放$/i });
    await waitFor(() =>
      expect(global.fetch.mock.calls.filter(([url]) => url === '/api/audio-chunks')).toHaveLength(
        1,
      ),
    );
    const [, request] = global.fetch.mock.calls.find(([url]) => url === '/api/audio-chunks');
    expect(JSON.parse(request.body).chunkIndex).toBe(2);
  });

  test('redirects to the library when the book no longer exists', async () => {
    getBook.mockResolvedValue(null);

    render(
      <ChakraProvider>
        <BookPage />
      </ChakraProvider>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(screen.queryByRole('button', { name: /^播放$/i })).not.toBeInTheDocument();
  });

  test('pressing 返回書庫 navigates to the library route', async () => {
    getBook.mockResolvedValue({
      bookId: 'book-1',
      title: 'First Book',
      chunks: ['第一段。'],
      resumeIndex: 0,
      resumeSentenceIndex: 0,
    });

    render(
      <ChakraProvider>
        <BookPage />
      </ChakraProvider>,
    );

    fireEvent.click(await screen.findByText(/返回書庫/i));

    expect(push).toHaveBeenCalledWith('/');
  });

  test('records this book as the last-open one once it loads', async () => {
    getBook.mockResolvedValue({
      bookId: 'book-1',
      title: 'First Book',
      chunks: ['第一段。'],
      resumeIndex: 0,
      resumeSentenceIndex: 0,
    });

    render(
      <ChakraProvider>
        <BookPage />
      </ChakraProvider>,
    );

    await screen.findByRole('button', { name: /^播放$/i });
    expect(getLastOpenBook()).toBe('book-1');
  });

  test('clears its own stale last-open pointer when the book no longer exists', async () => {
    setLastOpenBook('book-1');
    getBook.mockResolvedValue(null);

    render(
      <ChakraProvider>
        <BookPage />
      </ChakraProvider>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(getLastOpenBook()).toBeNull();
  });

  test("does not clear a different book's last-open pointer when this one is not found", async () => {
    setLastOpenBook('some-other-book');
    getBook.mockResolvedValue(null);

    render(
      <ChakraProvider>
        <BookPage />
      </ChakraProvider>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(getLastOpenBook()).toBe('some-other-book');
  });

  test('clears the last-open pointer when 返回書庫 is pressed', async () => {
    getBook.mockResolvedValue({
      bookId: 'book-1',
      title: 'First Book',
      chunks: ['第一段。'],
      resumeIndex: 0,
      resumeSentenceIndex: 0,
    });

    render(
      <ChakraProvider>
        <BookPage />
      </ChakraProvider>,
    );

    fireEvent.click(await screen.findByText(/返回書庫/i));

    expect(getLastOpenBook()).toBeNull();
  });
});
