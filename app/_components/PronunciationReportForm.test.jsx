import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { submitReport } from '@/app/_lib/pronunciationReports';

import ChakraProvider from '../_providers/chakra';
import PronunciationReportForm from './PronunciationReportForm';

vi.mock('@/app/_lib/pronunciationReports', () => ({
  submitReport: vi.fn(),
}));

function renderForm(overrides = {}) {
  return render(
    <ChakraProvider>
      <PronunciationReportForm
        phrase="第一句"
        bookTitle="First Book"
        onDismiss={() => {}}
        {...overrides}
      />
    </ChakraProvider>,
  );
}

describe('PronunciationReportForm', () => {
  beforeEach(() => {
    submitReport.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('renders as a centered modal - full-viewport backdrop behind a centered card - pre-filled with the phrase and book title', () => {
    renderForm();

    expect(screen.getByTestId('pronunciation-report-backdrop')).toHaveStyle({ inset: '0px' });
    expect(screen.getByTestId('pronunciation-report-modal')).toBeInTheDocument();
    expect(screen.getByText('第一句')).toBeInTheDocument();
    expect(screen.getByText('First Book')).toBeInTheDocument();
  });

  test("places 「送出」centered and 「取消」aligned to the right of the modal's action row", () => {
    renderForm();

    const submitButton = screen.getByRole('button', { name: '送出' });
    const cancelButton = screen.getByRole('button', { name: '取消' });

    expect(submitButton).toHaveStyle({ left: '50%' });
    expect(cancelButton).toBeInTheDocument();
  });

  test('submits the phrase, book title, and description entered', async () => {
    submitReport.mockResolvedValueOnce({
      bookTitle: 'First Book',
      phrase: '第一句',
      description: 'sounds off',
      reportedAt: '2026-07-30T12:00:00.000Z',
    });

    renderForm();

    fireEvent.change(screen.getByLabelText(/描述/), { target: { value: 'sounds off' } });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    expect(submitReport).toHaveBeenCalledWith({
      bookTitle: 'First Book',
      phrase: '第一句',
      description: 'sounds off',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('謝謝，我們會盡快查看。');
  });

  test('a successful submission exits report mode on its own, without a further click', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    submitReport.mockResolvedValueOnce({
      bookTitle: 'First Book',
      phrase: '第一句',
      description: '',
      reportedAt: '2026-07-30T12:00:00.000Z',
    });
    const onDismiss = vi.fn();
    renderForm({ onDismiss });

    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    await vi.waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(onDismiss).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test('shows an error and re-enables the form when submitting fails, without exiting report mode', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    submitReport.mockRejectedValueOnce(new Error('Submitting the pronunciation report failed'));
    const onDismiss = vi.fn();
    renderForm({ onDismiss });

    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '送出' })).toBeEnabled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test('clicking 取消 dismisses without submitting', () => {
    const onDismiss = vi.fn();
    renderForm({ onDismiss });

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(submitReport).not.toHaveBeenCalled();
  });

  test('clicking the backdrop dismisses without submitting', () => {
    const onDismiss = vi.fn();
    renderForm({ onDismiss });

    fireEvent.click(screen.getByTestId('pronunciation-report-backdrop'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(submitReport).not.toHaveBeenCalled();
  });
});
