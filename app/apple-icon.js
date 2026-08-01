import { ImageResponse } from 'next/og';

import { headphoneGlyph } from '@/app/_lib/headphoneGlyph';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// Same placeholder headphone glyph as app/icon.js, at the size iOS wants for its Home
// Screen icon (apple-touch-icon) - see specs/phase-1-9-reader-route-restructure.md.
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0B0C0E',
      }}
    >
      {headphoneGlyph(124)}
    </div>,
    { ...size },
  );
}
