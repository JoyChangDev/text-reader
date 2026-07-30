'use client';

import { IconButton } from '@chakra-ui/react';
import { useCallback, useRef, useState } from 'react';
import { FiPlay, FiSquare } from 'react-icons/fi';

import { voiceSampleUrl } from '@/app/_lib/listenerSettings';

// Exclusive-playback state for previewing a narration voice's static sample clip (see
// scripts/generate-voice-samples.mjs) through a single shared <audio> element - never
// touches the persisted voice selection, calls edge-tts, or requests /api/audio-chunks
// (see ticket 03). Returned as a hook (rather than a self-contained component) so a
// caller can render one VoicePreviewButton per voice wherever it needs to - e.g.
// inline in PlayerSettingsSheet's voice list (ticket 06) - while every button still
// shares the same "only one clip plays at a time" state and the same <audio> element.
// Callers render exactly one <audio> wired to `audioProps` per hook instance.
export function useVoicePreview() {
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

  return {
    previewingVoice,
    togglePreviewVoice,
    audioProps: {
      ref: previewAudioRef,
      onEnded: handlePreviewEnded,
      'data-testid': 'voice-preview-audio',
    },
  };
}

// A single voice's preview toggle (Play/Stop icon only, sized to sit inline next to a
// radio row) - `previewingVoice`/`onToggle` come from one shared useVoicePreview()
// instance so only one clip ever plays at a time across every button using it.
// Swallows the click before it bubbles to a default action: PlayerSettingsSheet's
// voice rows are each a <label> wrapping their radio input, and without this, clicking
// Preview would also activate that label's associated radio - previewing a voice must
// never change which one is selected.
export function VoicePreviewButton({ voice, previewingVoice, onToggle }) {
  const isPlaying = previewingVoice === voice.value;

  return (
    <IconButton
      aria-label={isPlaying ? `Stop ${voice.label}` : `Preview ${voice.label}`}
      size="xs"
      variant="outline"
      borderRadius="full"
      borderColor="hairlineStrong"
      flexShrink={0}
      onClick={(event) => {
        event.preventDefault();
        onToggle(voice.value);
      }}
    >
      {isPlaying ? <FiSquare /> : <FiPlay />}
    </IconButton>
  );
}
