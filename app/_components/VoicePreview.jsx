'use client';

import { Button } from '@chakra-ui/react';
import { useCallback, useRef, useState } from 'react';

import { AVAILABLE_VOICES, voiceSampleUrl } from '@/app/_lib/listenerSettings';

// A preview button per available voice, playing a short, pre-generated sample clip (see
// scripts/generate-voice-samples.mjs) through its own <audio> element - never touches
// the persisted voice selection, calls edge-tts, or requests /api/audio-chunks (see
// ticket 03). Self-contained (owns its own preview state/ref) so it can be dropped into
// both the upload/library screen, before any book is open, and PlayerBar, inside the
// player, without either call site owning the preview state (see ticket 06). Renders no
// wrapping layout of its own, so each call site controls how the buttons sit alongside
// its other controls.
export default function VoicePreview() {
  const [previewingVoice, setPreviewingVoice] = useState(null);
  const previewAudioRef = useRef(null);

  const togglePreviewVoice = useCallback(
    (voiceValue) => {
      const previewAudio = previewAudioRef.current;
      if (!previewAudio) return;

      if (previewingVoice === voiceValue) {
        previewAudio.pause();
        setPreviewingVoice(null);
        return;
      }

      previewAudio.src = voiceSampleUrl(voiceValue);
      previewAudio.play();
      setPreviewingVoice(voiceValue);
    },
    [previewingVoice],
  );

  const handlePreviewEnded = useCallback(() => setPreviewingVoice(null), []);

  return (
    <>
      {AVAILABLE_VOICES.map((option) => (
        <Button
          key={option.value}
          size="sm"
          variant="outline"
          onClick={() => togglePreviewVoice(option.value)}
        >
          {previewingVoice === option.value ? `Stop ${option.label}` : `Preview ${option.label}`}
        </Button>
      ))}
      <audio ref={previewAudioRef} onEnded={handlePreviewEnded} data-testid="voice-preview-audio" />
    </>
  );
}
