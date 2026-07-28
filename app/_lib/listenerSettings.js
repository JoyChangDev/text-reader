const STORAGE_KEY = 'text-reader:listener-settings';

export const DEFAULT_VOICE = 'zh-TW-HsiaoChenNeural';

export const AVAILABLE_VOICES = [
  { value: 'zh-TW-HsiaoChenNeural', label: 'Hsiao-Chen' },
  { value: 'zh-TW-YunJheNeural', label: 'Yun-Jhe' },
  { value: 'zh-TW-HsiaoYuNeural', label: 'Hsiao-Yu' },
];

const DEFAULT_SETTINGS = { voice: DEFAULT_VOICE };

// Device-scoped Listener preferences (voice, and later speed) in one generic store,
// separate from bookLibrary.js's per-book records - see ADR 0001.
function readSettings() {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings) {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function getListenerSettings() {
  return readSettings();
}

export function updateListenerSettings(partial) {
  const settings = { ...readSettings(), ...partial };
  writeSettings(settings);
  return settings;
}
