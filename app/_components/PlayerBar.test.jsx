import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import ChakraProvider from '../_providers/chakra';
import PlayerBar from './PlayerBar';

const baseProps = {
  currentIndex: 0,
  totalChunks: 4,
  isPlaying: false,
  currentChunkReady: true,
  currentChunkErrored: false,
  onPlay: () => {},
  onPause: () => {},
  onRetry: () => {},
  voice: 'zh-TW-HsiaoChenNeural',
  onVoiceChange: () => {},
  speed: 1,
  onSpeedChange: () => {},
};

function renderBar(overrides = {}) {
  return render(
    <ChakraProvider>
      <PlayerBar {...baseProps} {...overrides} />
    </ChakraProvider>,
  );
}

describe('PlayerBar', () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('shows the current chunk position', () => {
    renderBar({ currentIndex: 1, totalChunks: 4 });

    expect(screen.getByText('Chunk 2 of 4')).toBeInTheDocument();
  });

  test('shows an enabled play control when the current chunk is ready, and calls onPlay', () => {
    const onPlay = vi.fn();
    renderBar({ isPlaying: false, currentChunkReady: true, onPlay });

    const playButton = screen.getByRole('button', { name: /^play$/i });
    expect(playButton).toBeEnabled();
    fireEvent.click(playButton);

    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  test('disables play while the current chunk is not ready', () => {
    renderBar({ currentChunkReady: false });

    expect(screen.getByRole('button', { name: /^play$/i })).toBeDisabled();
  });

  test('shows pause while playing, and calls onPause', () => {
    const onPause = vi.fn();
    renderBar({ isPlaying: true, onPause });

    const pauseButton = screen.getByRole('button', { name: /pause/i });
    fireEvent.click(pauseButton);

    expect(onPause).toHaveBeenCalledTimes(1);
  });

  test('shows a retry control and error message when the current chunk errored, instead of play', () => {
    const onRetry = vi.fn();
    renderBar({ currentChunkErrored: true, currentChunkReady: false, onRetry });

    expect(screen.queryByRole('button', { name: /^play$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't generate audio/i);

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('offers the voice picker with the current value selected, and reports changes', () => {
    const onVoiceChange = vi.fn();
    renderBar({ voice: 'zh-TW-YunJheNeural', onVoiceChange });

    const picker = screen.getByLabelText(/narration voice/i);
    expect(picker).toHaveValue('zh-TW-YunJheNeural');
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.value),
    ).toEqual(['zh-TW-HsiaoChenNeural', 'zh-TW-YunJheNeural', 'zh-TW-HsiaoYuNeural']);

    fireEvent.change(picker, { target: { value: 'zh-TW-HsiaoYuNeural' } });

    expect(onVoiceChange).toHaveBeenCalledTimes(1);
  });

  test('offers the speed picker with the current value selected, and reports changes', () => {
    const onSpeedChange = vi.fn();
    renderBar({ speed: 1.5, onSpeedChange });

    const picker = screen.getByLabelText(/playback speed/i);
    expect(picker).toHaveValue('1.5');
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.value),
    ).toEqual(['0.75', '1', '1.25', '1.5', '1.75', '2']);

    fireEvent.change(picker, { target: { value: '2' } });

    expect(onSpeedChange).toHaveBeenCalledTimes(1);
  });

  test('enables the voice and speed pickers while paused', () => {
    renderBar({ isPlaying: false });

    expect(screen.getByLabelText(/narration voice/i)).toBeEnabled();
    expect(screen.getByLabelText(/playback speed/i)).toBeEnabled();
  });

  test('disables the voice and speed pickers while playing', () => {
    renderBar({ isPlaying: true });

    expect(screen.getByLabelText(/narration voice/i)).toBeDisabled();
    expect(screen.getByLabelText(/playback speed/i)).toBeDisabled();
  });

  // Full preview behavior (toggling, switching voices, resetting on end) is covered by
  // VoicePreview's own tests - this just confirms it's actually wired in here, using
  // the shared implementation rather than a separate copy (see ticket 06).
  test('offers voice preview, built on the shared VoicePreview component', async () => {
    renderBar();

    const previewButton = screen.getByRole('button', { name: /preview yun-jhe/i });
    fireEvent.click(previewButton);

    expect(screen.getByTestId('voice-preview-audio').src).toContain(
      '/voice-samples/zh-TW-YunJheNeural.mp3',
    );
    expect(await screen.findByRole('button', { name: /stop yun-jhe/i })).toBeInTheDocument();
  });
});
