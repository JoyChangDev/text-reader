import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { listReports } from '@/app/_lib/pronunciationReports';

import ChakraProvider from '../_providers/chakra';
import PronunciationReportList from './PronunciationReportList';

vi.mock('@/app/_lib/pronunciationReports', () => ({
  listReports: vi.fn(),
}));

function renderList() {
  return render(
    <ChakraProvider>
      <PronunciationReportList />
    </ChakraProvider>,
  );
}

describe('PronunciationReportList', () => {
  beforeEach(() => {
    listReports.mockReset();
  });

  test('shows a friendly empty state when there are no reports', async () => {
    listReports.mockResolvedValue([]);

    renderList();

    expect(await screen.findByText('目前尚無發音回報。')).toBeInTheDocument();
  });

  test('lists every report with its book, phrase, and description', async () => {
    listReports.mockResolvedValue([
      {
        bookTitle: 'First Book',
        phrase: '你好',
        description: 'sounds off',
        reportedAt: '2026-07-30T12:00:00.000Z',
      },
    ]);

    renderList();

    expect(await screen.findByText('First Book')).toBeInTheDocument();
    expect(screen.getByText('你好')).toBeInTheDocument();
    expect(screen.getByText('sounds off')).toBeInTheDocument();
    expect(screen.getByText('2026-07-30 12:00')).toBeInTheDocument();
  });

  test('shows a placeholder when a report has no description', async () => {
    listReports.mockResolvedValue([
      {
        bookTitle: 'First Book',
        phrase: '你好',
        description: null,
        reportedAt: '2026-07-30T12:00:00.000Z',
      },
    ]);

    renderList();

    expect(await screen.findByText('未提供描述')).toBeInTheDocument();
  });

  test('shows the total report count', async () => {
    listReports.mockResolvedValue([
      { bookTitle: 'A', phrase: '一', description: null, reportedAt: '2026-07-30T09:00:00.000Z' },
      { bookTitle: 'B', phrase: '二', description: null, reportedAt: '2026-07-30T10:00:00.000Z' },
    ]);

    renderList();

    expect(await screen.findByText('共 2 筆回報，依最新排序')).toBeInTheDocument();
  });

  test('renders reports in the order returned by listReports, without re-sorting client-side', async () => {
    listReports.mockResolvedValue([
      {
        bookTitle: 'Newer',
        phrase: '新',
        description: null,
        reportedAt: '2026-07-30T12:00:00.000Z',
      },
      {
        bookTitle: 'Older',
        phrase: '舊',
        description: null,
        reportedAt: '2026-07-30T09:00:00.000Z',
      },
    ]);

    renderList();

    await waitFor(() => expect(screen.getByText('Newer')).toBeInTheDocument());
    const titles = screen.getAllByText(/Newer|Older/).map((el) => el.textContent);
    expect(titles).toEqual(['Newer', 'Older']);
  });
});
