import { beforeEach, describe, expect, test } from 'vitest';

import { clearLastOpenBook, getLastOpenBook, setLastOpenBook } from './lastOpenBook';

describe('lastOpenBook', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('returns null when nothing has been set', () => {
    expect(getLastOpenBook()).toBeNull();
  });

  test('round-trips a bookId through set/get', () => {
    setLastOpenBook('book-1');
    expect(getLastOpenBook()).toBe('book-1');
  });

  test('overwrites a previously set bookId', () => {
    setLastOpenBook('book-1');
    setLastOpenBook('book-2');
    expect(getLastOpenBook()).toBe('book-2');
  });

  test('clear removes the pointer', () => {
    setLastOpenBook('book-1');
    clearLastOpenBook();
    expect(getLastOpenBook()).toBeNull();
  });

  test('tolerates malformed stored data instead of throwing', () => {
    localStorage.setItem('lastOpenBook', 'not json');
    expect(getLastOpenBook()).toBeNull();
  });
});
