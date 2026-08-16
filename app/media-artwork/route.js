import { ImageResponse } from 'next/og';

import { headphoneGlyph } from '@/app/_lib/headphoneGlyph';

// The Now Playing artwork the OS shows on the lock screen and in Control Center, handed to
// it explicitly by useMediaSession.js's MediaMetadata. Without an `artwork` entry iOS picks
// the page's own icon instead, which is how this app spent phase 1.9 showing the
// create-next-app favicon on the lock screen while the Home Screen showed the right glyph -
// two different fallbacks reaching two different files. Declaring it removes the guess.
//
// A Route Handler rather than another `app/icon.js`-style metadata file: those emit
// <link rel="icon"> tags into every page's <head>, and this image is not page metadata. It
// is an asset one line of client JS references by URL.
// Route Handlers are not cached by default in this version, so without this the image is
// re-rendered per request - satori laying out the SVG, then a PNG encode - for an image
// whose only input is a constant. `app/icon.js` and `app/apple-icon.js` are prerendered by
// their own convention; this opts a plain GET into the same treatment.
export const dynamic = 'force-static';

const SIZE = 512;

// 0.688 of the frame, the same proportion app/icon.js (22/32) and app/apple-icon.js
// (124/180) use, so the three sizes read as one icon rather than three drawings.
const GLYPH = Math.round(SIZE * 0.688);

export async function GET() {
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
      {headphoneGlyph(GLYPH)}
    </div>,
    {
      width: SIZE,
      height: SIZE,
      // No border radius, matching app/apple-icon.js: iOS masks Now Playing artwork itself,
      // and rounding it here would show through as a corner inside a corner.
      headers: {
        // The glyph is drawn from source that only changes when the app is redeployed, and
        // the lock screen re-fetches this on every Book. Immutable rather than revalidated.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
  );
}
