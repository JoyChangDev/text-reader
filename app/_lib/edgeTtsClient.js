import { EdgeTTS } from 'edge-tts-universal';

// Pure Node/TypeScript port of edge-tts (no Python dependency) — the only file in the
// app's runtime that imports edge-tts-universal (the one-time scripts/generate-voice-samples.mjs
// imports it separately, offline). See .scratch/phase-1-audiobook-reader/issues/04-audio-generation-service.md.
export function createEdgeTtsClient() {
  return {
    async synthesize(text, voice) {
      const tts = new EdgeTTS(text, voice);
      const { audio, subtitle } = await tts.synthesize();

      return {
        audio,
        boundaries: subtitle.map(({ text: boundaryText, offset, duration }) => ({
          text: boundaryText,
          offset,
          duration,
        })),
      };
    },
  };
}
