import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { logDiagnosticEvent } from '@/app/_lib/backgroundDiagnostics';

import ChakraProvider from '../_providers/chakra';
import BackgroundDiagnosticsPanel from './BackgroundDiagnosticsPanel';

describe('BackgroundDiagnosticsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete navigator.clipboard;
  });

  test('starts collapsed, showing the recorded entry count', async () => {
    logDiagnosticEvent('focus');
    logDiagnosticEvent('visibilitychange', { visibilityState: 'hidden' });

    render(
      <ChakraProvider>
        <BackgroundDiagnosticsPanel />
      </ChakraProvider>,
    );

    expect(await screen.findByRole('button', { name: '除錯記錄（2）' })).toBeInTheDocument();
    expect(screen.queryByText(/清除記錄/)).not.toBeInTheDocument();
  });

  test('expands to show logged entries, most recent first', async () => {
    logDiagnosticEvent('focus');
    logDiagnosticEvent('visibilitychange', { visibilityState: 'hidden' });

    render(
      <ChakraProvider>
        <BackgroundDiagnosticsPanel />
      </ChakraProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '除錯記錄（2）' }));

    const entries = screen.getAllByText(/visibilitychange|focus/);
    expect(entries[0]).toHaveTextContent('visibilitychange');
    expect(entries[1]).toHaveTextContent('focus');
  });

  test('shows a placeholder when nothing has been logged yet', async () => {
    render(
      <ChakraProvider>
        <BackgroundDiagnosticsPanel />
      </ChakraProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '除錯記錄（0）' }));

    expect(screen.getByText('（尚無記錄）')).toBeInTheDocument();
  });

  test('清除記錄 clears the log and the displayed entries', async () => {
    logDiagnosticEvent('focus');

    render(
      <ChakraProvider>
        <BackgroundDiagnosticsPanel />
      </ChakraProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '除錯記錄（1）' }));
    fireEvent.click(screen.getByRole('button', { name: '清除記錄' }));

    expect(screen.getByText('（尚無記錄）')).toBeInTheDocument();
  });

  test('複製記錄 copies the log to the clipboard and confirms success', async () => {
    logDiagnosticEvent('focus');
    const writeText = vi.fn().mockResolvedValue(undefined);
    navigator.clipboard = { writeText };

    render(
      <ChakraProvider>
        <BackgroundDiagnosticsPanel />
      </ChakraProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '除錯記錄（1）' }));
    fireEvent.click(screen.getByRole('button', { name: '複製記錄' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain('focus');
    expect(await screen.findByText('已複製')).toBeInTheDocument();
  });

  test('複製記錄 falls back to a selectable textarea when the Clipboard API fails', async () => {
    logDiagnosticEvent('focus');
    navigator.clipboard = { writeText: vi.fn().mockRejectedValue(new Error('denied')) };

    render(
      <ChakraProvider>
        <BackgroundDiagnosticsPanel />
      </ChakraProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '除錯記錄（1）' }));
    fireEvent.click(screen.getByRole('button', { name: '複製記錄' }));

    expect(await screen.findByText(/複製失敗/)).toBeInTheDocument();
    expect(screen.getByRole('textbox').value).toContain('focus');
  });

  test('複製記錄 is disabled when there is nothing to copy', async () => {
    render(
      <ChakraProvider>
        <BackgroundDiagnosticsPanel />
      </ChakraProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '除錯記錄（0）' }));

    expect(screen.getByRole('button', { name: '複製記錄' })).toBeDisabled();
  });
});
