import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { AVAILABLE_VOICES } from '@/app/_lib/listenerSettings';

import ChakraProvider from '../_providers/chakra';
import { useVoicePreview, VoicePreviewButton } from './VoicePreview';

// Stands in for a real call site (see PlayerSettingsSheet) - one shared hook instance,
// one VoicePreviewButton per voice, and the single <audio> element every button preview
// plays through.
function VoicePreviewHarness() {
  const { previewingVoice, togglePreviewVoice, audioProps } = useVoicePreview();

  return (
    <>
      {AVAILABLE_VOICES.map((voice) => (
        <VoicePreviewButton
          key={voice.value}
          voice={voice}
          previewingVoice={previewingVoice}
          onToggle={togglePreviewVoice}
        />
      ))}
      <audio {...audioProps} />
    </>
  );
}

function renderPreview() {
  return render(
    <ChakraProvider>
      <VoicePreviewHarness />
    </ChakraProvider>,
  );
}

// Mirrors PlayerSettingsSheet's actual layout: each voice's preview button sits inside
// the <label> that wraps that voice's own radio input.
function LabelWrappedPreview({ voice }) {
  const { previewingVoice, togglePreviewVoice, audioProps } = useVoicePreview();

  return (
    <label>
      <input type="radio" name="decoy" defaultChecked={false} />
      <VoicePreviewButton
        voice={voice}
        previewingVoice={previewingVoice}
        onToggle={togglePreviewVoice}
      />
      <audio {...audioProps} />
    </label>
  );
}

describe('useVoicePreview / VoicePreviewButton', () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('offers a preview button for every available voice', () => {
    renderPreview();

    expect(screen.getByRole('button', { name: /preview hsiao-chen/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preview yun-jhe/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preview hsiao-yu/i })).toBeInTheDocument();
  });

  test('plays the static sample clip for a voice, labeling the button to stop it', async () => {
    renderPreview();

    const previewButton = screen.getByRole('button', { name: /preview yun-jhe/i });
    fireEvent.click(previewButton);

    const previewAudioEl = screen.getByTestId('voice-preview-audio');
    expect(previewAudioEl.src).toContain('/voice-samples/zh-TW-YunJheNeural.mp3');
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: /stop yun-jhe/i })).toBeInTheDocument();
  });

  test('clicking the same preview button again stops the sample clip', async () => {
    renderPreview();

    fireEvent.click(screen.getByRole('button', { name: /preview hsiao-yu/i }));
    await screen.findByRole('button', { name: /stop hsiao-yu/i });

    fireEvent.click(screen.getByRole('button', { name: /stop hsiao-yu/i }));

    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: /preview hsiao-yu/i })).toBeInTheDocument();
  });

  test('previewing a different voice while one is already playing switches to the new clip', async () => {
    renderPreview();

    fireEvent.click(screen.getByRole('button', { name: /preview yun-jhe/i }));
    await screen.findByRole('button', { name: /stop yun-jhe/i });

    fireEvent.click(screen.getByRole('button', { name: /preview hsiao-yu/i }));

    const previewAudioEl = screen.getByTestId('voice-preview-audio');
    expect(previewAudioEl.src).toContain('/voice-samples/zh-TW-HsiaoYuNeural.mp3');
    expect(await screen.findByRole('button', { name: /stop hsiao-yu/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preview yun-jhe/i })).toBeInTheDocument();
  });

  test('resets to the preview label once the sample clip finishes on its own', async () => {
    renderPreview();

    fireEvent.click(screen.getByRole('button', { name: /preview hsiao-chen/i }));
    await screen.findByRole('button', { name: /stop hsiao-chen/i });

    fireEvent.ended(screen.getByTestId('voice-preview-audio'));

    expect(await screen.findByRole('button', { name: /preview hsiao-chen/i })).toBeInTheDocument();
  });

  test("clicking preview inside a label does not activate that label's associated control", () => {
    render(
      <ChakraProvider>
        <LabelWrappedPreview voice={AVAILABLE_VOICES[0]} />
      </ChakraProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /preview/i }));

    expect(screen.getByRole('radio')).not.toBeChecked();
  });
});
