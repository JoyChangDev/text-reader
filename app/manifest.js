// Replaces the absence of any manifest with a real, deliberate one - see
// specs/phase-1-9-reader-route-restructure.md ("iOS Safari's Home Screen shortcut for
// this app already renders in a chrome-less, standalone-looking mode despite no
// manifest existing anywhere in this codebase"). Icons point at the generated
// app/icon.js and app/apple-icon.js placeholder headphone glyphs. theme_color/
// background_color match this app's own "night" theme tokens (see
// app/_providers/chakra.jsx) rather than arbitrary defaults.
export default function manifest() {
  return {
    name: 'text-reader',
    short_name: 'text-reader',
    description: '將文字書轉換為有聲書並逐句朗讀的個人閱讀器',
    start_url: '/',
    display: 'standalone',
    background_color: '#0B0C0E',
    theme_color: '#E8A961',
    icons: [
      { src: '/icon', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
