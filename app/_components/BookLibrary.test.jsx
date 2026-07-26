import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { addBook } from '@/app/_lib/bookLibrary';

import ChakraProvider from '../_providers/chakra';
import BookLibrary from './BookLibrary';

describe('BookLibrary', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('renders nothing when the library is empty', () => {
    const { container } = render(
      <ChakraProvider>
        <BookLibrary onSelect={vi.fn()} />
      </ChakraProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test('lists every previously uploaded book', () => {
    addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] });
    addBook({ bookId: 'book-2', title: 'Second Book', chunks: ['二。'] });

    render(
      <ChakraProvider>
        <BookLibrary onSelect={vi.fn()} />
      </ChakraProvider>,
    );

    expect(screen.getByText('First Book')).toBeInTheDocument();
    expect(screen.getByText('Second Book')).toBeInTheDocument();
  });

  test('selecting a book calls onSelect with its bookId', () => {
    addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] });
    const onSelect = vi.fn();

    render(
      <ChakraProvider>
        <BookLibrary onSelect={onSelect} />
      </ChakraProvider>,
    );

    fireEvent.click(screen.getByText('First Book'));

    expect(onSelect).toHaveBeenCalledWith('book-1');
  });
});
