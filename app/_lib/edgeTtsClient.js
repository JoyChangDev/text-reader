import { EdgeTTS } from 'edge-tts-universal';

// Pure Node/TypeScript port of edge-tts (no Python dependency) — the only file that
// imports edge-tts-universal. See .scratch/phase-1-audiobook-reader/issues/04-audio-generation-service.md.
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
