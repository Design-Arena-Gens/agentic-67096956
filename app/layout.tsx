import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI Hindi Video Agent',
  description: 'Generate short Hindi caption videos and upload to Facebook',
  icons: [{ rel: 'icon', url: '/favicon.ico' }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
