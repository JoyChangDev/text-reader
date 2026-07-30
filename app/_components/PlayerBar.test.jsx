import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import ChakraProvider from '../_providers/chakra';
import PlayerBar from './PlayerBar';

const baseProps = {
  isPlaying: false,
  currentChunkReady: true,
  currentChunkErrored: false,
  onPlay: () => {},
  onPause: () => {},
  onRetry: () => {},
  onJumpToNowPlaying: () => {},
  scrollPercent: 0,
  onScrollPercentChange: () => {},
  voice: 'zh-TW-HsiaoChenNeural',
  onVoiceChange: () => {},
  speed: 1,
  onSpeedChange: () => {},
  reportMode: false,
  onToggleReportMode: () => {},
};

function renderBar(overrides = {}) {
  return render(
    <ChakraProvider>
      <PlayerBar {...baseProps} {...overrides} />
    </ChakraProvider>,
  );
}

function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: /^設定$/i }));
}

describe('PlayerBar', () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('never renders chunk-index text, in any state', () => {
    const { rerender } = renderBar();
    expect(screen.queryByText(/chunk/i)).not.toBeInTheDocument();

    rerender(
      <ChakraProvider>
        <PlayerBar {...baseProps} isPlaying />
      </ChakraProvider>,
    );
    expect(screen.queryByText(/chunk/i)).not.toBeInTheDocument();

    rerender(
      <ChakraProvider>
        <PlayerBar {...baseProps} currentChunkErrored currentChunkReady={false} />
      </ChakraProvider>,
    );
    expect(screen.queryByText(/^chunk /i)).not.toBeInTheDocument();
  });

  test('shows an enabled play control when the current chunk is ready, and calls onPlay', () => {
    const onPlay = vi.fn();
    renderBar({ isPlaying: false, currentChunkReady: true, onPlay });

    const playButton = screen.getByRole('button', { name: /^播放$/i });
    expect(playButton).toBeEnabled();
    fireEvent.click(playButton);

    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  test('disables play while the current chunk is not ready', () => {
    renderBar({ currentChunkReady: false });

    expect(screen.getByRole('button', { name: /^播放$/i })).toBeDisabled();
  });

  test('shows pause while playing, and calls onPause', () => {
    const onPause = vi.fn();
    renderBar({ isPlaying: true, onPause });

    const pauseButton = screen.getByRole('button', { name: /暫停/i });
    fireEvent.click(pauseButton);

    expect(onPause).toHaveBeenCalledTimes(1);
  });

  test('shows a retry control and error message when the current chunk errored, instead of play', () => {
    const onRetry = vi.fn();
    renderBar({ currentChunkErrored: true, currentChunkReady: false, onRetry });

    expect(screen.queryByRole('button', { name: /^播放$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/語音產生失敗/i);

    fireEvent.click(screen.getByRole('button', { name: /重試/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('offers a jump-to-now-playing control, calling onJumpToNowPlaying', () => {
    const onJumpToNowPlaying = vi.fn();
    renderBar({ onJumpToNowPlaying });

    fireEvent.click(screen.getByRole('button', { name: /跳到目前播放位置/i }));

    expect(onJumpToNowPlaying).toHaveBeenCalledTimes(1);
  });

  test('the report toggle sits next to settings, and "jump to now playing"/play sit trailing, in that order', () => {
    renderBar();

    const buttonNames = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));

    expect(buttonNames).toEqual(['設定', '回報發音問題', '跳到目前播放位置', '播放']);
  });

  describe('report mode toggle', () => {
    test('reflects the current report-mode state', () => {
      const { rerender } = renderBar({ reportMode: false });
      expect(screen.getByRole('button', { name: /回報發音問題/i })).toHaveAttribute(
        'aria-pressed',
        'false',
      );

      rerender(
        <ChakraProvider>
          <PlayerBar {...baseProps} reportMode />
        </ChakraProvider>,
      );
      expect(screen.getByRole('button', { name: /回報發音問題/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    test('calls onToggleReportMode when clicked', () => {
      const onToggleReportMode = vi.fn();
      renderBar({ onToggleReportMode });

      fireEvent.click(screen.getByRole('button', { name: /回報發音問題/i }));

      expect(onToggleReportMode).toHaveBeenCalledTimes(1);
    });
  });

  test('shows the scroll-position indicator at the given percentage, independent of chunk/playback progress', () => {
    renderBar({ scrollPercent: 40 });

    expect(screen.getByRole('slider', { name: /文字位置/i })).toHaveValue('40');
  });

  test('dragging the scroll-position indicator reports the target percentage', () => {
    const onScrollPercentChange = vi.fn();
    renderBar({ onScrollPercentChange });

    fireEvent.change(screen.getByRole('slider', { name: /文字位置/i }), {
      target: { value: '65' },
    });

    expect(onScrollPercentChange).toHaveBeenCalledWith(65);
  });

  // Voice, speed, preview, and appearance all collapse behind the Settings disclosure
  // (see PlayerSettingsSheet) so the persistent bar stays short - opening it surfaces
  // the same controls this bar used to render directly.
  describe('settings disclosure', () => {
    test('offers the voice picker with the current value selected, and reports changes', () => {
      const onVoiceChange = vi.fn();
      renderBar({ voice: 'zh-TW-YunJheNeural', onVoiceChange });
      openSettings();

      const group = screen.getByRole('radiogroup', { name: /朗讀聲音/i });
      expect(within(group).getByRole('radio', { name: 'Yun-Jhe' })).toBeChecked();
      expect(
        within(group)
          .getAllByRole('radio')
          .map((radio) => radio.value),
      ).toEqual(['zh-TW-HsiaoChenNeural', 'zh-TW-YunJheNeural', 'zh-TW-HsiaoYuNeural']);

      fireEvent.click(within(group).getByRole('radio', { name: 'Hsiao-Yu' }));

      expect(onVoiceChange).toHaveBeenCalledTimes(1);
    });

    test('offers the speed picker with the current value selected, and reports changes', () => {
      const onSpeedChange = vi.fn();
      renderBar({ speed: 1.5, onSpeedChange });
      openSettings();

      const group = screen.getByRole('radiogroup', { name: /播放速度/i });
      expect(within(group).getByRole('radio', { name: '1.5x' })).toBeChecked();

      fireEvent.click(within(group).getByRole('radio', { name: '2x' }));

      expect(onSpeedChange).toHaveBeenCalledTimes(1);
    });

    test('enables the voice and speed pickers while paused', () => {
      renderBar({ isPlaying: false });
      openSettings();

      const voiceGroup = screen.getByRole('radiogroup', { name: /朗讀聲音/i });
      within(voiceGroup)
        .getAllByRole('radio')
        .forEach((radio) => expect(radio).toBeEnabled());

      const speedGroup = screen.getByRole('radiogroup', { name: /播放速度/i });
      within(speedGroup)
        .getAllByRole('radio')
        .forEach((radio) => expect(radio).toBeEnabled());
    });

    test('disables the voice and speed pickers while playing', () => {
      renderBar({ isPlaying: true });
      openSettings();

      const voiceGroup = screen.getByRole('radiogroup', { name: /朗讀聲音/i });
      within(voiceGroup)
        .getAllByRole('radio')
        .forEach((radio) => expect(radio).toBeDisabled());

      const speedGroup = screen.getByRole('radiogroup', { name: /播放速度/i });
      within(speedGroup)
        .getAllByRole('radio')
        .forEach((radio) => expect(radio).toBeDisabled());
    });

    // Full preview behavior (toggling, switching voices, resetting on end) is covered by
    // VoicePreview's own tests - this just confirms it's actually wired in here, using
    // the shared implementation rather than a separate copy (see ticket 06).
    test('offers voice preview, built on the shared VoicePreview component', async () => {
      renderBar();
      openSettings();

      const previewButton = screen.getByRole('button', { name: /試聽 yun-jhe/i });
      fireEvent.click(previewButton);

      expect(screen.getByTestId('voice-preview-audio').src).toContain(
        '/voice-samples/zh-TW-YunJheNeural.mp3',
      );
      expect(await screen.findByRole('button', { name: /停止 yun-jhe/i })).toBeInTheDocument();
    });
  });
});
