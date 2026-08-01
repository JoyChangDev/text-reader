import { ImageResponse } from 'next/og';

import { headphoneGlyph } from '@/app/_lib/headphoneGlyph';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

// Placeholder branding: no source artwork exists yet, so this is a simple
// programmatically-drawn headphone glyph good enough to replace the default Next.js
// favicon - see specs/phase-1-9-reader-route-restructure.md. Swap for real design
// assets later if wanted.
export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0B0C0E',
        borderRadius: 7,
      }}
    >
      {headphoneGlyph(22)}
    </div>,
    { ...size },
  );
}
