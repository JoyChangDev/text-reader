// Walks MPEG audio frame headers to compute an MP3's exact duration, the same way a
// decoder counts it — see .scratch/phase-1-10-continuous-hls-playback/issues/02-measure-chunk-duration-from-mp3-frames.md.
// Frame boundary data and size/bitrate estimates were both ruled out there: edge-tts
// isn't guaranteed constant bitrate, and Safari builds its timeline from decoded frames.

const MPEG_VERSIONS = { 0b00: 2.5, 0b10: 2, 0b11: 1 };
const LAYERS = { 0b01: 3, 0b10: 2, 0b11: 1 };

const SAMPLE_RATES = {
  1: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  2.5: [11025, 12000, 8000],
};

// MPEG2 and MPEG2.5 share the same bitrate and samples-per-frame tables; only MPEG1 differs.
const BITRATES_KBPS = {
  1: {
    1: [null, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, null],
    2: [null, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, null],
    3: [null, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, null],
  },
  2: {
    1: [null, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, null],
    2: [null, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, null],
    3: [null, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, null],
  },
};

const SAMPLES_PER_FRAME = {
  1: { 1: 384, 2: 1152, 3: 1152 },
  2: { 1: 384, 2: 1152, 3: 576 },
};

function skipId3v2Header(bytes) {
  const isId3 = bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  if (!isId3) {
    return 0;
  }

  const hasFooter = (bytes[5] & 0x10) !== 0;
  const size =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);

  return 10 + size + (hasFooter ? 10 : 0);
}

// Returns null on anything that isn't a playable frame header (bad sync, reserved
// version/layer, free-format or reserved bitrate, reserved sample rate) — the caller
// treats that as "no more measurable audio" rather than an error.
function parseFrameHeader(bytes, offset) {
  if (offset + 4 > bytes.length) {
    return null;
  }

  const b2 = bytes[offset + 1];
  if (bytes[offset] !== 0xff || (b2 & 0xe0) !== 0xe0) {
    return null;
  }

  const version = MPEG_VERSIONS[(b2 >> 3) & 0b11];
  const layer = LAYERS[(b2 >> 1) & 0b11];
  if (version === undefined || layer === undefined) {
    return null;
  }

  const b3 = bytes[offset + 2];
  const bitrateIndex = (b3 >> 4) & 0x0f;
  const sampleRateIndex = (b3 >> 2) & 0b11;
  const padding = (b3 >> 1) & 0b1;

  const bitrateGroup = version === 1 ? 1 : 2;
  const bitrateKbps = BITRATES_KBPS[bitrateGroup][layer][bitrateIndex];
  const sampleRate = SAMPLE_RATES[version][sampleRateIndex];
  if (!bitrateKbps || sampleRate === undefined) {
    return null;
  }

  const samplesPerFrame = SAMPLES_PER_FRAME[version === 1 ? 1 : 2][layer];
  const bitrateBps = bitrateKbps * 1000;
  // Layer I frames are counted in 4-byte slots; Layer II/III in 1-byte slots, so the
  // per-frame byte count is samplesPerFrame / 8 (576 samples/frame -> 72, not the 144
  // that only holds for the 1152-sample MPEG1/Layer2-3 case).
  const frameLength =
    layer === 1
      ? (Math.floor((12 * bitrateBps) / sampleRate) + padding) * 4
      : Math.floor(((samplesPerFrame / 8) * bitrateBps) / sampleRate) + padding;
  if (frameLength <= 0) {
    return null;
  }

  return { frameLength, durationSeconds: samplesPerFrame / sampleRate };
}

// Takes the raw bytes of an MP3 (ArrayBuffer, Uint8Array, or Buffer) and returns its
// duration in seconds. Never throws: a truncated file or trailing garbage stops the
// walk and returns whatever was measured up to that point, and a file with no valid
// frames at all returns 0.
export function measureMp3Duration(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let offset = skipId3v2Header(data);
  let totalSeconds = 0;

  while (offset < data.length) {
    const frame = parseFrameHeader(data, offset);
    if (!frame || offset + frame.frameLength > data.length) {
      break;
    }

    totalSeconds += frame.durationSeconds;
    offset += frame.frameLength;
  }

  return totalSeconds;
}
