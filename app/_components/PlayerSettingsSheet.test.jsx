import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import ChakraProvider from '../_providers/chakra';
import { ColorModeProvider } from '../_providers/colorMode';
import PlayerSettingsSheet from './PlayerSettingsSheet';

const baseProps = {
  voice: 'zh-TW-HsiaoChenNeural',
  onVoiceChange: () => {},
  speed: 1,
  onSpeedChange: () => {},
  disabled: false,
};

function renderSheet(overrides = {}) {
  return render(
    <ColorModeProvider>
      <ChakraProvider>
        <PlayerSettingsSheet {...baseProps} {...overrides} />
      </ChakraProvider>
    </ColorModeProvider>,
  );
}

function openSheet() {
  fireEvent.click(screen.getByRole('button', { name: /^設定$/i }));
}

describe('PlayerSettingsSheet', () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('starts collapsed, showing only the settings toggle', () => {
    renderSheet();

    expect(screen.getByRole('button', { name: /^設定$/i })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: /朗讀聲音/i })).not.toBeInTheDocument();
  });

  test('opens to reveal the voice, speed, and appearance controls', () => {
    renderSheet();
    openSheet();

    expect(screen.getByRole('radiogroup', { name: /朗讀聲音/i })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /播放速度/i })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /^外觀主題$/i })).toBeInTheDocument();
  });

  test('clicking the toggle again collapses it', () => {
    renderSheet();
    openSheet();

    fireEvent.click(screen.getByRole('button', { name: /^設定$/i }));

    expect(screen.queryByRole('radiogroup', { name: /朗讀聲音/i })).not.toBeInTheDocument();
  });

  test('the close button collapses it', () => {
    renderSheet();
    openSheet();

    fireEvent.click(screen.getByRole('button', { name: /關閉設定/i }));

    expect(screen.queryByRole('radiogroup', { name: /朗讀聲音/i })).not.toBeInTheDocument();
  });

  test('offers the voice picker with the current value selected, and reports changes', () => {
    const onVoiceChange = vi.fn();
    renderSheet({ voice: 'zh-TW-YunJheNeural', onVoiceChange });
    openSheet();

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
    renderSheet({ speed: 1.5, onSpeedChange });
    openSheet();

    const group = screen.getByRole('radiogroup', { name: /播放速度/i });
    expect(within(group).getByRole('radio', { name: '1.5x' })).toBeChecked();

    fireEvent.click(within(group).getByRole('radio', { name: '2x' }));

    expect(onSpeedChange).toHaveBeenCalledTimes(1);
  });

  test('disables the voice and speed pickers when disabled, but not preview or appearance', () => {
    renderSheet({ disabled: true });
    openSheet();

    const voiceGroup = screen.getByRole('radiogroup', { name: /朗讀聲音/i });
    within(voiceGroup)
      .getAllByRole('radio')
      .forEach((radio) => expect(radio).toBeDisabled());

    const speedGroup = screen.getByRole('radiogroup', { name: /播放速度/i });
    within(speedGroup)
      .getAllByRole('radio')
      .forEach((radio) => expect(radio).toBeDisabled());

    expect(screen.getByRole('button', { name: /試聽 hsiao-chen/i })).toBeEnabled();
  });

  // Full preview behavior is covered by VoicePreview's own tests - this just confirms
  // it's wired in here, using the shared implementation (see ticket 06).
  test('offers voice preview, built on the shared VoicePreview component', async () => {
    renderSheet();
    openSheet();

    fireEvent.click(screen.getByRole('button', { name: /試聽 yun-jhe/i }));

    expect(screen.getByTestId('voice-preview-audio').src).toContain(
      '/voice-samples/zh-TW-YunJheNeural.mp3',
    );
    expect(await screen.findByRole('button', { name: /停止 yun-jhe/i })).toBeInTheDocument();
  });

  // Full theme-switching behavior is covered by ThemeToggle's own tests - this just
  // confirms it's wired in here, using the shared implementation.
  test('offers the appearance picker, built on the shared ThemeToggle component', () => {
    renderSheet();
    openSheet();

    expect(screen.getByRole('radiogroup', { name: /^外觀主題$/i })).toBeInTheDocument();
  });

  test('caps the panel at a comfortable reading width while the backdrop stays full-viewport', () => {
    renderSheet();
    openSheet();

    expect(screen.getByTestId('settings-sheet-panel')).toHaveStyle({ maxWidth: '640px' });
    expect(screen.getByTestId('settings-sheet-backdrop')).toHaveStyle({ inset: '0px' });
  });

  test("hides the panel's native scrollbar while it stays scrollable", () => {
    renderSheet();
    openSheet();

    const panel = screen.getByTestId('settings-sheet-panel');
    expect(panel).toHaveStyle({ overflowY: 'auto' });
    expect(getComputedStyle(panel).scrollbarWidth).toBe('none');
  });
});
