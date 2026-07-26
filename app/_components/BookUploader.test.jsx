import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import ChakraProvider from '../_providers/chakra';
import BookUploader from './BookUploader';

function makeTxtFile(text, name = 'book.txt') {
  return new File([text], name, { type: 'text/plain' });
}

describe('BookUploader', () => {
  beforeEach(() => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ chunks: ['第一段。', '第二段。'] }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('lets the reader pick a .txt file and hands its chunks up once chunked', async () => {
    const onReady = vi.fn();

    render(
      <ChakraProvider>
        <BookUploader onReady={onReady} />
      </ChakraProvider>,
    );

    const file = makeTxtFile('第一段。第二段。');
    const input = screen.getByLabelText(/upload/i);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));

    const [book] = onReady.mock.calls[0];
    expect(book.chunks).toEqual(['第一段。', '第二段。']);
    expect(typeof book.bookId).toBe('string');
    expect(book.bookId.length).toBeGreaterThan(0);

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/chunks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: '第一段。第二段。' }),
      }),
    );
  });

  test('lets the reader drop a .txt file onto the dropzone', async () => {
    const onReady = vi.fn();

    render(
      <ChakraProvider>
        <BookUploader onReady={onReady} />
      </ChakraProvider>,
    );

    const file = makeTxtFile('第一段。第二段。');
    const dropzone = screen.getByTestId('book-dropzone');
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(onReady.mock.calls[0][0].chunks).toEqual(['第一段。', '第二段。']);
  });

  test('shows an error message if chunking the uploaded file fails', async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: 'nope' }), { status: 400 }),
    );
    const onReady = vi.fn();

    render(
      <ChakraProvider>
        <BookUploader onReady={onReady} />
      </ChakraProvider>,
    );

    const file = makeTxtFile('第一段。');
    const input = screen.getByLabelText(/upload/i);
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/couldn't process/i)).toBeInTheDocument();
    expect(onReady).not.toHaveBeenCalled();
  });
});
