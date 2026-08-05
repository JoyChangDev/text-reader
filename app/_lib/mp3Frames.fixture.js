// Shared test fixture: synthetic MP3 frames in the profile edge-tts actually produces
// (MPEG2 Layer III, 48kbps, 24000Hz, mono — "audio-24khz-48kbitrate-mono-mp3" in
// edgeTtsClient.js). Three test files need measurable audio bytes, and the header bytes and
// frame length are exactly the constants a change to mp3Frames.js would have to keep in step,
// so they live in one place rather than being copied per file.

// Its 576 samples per frame (MPEG1 Layer III has 1152) is what makes the frame length 144 by
// way of the samplesPerFrame/8 formula, not by the commonly copied constant of the same value.
export const MP3_FRAME_LENGTH = 144;
export const MP3_FRAME_DURATION_SECONDS = 576 / 24000;

export function buildMp3Frames(count) {
  const buffer = new Uint8Array(MP3_FRAME_LENGTH * count);
  for (let i = 0; i < count; i += 1) {
    // sync + MPEG2 + Layer III + no CRC, then bitrate index 6 (48kbps) + sample rate index 1.
    buffer.set([0xff, 0xf3, 0x64, 0x00], i * MP3_FRAME_LENGTH);
  }
  return buffer;
}
