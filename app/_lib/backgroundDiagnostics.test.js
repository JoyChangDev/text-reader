import { beforeEach, describe, expect, test, vi } from 'vitest';

import { clearDiagnosticLog, getDiagnosticLog, logDiagnosticEvent } from './backgroundDiagnostics';

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
});
