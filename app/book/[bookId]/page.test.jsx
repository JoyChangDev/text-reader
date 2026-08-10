import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useParams, useRouter } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { deleteBook, getBook } from '@/app/_lib/bookLibrary';
import { getLastOpenBook, setLastOpenBook } from '@/app/_lib/lastOpenBook';

import ChakraProvider from '../../_providers/chakra';
import BookPage from './page';

vi.mock('next/navigation', () => ({
  useParams: vi.fn(),
  useRouter: vi.fn(),
}));

vi.mock('@/app/_lib/bookLibrary', () => ({
  getBook: vi.fn(),
  deleteBook: vi.fn(),
  INCOMPLETE_BOOK_STATUS: 409,
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

  // The whole of ticket 06 seen from the Listener's side: a Book whose text was never
  // stored used to open onto a reader with no words and a play button that did nothing.
  describe('when the book cannot be opened', () => {
    let consoleError;

    beforeEach(() => {
      consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    function rejectWith(status) {
      const error = new Error(`The library request failed with ${status}`);
      error.status = status;
      getBook.mockRejectedValue(error);
    }

    test('says the book was never stored, rather than rendering an empty reader', async () => {
      rejectWith(409);

      render(
        <ChakraProvider>
          <BookPage />
        </ChakraProvider>,
      );

      expect(await screen.findByRole('alert')).toHaveTextContent(/沒有儲存成功/);
      expect(screen.queryByRole('button', { name: /^播放$/i })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('載入書籍中')).not.toBeInTheDocument();
      expect(consoleError).toHaveBeenCalled();
    });

    // A corrupt Book is permanent, so an automatic bounce back to the Library would hide it
    // again - the Listener has to be told, and then choose to leave.
    test('offers a way back to the library instead of redirecting on its own', async () => {
      rejectWith(409);

      render(
        <ChakraProvider>
          <BookPage />
        </ChakraProvider>,
      );

      fireEvent.click(await screen.findByText(/返回書庫/i));

      expect(push).toHaveBeenCalledWith('/');
      expect(replace).not.toHaveBeenCalled();
    });

    test('says something else when the library itself could not be reached', async () => {
      rejectWith(502);

      render(
        <ChakraProvider>
          <BookPage />
        </ChakraProvider>,
      );

      expect(await screen.findByRole('alert')).toHaveTextContent(/無法載入/);
    });

    // Otherwise every launch auto-restores straight back into the error - the same dead end
    // a stale pointer to a deleted Book creates.
    test('clears its own last-open pointer so the next launch does not come back here', async () => {
      setLastOpenBook('book-1');
      rejectWith(409);

      render(
        <ChakraProvider>
          <BookPage />
        </ChakraProvider>,
      );

      await screen.findByRole('alert');
      expect(getLastOpenBook()).toBeNull();
    });

    // A store that could not be reached will very likely answer next time, and forgetting
    // the Book would make a blip cost the Listener their place.
    test('keeps the pointer when the failure is one that might not repeat', async () => {
      setLastOpenBook('book-1');
      rejectWith(502);

      render(
        <ChakraProvider>
          <BookPage />
        </ChakraProvider>,
      );

      await screen.findByRole('alert');
      expect(getLastOpenBook()).toBe('book-1');
    });

    // "The Book should stop existing, or stop being incomplete" - offered here, where the
    // Listener already is, rather than as an instruction to go and find it in the Library.
    test('lets the Listener delete the book that cannot be read, and returns to the library', async () => {
      rejectWith(409);
      deleteBook.mockResolvedValue({ bookId: 'book-1' });
      setLastOpenBook('book-1');

      render(
        <ChakraProvider>
          <BookPage />
        </ChakraProvider>,
      );

      fireEvent.click(await screen.findByRole('button', { name: /刪除這本書/ }));

      await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
      expect(deleteBook).toHaveBeenCalledWith('book-1');
      expect(getLastOpenBook()).toBeNull();
    });

    // Deleting is itself a call that can fail, and saying nothing about that is the shape
    // of the whole ticket.
    test('stays put when the delete fails, rather than reporting a book that is still there', async () => {
      rejectWith(409);
      deleteBook.mockRejectedValue(new Error('The library request failed with 502'));

      render(
        <ChakraProvider>
          <BookPage />
        </ChakraProvider>,
      );

      fireEvent.click(await screen.findByRole('button', { name: /刪除這本書/ }));

      await waitFor(() => expect(deleteBook).toHaveBeenCalled());
      expect(push).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // Nothing to delete: the Book may be perfectly fine and simply unreachable right now.
    test('does not offer to delete a book that merely could not be reached', async () => {
      rejectWith(502);

      render(
        <ChakraProvider>
          <BookPage />
        </ChakraProvider>,
      );

      await screen.findByRole('alert');
      expect(screen.queryByRole('button', { name: /刪除這本書/ })).not.toBeInTheDocument();
    });
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
