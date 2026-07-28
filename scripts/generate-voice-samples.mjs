import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EdgeTTS } from 'edge-tts-universal';

// One-time script (see .scratch/phase-1-5-audiobook-reader/issues/03-voice-preview-samples.md):
// generates a static preview clip per voice, committed under public/voice-samples/ and
// served as-is - never synthesized at request time. Re-run manually if AVAILABLE_VOICES
// in app/_lib/listenerSettings.js changes; the voice list is duplicated here (rather than
// imported) because this plain Node script can't load that app module's ESM syntax without
// a bundler.
const VOICES = ['zh-TW-HsiaoChenNeural', 'zh-TW-YunJheNeural', 'zh-TW-HsiaoYuNeural'];

const SAMPLE_TEXT = '這是語音範例,幫助你選擇喜歡的朗讀聲音。';

const outputDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'voice-samples',
);

async function main() {
  await mkdir(outputDir, { recursive: true });

  for (const voice of VOICES) {
    const tts = new EdgeTTS(SAMPLE_TEXT, voice);
    const { audio } = await tts.synthesize();
    const buffer = Buffer.from(await audio.arrayBuffer());
    const outputPath = path.join(outputDir, `${voice}.mp3`);

    await writeFile(outputPath, buffer);
    console.log(`Wrote ${outputPath} (${buffer.length} bytes)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
