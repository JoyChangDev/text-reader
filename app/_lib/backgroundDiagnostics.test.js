import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  clearDiagnosticLog,
  formatDiagnosticLog,
  getDiagnosticLog,
  logDiagnosticEvent,
} from './backgroundDiagnostics';

describe('backgroundDiagnostics', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('returns an empty log when nothing has been recorded', () => {
    expect(getDiagnosticLog()).toEqual([]);
  });

  test('records an event with its type, detail, and a timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    logDiagnosticEvent('visibilitychange', { visibilityState: 'hidden' });

    expect(getDiagnosticLog()).toEqual([
      { type: 'visibilitychange', detail: { visibilityState: 'hidden' }, timestamp: 1000 },
    ]);
    vi.useRealTimers();
  });

  test('appends events in order across multiple calls', () => {
    logDiagnosticEvent('focus');
    logDiagnosticEvent('reconcile', { correctedIsPlaying: true });

    expect(getDiagnosticLog().map((entry) => entry.type)).toEqual(['focus', 'reconcile']);
  });

  test('caps the log at 50 entries, dropping the oldest first', () => {
    for (let i = 0; i < 55; i += 1) {
      logDiagnosticEvent('reconcile', { i });
    }

    const log = getDiagnosticLog();
    expect(log).toHaveLength(50);
    expect(log[0].detail.i).toBe(5);
    expect(log.at(-1).detail.i).toBe(54);
  });

  test('clear removes every recorded event', () => {
    logDiagnosticEvent('focus');
    clearDiagnosticLog();

    expect(getDiagnosticLog()).toEqual([]);
  });

  test('formats the log as one line per entry, in the order given, with an ISO timestamp', () => {
    const entries = [
      { type: 'visibilitychange', detail: { visibilityState: 'hidden' }, timestamp: 1000 },
      { type: 'focus', detail: {}, timestamp: 2000 },
    ];

    expect(formatDiagnosticLog(entries)).toBe(
      `${new Date(1000).toISOString()} visibilitychange {"visibilityState":"hidden"}\n` +
        `${new Date(2000).toISOString()} focus {}`,
    );
  });

  test('formats an empty log as an empty string', () => {
    expect(formatDiagnosticLog([])).toBe('');
  });
});
