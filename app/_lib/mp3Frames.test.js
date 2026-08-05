import { describe, expect, test } from 'vitest';

import { measureMp3Duration } from './mp3Frames';
import { buildMp3Frames, MP3_FRAME_DURATION_SECONDS } from './mp3Frames.fixture';

// MPEG1 Layer III, 128kbps, 44100Hz, no padding, no CRC.
// frameLength = floor(144 * 128000 / 44100) = 417 bytes; duration = 1152 / 44100 s.
const FRAME_LENGTH = 417;
const FRAME_DURATION_SECONDS = 1152 / 44100;

function buildFrame() {
  const frame = new Uint8Array(FRAME_LENGTH);
  frame[0] = 0xff;
  frame[1] = 0xfb; // sync + MPEG1 + Layer III + no CRC
  frame[2] = 0x90; // bitrate index 9 (128kbps) + sample rate index 0 (44100Hz)
  frame[3] = 0x00;
  return frame;
}

function buildFrames(count) {
  const buffer = new Uint8Array(FRAME_LENGTH * count);
  for (let i = 0; i < count; i += 1) {
    buffer.set(buildFrame(), i * FRAME_LENGTH);
  }
  return buffer;
}

function buildId3v2Header(dataSize) {
  const header = new Uint8Array(10);
  header[0] = 0x49; // 'I'
  header[1] = 0x44; // 'D'
  header[2] = 0x33; // '3'
  header[3] = 0x03; // version
  header[4] = 0x00;
  header[5] = 0x00; // flags, no footer
  header[6] = (dataSize >> 21) & 0x7f;
  header[7] = (dataSize >> 14) & 0x7f;
  header[8] = (dataSize >> 7) & 0x7f;
  header[9] = dataSize & 0x7f;
  return header;
}

function concatBytes(...chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

describe('measureMp3Duration', () => {
  test('sums frame durations for a fixture of known duration', () => {
    const bytes = buildFrames(10);

    const duration = measureMp3Duration(bytes);

    expect(duration).toBeCloseTo(10 * FRAME_DURATION_SECONDS, 10);
  });

  test('skips a leading ID3v2 tag rather than treating it as frame data', () => {
    const tagData = new Uint8Array(100).fill(0xab);
    const bytes = concatBytes(buildId3v2Header(tagData.length), tagData, buildFrames(10));

    const duration = measureMp3Duration(bytes);

    expect(duration).toBeCloseTo(10 * FRAME_DURATION_SECONDS, 10);
  });

  test('returns only the complete frames it could measure from a truncated file', () => {
    const fullBuffer = buildFrames(10);
    // Cut into the 10th frame's payload so 9 frames are complete and the 10th isn't.
    const truncated = fullBuffer.slice(0, fullBuffer.length - 10);

    const duration = measureMp3Duration(truncated);

    expect(duration).toBeCloseTo(9 * FRAME_DURATION_SECONDS, 10);
  });

  // The profile edge-tts actually produces. Its samples-per-frame (576) differs from
  // MPEG1/Layer2-3's 1152, which is what exposed the frame-length miscalculation this case
  // guards against — and mp3Frames.js was checked against ffprobe on real edge-tts output.
  test('sums frame durations for the MPEG2 Layer III profile edge-tts actually produces', () => {
    const bytes = buildMp3Frames(20);

    const duration = measureMp3Duration(bytes);

    expect(duration).toBeCloseTo(20 * MP3_FRAME_DURATION_SECONDS, 10);
  });

  test('returns only the frames preceding trailing garbage', () => {
    const bytes = concatBytes(buildFrames(10), new Uint8Array(200).fill(0xab));

    const duration = measureMp3Duration(bytes);

    expect(duration).toBeCloseTo(10 * FRAME_DURATION_SECONDS, 10);
  });

  test('returns zero rather than throwing for a file with no valid frames at all', () => {
    const garbage = new Uint8Array(64).fill(0x00);

    const duration = measureMp3Duration(garbage);

    expect(duration).toBe(0);
  });
});
