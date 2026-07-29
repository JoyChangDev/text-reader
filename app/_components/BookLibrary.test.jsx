import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { listBooks } from '@/app/_lib/bookLibrary';

import ChakraProvider from '../_providers/chakra';
import BookLibrary from './BookLibrary';

vi.mock('@/app/_lib/bookLibrary', () => ({
  listBooks: vi.fn(),
}));

describe('BookLibrary', () => {
  beforeEach(() => {
    listBooks.mockReset();
  });

  test('renders nothing when the library is empty', async () => {
    listBooks.mockResolvedValue([]);

    const { container } = render(
      <ChakraProvider>
        <BookLibrary onSelect={vi.fn()} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(listBooks).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  test('lists every previously uploaded book', async () => {
    listBooks.mockResolvedValue([
      { bookId: 'book-1', title: 'First Book', resumeIndex: 0 },
      { bookId: 'book-2', title: 'Second Book', resumeIndex: 0 },
    ]);

    render(
      <ChakraProvider>
        <BookLibrary onSelect={vi.fn()} />
      </ChakraProvider>,
    );

    expect(await screen.findByText('First Book')).toBeInTheDocument();
    expect(screen.getByText('Second Book')).toBeInTheDocument();
  });

  test('selecting a book calls onSelect with its bookId', async () => {
    listBooks.mockResolvedValue([{ bookId: 'book-1', title: 'First Book', resumeIndex: 0 }]);
    const onSelect = vi.fn();

    render(
      <ChakraProvider>
        <BookLibrary onSelect={onSelect} />
      </ChakraProvider>,
    );

    fireEvent.click(await screen.findByText('First Book'));

    expect(onSelect).toHaveBeenCalledWith('book-1');
  });
});
