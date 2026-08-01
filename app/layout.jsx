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
