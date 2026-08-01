import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';

import { logDiagnosticEvent } from '@/app/_lib/backgroundDiagnostics';

import ChakraProvider from '../_providers/chakra';
import BackgroundDiagnosticsPanel from './BackgroundDiagnosticsPanel';

describe('BackgroundDiagnosticsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
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
});
