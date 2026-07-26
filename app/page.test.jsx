import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import ChakraProvider from './_providers/chakra';
import Home from './page';

describe('Home', () => {
  beforeEach(() => {
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
    expect(await screen.findByRole('button', { name: /play/i })).toBeEnabled();
  });
});
