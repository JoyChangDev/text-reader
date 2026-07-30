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
  fireEvent.click(screen.getByRole('button', { name: /^settings$/i }));
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

    expect(screen.getByRole('button', { name: /^settings$/i })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: /narration voice/i })).not.toBeInTheDocument();
  });

  test('opens to reveal the voice, speed, and appearance controls', () => {
    renderSheet();
    openSheet();

    expect(screen.getByRole('radiogroup', { name: /narration voice/i })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /playback speed/i })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /^theme$/i })).toBeInTheDocument();
  });

  test('clicking the toggle again collapses it', () => {
    renderSheet();
    openSheet();

    fireEvent.click(screen.getByRole('button', { name: /^settings$/i }));

    expect(screen.queryByRole('radiogroup', { name: /narration voice/i })).not.toBeInTheDocument();
  });

  test('the close button collapses it', () => {
    renderSheet();
    openSheet();

    fireEvent.click(screen.getByRole('button', { name: /close settings/i }));

    expect(screen.queryByRole('radiogroup', { name: /narration voice/i })).not.toBeInTheDocument();
  });

  test('offers the voice picker with the current value selected, and reports changes', () => {
    const onVoiceChange = vi.fn();
    renderSheet({ voice: 'zh-TW-YunJheNeural', onVoiceChange });
    openSheet();

    const group = screen.getByRole('radiogroup', { name: /narration voice/i });
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

    const group = screen.getByRole('radiogroup', { name: /playback speed/i });
    expect(within(group).getByRole('radio', { name: '1.5x' })).toBeChecked();

    fireEvent.click(within(group).getByRole('radio', { name: '2x' }));

    expect(onSpeedChange).toHaveBeenCalledTimes(1);
  });

  test('disables the voice and speed pickers when disabled, but not preview or appearance', () => {
    renderSheet({ disabled: true });
    openSheet();

    const voiceGroup = screen.getByRole('radiogroup', { name: /narration voice/i });
    within(voiceGroup)
      .getAllByRole('radio')
      .forEach((radio) => expect(radio).toBeDisabled());

    const speedGroup = screen.getByRole('radiogroup', { name: /playback speed/i });
    within(speedGroup)
      .getAllByRole('radio')
      .forEach((radio) => expect(radio).toBeDisabled());

    expect(screen.getByRole('button', { name: /preview hsiao-chen/i })).toBeEnabled();
  });

  // Full preview behavior is covered by VoicePreview's own tests - this just confirms
  // it's wired in here, using the shared implementation (see ticket 06).
  test('offers voice preview, built on the shared VoicePreview component', async () => {
    renderSheet();
    openSheet();

    fireEvent.click(screen.getByRole('button', { name: /preview yun-jhe/i }));

    expect(screen.getByTestId('voice-preview-audio').src).toContain(
      '/voice-samples/zh-TW-YunJheNeural.mp3',
    );
    expect(await screen.findByRole('button', { name: /stop yun-jhe/i })).toBeInTheDocument();
  });

  // Full theme-switching behavior is covered by ThemeToggle's own tests - this just
  // confirms it's wired in here, using the shared implementation.
  test('offers the appearance picker, built on the shared ThemeToggle component', () => {
    renderSheet();
    openSheet();

    expect(screen.getByRole('radiogroup', { name: /^theme$/i })).toBeInTheDocument();
  });
});
