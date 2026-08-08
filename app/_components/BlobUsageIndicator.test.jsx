import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { cleanupBlobs, getUsage } from '@/app/_lib/blobUsage';

import ChakraProvider from '../_providers/chakra';
import BlobUsageIndicator from './BlobUsageIndicator';

vi.mock('@/app/_lib/blobUsage', () => ({
  getUsage: vi.fn(),
  cleanupBlobs: vi.fn(),
}));

function renderIndicator() {
  render(
    <ChakraProvider>
      <BlobUsageIndicator />
    </ChakraProvider>,
  );
}

// Reveals the usage the way a Listener does. Mounting deliberately doesn't - see ticket 09.
async function checkUsage() {
  fireEvent.click(screen.getByRole('button', { name: /查看用量/ }));
  return screen.findByText(/%/);
}

describe('BlobUsageIndicator', () => {
  beforeEach(() => {
    getUsage.mockReset();
    cleanupBlobs.mockReset();
  });

  test('does not read the Blob store just because the page rendered', () => {
    renderIndicator();

    expect(getUsage).not.toHaveBeenCalled();
  });

  test('shows the current usage percent once the Listener asks for it', async () => {
    getUsage.mockResolvedValue({ usedBytes: 50, quotaBytes: 100, percent: 50 });

    renderIndicator();
    await checkUsage();

    expect(screen.getByText(/50%/)).toBeInTheDocument();
  });

  test('leaves the control usable when the usage check fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    getUsage.mockRejectedValue(new Error('usage failed'));

    renderIndicator();
    fireEvent.click(screen.getByRole('button', { name: /查看用量/ }));

    await waitFor(() => expect(screen.getByRole('button', { name: /查看用量/ })).toBeEnabled());
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test('clicking "clean up now" triggers cleanup and refreshes the usage', async () => {
    getUsage
      .mockResolvedValueOnce({ usedBytes: 50, quotaBytes: 100, percent: 50 })
      .mockResolvedValueOnce({ usedBytes: 10, quotaBytes: 100, percent: 10 });
    cleanupBlobs.mockResolvedValue({ deleted: ['book-1/0/voice-a.mp3'] });

    renderIndicator();
    await checkUsage();

    fireEvent.click(screen.getByRole('button', { name: /立即清理/ }));

    expect(cleanupBlobs).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/10%/)).toBeInTheDocument());
  });

  test('re-enables the button and logs the error when cleanup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    getUsage.mockResolvedValue({ usedBytes: 50, quotaBytes: 100, percent: 50 });
    cleanupBlobs.mockRejectedValue(new Error('cleanup failed'));

    renderIndicator();
    await checkUsage();

    fireEvent.click(screen.getByRole('button', { name: /立即清理/ }));

    await waitFor(() => expect(screen.getByRole('button', { name: /立即清理/ })).toBeEnabled());
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
