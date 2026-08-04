// Regenerates the ticket 01 probe into public/hls-packed-audio/ (gitignored - the audio
// is ~900KB and has no business in this repo's history; see README.md next to this file).
// Synthesizes real Chunks through edge-tts exactly the way edgeTtsClient.js does (same
// library, same call), so the bytes match what production stores - and without needing a
// BLOB_READ_WRITE_TOKEN, since only storage wants the token and this skips storage.
//
// Emits three playlists that together make the experiment interpretable:
//   a-local  raw MP3, same-origin          -> is the MP3 packed-audio format accepted?
//   b-local  ID3-tagged MP3, same-origin   -> does the required PRIV timestamp fix it?
//   c-skew   ID3-tagged, one EXTINF +0.5s  -> how much duration error is survivable?
//
// Ticket 01 answered all three (a-local plays; the tag is unnecessary; 0.5s of EXTINF
// error is invisible). This is kept as the regression test for that answer, because
// a-local passing depends on Safari not enforcing a tag the HLS specification does
// require - undocumented leniency that a future iOS could withdraw.
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EdgeTTS } from 'edge-tts-universal';

const VOICE = 'zh-TW-HsiaoChenNeural';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve('public/hls-packed-audio');

// Six passages of roughly the same size as a production Chunk (chunkText.js caps at 200
// chars / 4 sentences). Deliberately about the test itself: no third-party book text
// ends up as committed audio. Each names its own index so a listener can tell by ear
// exactly which segment is playing and where playback stopped.
const PASSAGES = [
  '這是第零段。這段錄音用來測試連續播放是否能跨越分段邊界。如果你聽見下一段開始，表示播放器自己前進了。請繼續聽下去。',
  '這是第一段。到這裡為止，播放器已經跨過一次邊界。這代表媒體堆疊有能力自己接續下一個檔案，不需要程式介入。',
  '這是第二段。連續兩次邊界都順利通過了。接下來還有幾段，請確認聲音沒有中斷、也沒有出現爆音或空白。',
  '這是第三段。如果你聽到這裡，格式本身應該是可以接受的。請留意畫面上的秒數是否仍然持續增加。',
  '這是第四段。測試接近尾聲。請注意最後一次邊界是否同樣順利，以及總時間是否與實際聽到的長度相符。',
  '這是第五段，也是最後一段。聽完這段之後播放應該自然結束。感謝配合，請把畫面上的紀錄回報回去。',
];

const OWNER = 'com.apple.streaming.transportStreamTimestamp';

// A 4-byte synchsafe integer: seven significant bits per byte, high bit always clear so
// the value can never be mistaken for an MPEG frame sync. ID3v2.4 uses this encoding for
// both the tag size and each frame size.
function synchsafe(value) {
  return Buffer.from([
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f,
  ]);
}

// The tag HLS requires at the head of every packed-audio segment: an ID3v2.4 tag holding
// one PRIV frame whose payload is the owner identifier, a null terminator, and the
// segment's first-sample timestamp as a big-endian 64-bit value in 90 kHz units.
function buildTimestampTag(seconds) {
  const owner = Buffer.from(`${OWNER}\0`, 'latin1');
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64BE(BigInt(Math.round(seconds * 90000)));
  const frameBody = Buffer.concat([owner, timestamp]);

  const frameHeader = Buffer.concat([
    Buffer.from('PRIV', 'latin1'),
    synchsafe(frameBody.length),
    Buffer.from([0x00, 0x00]),
  ]);
  const frame = Buffer.concat([frameHeader, frameBody]);

  const tagHeader = Buffer.concat([
    Buffer.from('ID3', 'latin1'),
    Buffer.from([0x04, 0x00]), // version 2.4.0
    Buffer.from([0x00]), // no flags
    synchsafe(frame.length),
  ]);

  return Buffer.concat([tagHeader, frame]);
}

function probeDuration(file) {
  const output = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  );
  return Number.parseFloat(output.trim());
}

function playlist(entries, { prefix }) {
  const target = Math.ceil(Math.max(...entries.map((entry) => entry.duration)));
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${target}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];
  for (const entry of entries) {
    lines.push(`#EXTINF:${entry.duration.toFixed(6)},`, `${prefix}${entry.name}`);
  }
  lines.push('#EXT-X-ENDLIST', '');
  return lines.join('\n');
}

async function main() {
  await mkdir(path.join(OUT, 'raw'), { recursive: true });
  await mkdir(path.join(OUT, 'tagged'), { recursive: true });

  const entries = [];
  let elapsed = 0;

  for (const [index, text] of PASSAGES.entries()) {
    const tts = new EdgeTTS(text, VOICE);
    const { audio } = await tts.synthesize();
    const bytes = Buffer.from(await audio.arrayBuffer());

    const name = `seg-${index}.mp3`;
    const rawPath = path.join(OUT, 'raw', name);
    await writeFile(rawPath, bytes);

    // Tagged copies carry the running timestamp of their first sample, so a segment
    // generated out of order would still land at the right point on the timeline.
    await writeFile(
      path.join(OUT, 'tagged', name),
      Buffer.concat([buildTimestampTag(elapsed), bytes]),
    );

    const duration = probeDuration(rawPath);
    entries.push({ name, duration });
    elapsed += duration;
    console.log(`seg-${index}: ${bytes.length} bytes, ${duration.toFixed(3)}s`);
  }

  await writeFile(path.join(OUT, 'a-local.m3u8'), playlist(entries, { prefix: 'raw/' }));
  await writeFile(path.join(OUT, 'b-local.m3u8'), playlist(entries, { prefix: 'tagged/' }));

  // One segment's declared duration is deliberately half a second long. If playback
  // survives this, ticket 02's duration measurement has real slack; if it drifts or
  // stutters, that measurement has to be exact.
  const skewed = entries.map((entry, index) =>
    index === 2 ? { ...entry, duration: entry.duration + 0.5 } : entry,
  );
  await writeFile(path.join(OUT, 'c-skew.m3u8'), playlist(skewed, { prefix: 'tagged/' }));

  // The test page is a template kept beside this script rather than generated, since it
  // is hand-written and has nothing to derive from the audio. Copying it here is what
  // makes "re-run the script" reproduce the whole probe rather than only its segments.
  await copyFile(path.join(HERE, 'index.html'), path.join(OUT, 'index.html'));

  console.log(`\ntotal ${elapsed.toFixed(3)}s across ${entries.length} segments`);
  console.log(`\nwrote ${OUT} (gitignored - see scripts/packed-audio-probe/README.md)`);

  const durations = entries.map((entry) => entry.duration.toFixed(3)).join(', ');
  console.log(`\nIf these durations differ from [${durations}], update DURATIONS in index.html.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
