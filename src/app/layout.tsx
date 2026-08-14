import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'TFK Predictions League',
  description: 'Premier League 2026/27 predictions league. Predict every scoreline, pick a captain, win the month.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tfkpredictions.com')
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
