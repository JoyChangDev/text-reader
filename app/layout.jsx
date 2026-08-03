import './globals.css';

import ChakraProvider from '@/providers/chakra';
import { ColorModeProvider } from '@/providers/colorMode';

export const metadata = {
  title: 'text-reader',
  description: '將文字書轉換為有聲書並逐句朗讀的個人閱讀器',
  appleWebApp: {
    title: 'text-reader',
    statusBarStyle: 'black-translucent',
  },
};

// `viewport-fit=cover` is what makes `env(safe-area-inset-*)` resolve to real values
// instead of a flat `0px` - without it those insets are inert everywhere they're used
// (AudioPlayer's top padding, PlayerBar's and PlayerSettingsSheet's bottom padding).
// It's specifically required by the `black-translucent` status bar style above: that
// style tells iOS to draw the status bar transparently *over* the page, so a Home
// Screen (standalone) launch starts the content at y=0 under the notch/status bar and
// runs it down under the home indicator. Declaring the overlay without also honouring
// the insets is worse than not declaring it at all.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ColorModeProvider>
          <ChakraProvider>{children}</ChakraProvider>
        </ColorModeProvider>
      </body>
    </html>
  );
}
