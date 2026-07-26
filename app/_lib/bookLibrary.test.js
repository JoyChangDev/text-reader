import { beforeEach, describe, expect, test } from 'vitest';

import { addBook, getBook, listBooks, updateResumeIndex } from './bookLibrary';

describe('bookLibrary', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('adding a book does not replace existing entries', () => {
    addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] });
    addBook({ bookId: 'book-2', title: 'Second Book', chunks: ['二。'] });

    const books = listBooks();
    expect(books).toHaveLength(2);
    expect(books.map((book) => book.bookId)).toEqual(['book-1', 'book-2']);
  });

  test('a newly added book starts with a resume index of 0', () => {
    addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] });

    expect(getBook('book-1').resumeIndex).toBe(0);
  });

  test('listBooks lists every previously added book', () => {
    addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] });
    addBook({ bookId: 'book-2', title: 'Second Book', chunks: ['二。'] });

    expect(listBooks().map((book) => book.title)).toEqual(['First Book', 'Second Book']);
  });

  test('getBook returns the full entry, including its chunks, for a known id', () => {
    addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。', '二。'] });

    expect(getBook('book-1')).toEqual({
      bookId: 'book-1',
      title: 'First Book',
      chunks: ['一。', '二。'],
      resumeIndex: 0,
    });
  });

  test('getBook returns null for an unknown id', () => {
    expect(getBook('missing')).toBeNull();
  });

  test('updateResumeIndex updates only the targeted book', () => {
    addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] });
    addBook({ bookId: 'book-2', title: 'Second Book', chunks: ['二。'] });

    updateResumeIndex('book-2', 3);

    expect(getBook('book-1').resumeIndex).toBe(0);
    expect(getBook('book-2').resumeIndex).toBe(3);
  });

  test('persists across separate calls, as if surviving a page reload', () => {
    addBook({ bookId: 'book-1', title: 'First Book', chunks: ['一。'] });
    updateResumeIndex('book-1', 5);

    // A fresh read from storage (no in-memory state carried over) still sees it.
    expect(listBooks()).toEqual([
      { bookId: 'book-1', title: 'First Book', chunks: ['一。'], resumeIndex: 5 },
    ]);
  });
});
