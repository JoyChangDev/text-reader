import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { cleanupBlobs, getUsage } from '@/app/_lib/blobUsage';

import ChakraProvider from '../_providers/chakra';
import BlobUsageIndicator from './BlobUsageIndicator';

vi.mock('@/app/_lib/blobUsage', () => ({
  getUsage: vi.fn(),
  cleanupBlobs: vi.fn(),
}));

describe('BlobUsageIndicator', () => {
  beforeEach(() => {
    getUsage.mockReset();
    cleanupBlobs.mockReset();
  });

  test('shows the current usage percent', async () => {
    getUsage.mockResolvedValue({ usedBytes: 50, quotaBytes: 100, percent: 50 });

    render(
      <ChakraProvider>
        <BlobUsageIndicator />
      </ChakraProvider>,
    );

    expect(await screen.findByText(/50%/)).toBeInTheDocument();
  });

  test('clicking "clean up now" triggers cleanup and refreshes the usage', async () => {
    getUsage
      .mockResolvedValueOnce({ usedBytes: 50, quotaBytes: 100, percent: 50 })
      .mockResolvedValueOnce({ usedBytes: 10, quotaBytes: 100, percent: 10 });
    cleanupBlobs.mockResolvedValue({ deleted: ['book-1/0/voice-a.mp3'] });

    render(
      <ChakraProvider>
        <BlobUsageIndicator />
      </ChakraProvider>,
    );
    await screen.findByText(/50%/);

    fireEvent.click(screen.getByRole('button', { name: /clean up now/i }));

    expect(cleanupBlobs).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/10%/)).toBeInTheDocument());
  });

  test('re-enables the button and logs the error when cleanup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    getUsage.mockResolvedValue({ usedBytes: 50, quotaBytes: 100, percent: 50 });
    cleanupBlobs.mockRejectedValue(new Error('cleanup failed'));

    render(
      <ChakraProvider>
        <BlobUsageIndicator />
      </ChakraProvider>,
    );
    await screen.findByText(/50%/);

    fireEvent.click(screen.getByRole('button', { name: /clean up now/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /clean up now/i })).toBeEnabled(),
    );
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
