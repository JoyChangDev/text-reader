import { beforeEach, describe, expect, test, vi } from 'vitest';

const { fakeDel, fakeList, fakePut } = vi.hoisted(() => ({
  fakeDel: vi.fn(),
  fakeList: vi.fn(),
  fakePut: vi.fn(),
}));

vi.mock('@vercel/blob', () => ({
  get: vi.fn(),
  put: fakePut,
  del: fakeDel,
  list: fakeList,
}));

import { createBlobStorageClient } from './blobStorageClient';

describe('createBlobStorageClient', () => {
  beforeEach(() => {
    fakeDel.mockReset();
    fakeList.mockReset();
    fakePut.mockReset();
  });

  describe('del', () => {
    test('deletes the given key via @vercel/blob del, threading the token through', async () => {
      fakeDel.mockResolvedValue(undefined);
      const client = createBlobStorageClient({ token: 'test-token' });

      await client.del('library/book-1/chunks.json');

      expect(fakeDel).toHaveBeenCalledWith('library/book-1/chunks.json', { token: 'test-token' });
    });

    test('propagates errors from @vercel/blob del', async () => {
      fakeDel.mockRejectedValue(new Error('delete failed'));
      const client = createBlobStorageClient({ token: 'test-token' });

      await expect(client.del('book-1/0/voice-a.mp3')).rejects.toThrow('delete failed');
    });
  });

  describe('putJson', () => {
    test('stores the data as JSON at the key plus a .json suffix', async () => {
      fakePut.mockResolvedValue({ url: 'https://blob.example/library/index.json' });
      const client = createBlobStorageClient({ token: 'test-token' });

      await client.putJson('library/index', [{ bookId: 'book-1', resumeIndex: 0 }]);

      expect(fakePut).toHaveBeenCalledWith(
        'library/index.json',
        JSON.stringify([{ bookId: 'book-1', resumeIndex: 0 }]),
        {
          access: 'public',
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: 'application/json',
          token: 'test-token',
        },
      );
    });

    test('propagates errors from @vercel/blob put', async () => {
      fakePut.mockRejectedValue(new Error('put failed'));
      const client = createBlobStorageClient({ token: 'test-token' });

      await expect(client.putJson('library/index', [])).rejects.toThrow('put failed');
    });
  });

  describe('list', () => {
    test('lists blobs under a prefix, returning only pathname, size, and uploadedAt', async () => {
      const uploadedAt = new Date('2026-01-01T00:00:00Z');
      fakeList.mockResolvedValue({
        blobs: [
          {
            url: 'https://blob.example/book-1/0/voice-a.mp3',
            downloadUrl: 'https://blob.example/book-1/0/voice-a.mp3?download=1',
            pathname: 'book-1/0/voice-a.mp3',
            size: 1024,
            uploadedAt,
            etag: 'abc123',
          },
        ],
        cursor: undefined,
        hasMore: false,
      });
      const client = createBlobStorageClient({ token: 'test-token' });

      const result = await client.list('book-1/');

      expect(fakeList).toHaveBeenCalledWith({ prefix: 'book-1/', token: 'test-token' });
      expect(result).toEqual([{ pathname: 'book-1/0/voice-a.mp3', size: 1024, uploadedAt }]);
    });

    test('returns an empty array when nothing matches the prefix', async () => {
      fakeList.mockResolvedValue({ blobs: [], cursor: undefined, hasMore: false });
      const client = createBlobStorageClient({ token: 'test-token' });

      const result = await client.list('unused-prefix/');

      expect(result).toEqual([]);
    });

    test('propagates errors from @vercel/blob list', async () => {
      fakeList.mockRejectedValue(new Error('list failed'));
      const client = createBlobStorageClient({ token: 'test-token' });

      await expect(client.list('book-1/')).rejects.toThrow('list failed');
    });
  });
});
