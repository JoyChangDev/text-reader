import { beforeEach, describe, expect, test } from 'vitest';

import {
  DEFAULT_SPEED,
  DEFAULT_VOICE,
  getListenerSettings,
  updateListenerSettings,
  voiceSampleUrl,
} from './listenerSettings';

describe('listenerSettings', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('defaults to the current hardcoded voice and speed when nothing has been stored yet', () => {
    expect(getListenerSettings()).toEqual({ voice: DEFAULT_VOICE, speed: DEFAULT_SPEED });
  });

  test('updateListenerSettings persists a change that a later read sees', () => {
    updateListenerSettings({ voice: 'zh-TW-YunJheNeural' });

    expect(getListenerSettings()).toEqual({ voice: 'zh-TW-YunJheNeural', speed: DEFAULT_SPEED });
  });

  test('updateListenerSettings merges into existing settings rather than replacing them', () => {
    updateListenerSettings({ voice: 'zh-TW-YunJheNeural' });
    updateListenerSettings({ extra: 'future-field' });

    expect(getListenerSettings()).toEqual({
      voice: 'zh-TW-YunJheNeural',
      speed: DEFAULT_SPEED,
      extra: 'future-field',
    });
  });

  test('persists across separate calls, as if surviving a page reload', () => {
    updateListenerSettings({ voice: 'zh-TW-HsiaoYuNeural' });

    // A fresh read from storage (no in-memory state carried over) still sees it.
    expect(getListenerSettings()).toEqual({ voice: 'zh-TW-HsiaoYuNeural', speed: DEFAULT_SPEED });
  });

  test('updateListenerSettings persists a speed change independent of voice', () => {
    updateListenerSettings({ speed: 1.5 });

    expect(getListenerSettings()).toEqual({ voice: DEFAULT_VOICE, speed: 1.5 });
  });
});

describe('voiceSampleUrl', () => {
  test('points at the static, pre-generated clip for a voice (see scripts/generate-voice-samples.mjs)', () => {
    expect(voiceSampleUrl('zh-TW-YunJheNeural')).toBe('/voice-samples/zh-TW-YunJheNeural.mp3');
  });
});
